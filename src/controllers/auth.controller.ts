import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { hashPassword, comparePassword } from '../utils/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { sendSuccess, sendCreated, sendError, sendUnauthorized } from '../utils/response';
import { generateOtp } from '../utils/otp';
import { sendOtpEmail, sendPasswordResetEmail } from '../utils/email';
import type { AuthenticatedRequest } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeUser(user: Record<string, unknown>) {
  const { passwordHash, refreshToken, verificationToken, ...safe } = user;
  return safe;
}

/** Rejects after ms milliseconds — used to cap email-send time. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/** Delete all existing OTPs for an email and create a fresh one (10-min expiry). */
async function createAndSendOtp(email: string, firstName: string): Promise<void> {
  await prisma.otpCode.deleteMany({ where: { email } });

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await prisma.otpCode.create({ data: { email, code, expiresAt } });
  // Hard 10s cap — if SMTP hangs, we still respond quickly and the user can resend
  await withTimeout(sendOtpEmail(email, code, firstName), 10_000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a unique 8-char alphanumeric referral code with retry loop. */
async function generateUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    const existing = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!existing) return code;
  }
  return Math.random().toString(36).substring(2, 6).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function register(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { email, password, firstName, lastName, role, phone, country, referralCode } = req.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // If they registered but never verified, resend the OTP
    if (!existing.isVerified) {
      await createAndSendOtp(email, existing.firstName);
      sendCreated(res, { requiresVerification: true, email },
        'Account pending verification. A new code has been sent to your email.');
      return;
    }
    sendError(res, 'Email already in use', 409);
    return;
  }

  const validCountries = ['IN', 'AE', 'SG', 'US'];
  const passwordHash = await hashPassword(password);

  // Generate a unique referral code for the new user
  const newUserReferralCode = await generateUniqueReferralCode();

  // Resolve the referrer (if a referral code was provided)
  let referrer: { id: string } | null = null;
  if (referralCode) {
    referrer = await prisma.user.findUnique({
      where: { referralCode: String(referralCode) },
      select: { id: true },
    });
  }

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName,
      lastName,
      role,
      phone,
      country: validCountries.includes(country) ? country : null,
      isVerified: false,
      referralCode: newUserReferralCode,
      referredBy: referrer ? String(referralCode) : null,
    },
  });

  // Auto-create wallet with currency based on country
  const countryCurrency: Record<string, string> = { IN: 'INR', AE: 'AED', SG: 'SGD', US: 'USD' };
  const walletCurrency = (country && countryCurrency[country]) || 'USD';
  await prisma.wallet.create({ data: { userId: user.id, currency: walletCurrency } });

  // Handle referral reward: credit $10 to the referrer's wallet
  if (referrer) {
    try {
      await prisma.$transaction([
        // Create the referral record
        prisma.referral.create({
          data: {
            referrerId: referrer.id,
            referredId: user.id,
            reward: 10.0,
            status: 'credited',
          },
        }),
        // Upsert referrer's wallet and credit $10
        prisma.wallet.upsert({
          where: { userId: referrer.id },
          create: { userId: referrer.id, balance: 10.0, totalEarned: 10.0 },
          update: {
            balance: { increment: 10.0 },
            totalEarned: { increment: 10.0 },
          },
        }),
        // Create a credit transaction for the referrer
        prisma.transaction.create({
          data: {
            userId: referrer.id,
            type: 'credit',
            amount: 10.0,
            status: 'completed',
            description: `Referral bonus: ${firstName} ${lastName} joined using your code`,
            metadata: JSON.stringify({ type: 'referral_bonus', referredUserId: user.id }),
          },
        }),
      ]);
      // In-app notification for the referrer (fire-and-forget)
      prisma.notification.create({
        data: {
          userId: referrer.id,
          type: 'referral_reward',
          title: '🎉 Referral Bonus!',
          message: `${firstName} ${lastName} joined Biddaro using your referral code. $10.00 has been added to your wallet!`,
          data: JSON.stringify({ amount: 10, referredUserId: user.id }),
        },
      }).catch(() => {});
    } catch (err) {
      console.error('[REFERRAL] Failed to process referral reward:', err);
    }
  }

  // Send OTP — if email fails, still return so user can use resend
  try {
    await createAndSendOtp(email, firstName);
  } catch (err) {
    console.error('[OTP] Failed to send email:', err);
  }

  sendCreated(res, { requiresVerification: true, email },
    'Registration successful. Please verify your email.');
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { sendUnauthorized(res, 'Invalid credentials'); return; }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) { sendUnauthorized(res, 'Invalid credentials'); return; }

  if (!user.isActive) { sendError(res, 'Account is deactivated', 403); return; }

  // Block unverified users and prompt them to check their email
  if (!user.isVerified) {
    sendError(res,
      'Please verify your email before logging in. Check your inbox for the 6-digit code.',
      403);
    return;
  }

  const payload = { userId: user.id, email: user.email, role: user.role };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

  sendSuccess(res, {
    user: safeUser(user as unknown as Record<string, unknown>),
    accessToken,
    refreshToken,
  }, 'Login successful');
}

// ─── Resend OTP ───────────────────────────────────────────────────────────────

export async function sendOtp(req: Request, res: Response): Promise<void> {
  const { email } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { sendError(res, 'No account found with this email', 404); return; }
  if (user.isVerified) { sendError(res, 'Email is already verified', 400); return; }

  try {
    await createAndSendOtp(email, user.firstName);
    sendSuccess(res, null, 'Verification code sent. Please check your inbox.');
  } catch (err) {
    console.error('[OTP] Resend failed:', err);
    sendError(res, 'Failed to send verification email. Please try again.', 500);
  }
}

// ─── Verify OTP ───────────────────────────────────────────────────────────────

export async function verifyOtp(req: Request, res: Response): Promise<void> {
  const { email, code } = req.body;

  const otp = await prisma.otpCode.findFirst({
    where: {
      email,
      code,
      used: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!otp) {
    sendError(res, 'Invalid or expired verification code. Please request a new one.', 400);
    return;
  }

  // Mark OTP as used
  await prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } });

  // Activate the user
  const user = await prisma.user.update({
    where: { email },
    data: { isVerified: true },
  });

  // Issue tokens
  const payload = { userId: user.id, email: user.email, role: user.role };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

  sendSuccess(res, {
    user: safeUser(user as unknown as Record<string, unknown>),
    accessToken,
    refreshToken,
  }, 'Email verified successfully. Welcome to Biddaro!');
}

// ─── Refresh token ────────────────────────────────────────────────────────────

export async function refreshToken(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { refreshToken: token } = req.body;
  if (!token) { sendUnauthorized(res, 'Refresh token required'); return; }

  try {
    const decoded = verifyRefreshToken(token);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

    if (!user || user.refreshToken !== token) {
      sendUnauthorized(res, 'Invalid refresh token'); return;
    }

    const payload = { userId: user.id, email: user.email, role: user.role };
    const accessToken = signAccessToken(payload);
    const newRefresh = signRefreshToken(payload);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken: newRefresh } });

    sendSuccess(res, { accessToken, refreshToken: newRefresh });
  } catch {
    sendUnauthorized(res, 'Invalid refresh token');
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (req.user) {
    await prisma.user.update({ where: { id: req.user.userId }, data: { refreshToken: null } });
  }
  sendSuccess(res, null, 'Logged out successfully');
}

// ─── Get current user ─────────────────────────────────────────────────────────

export async function getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    include: { wallet: true },
  });
  if (!user) { sendUnauthorized(res, 'User not found'); return; }
  sendSuccess(res, safeUser(user as unknown as Record<string, unknown>));
}

// ─── Change password ──────────────────────────────────────────────────────────

export async function changePassword(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });

  if (!user || !(await comparePassword(currentPassword, user.passwordHash))) {
    sendError(res, 'Current password is incorrect', 400); return;
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  sendSuccess(res, null, 'Password changed successfully');
}

// ─── Forgot password ──────────────────────────────────────────────────────────

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body;

  // Always respond with success to prevent email enumeration
  const genericMsg = 'If an account with that email exists, a reset link has been sent.';

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isVerified) {
    sendSuccess(res, null, genericMsg);
    return;
  }

  // Delete any existing tokens for this email
  await prisma.passwordResetToken.deleteMany({ where: { email } });

  // Generate a secure random token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.passwordResetToken.create({ data: { email, token, expiresAt } });

  const frontendUrl = process.env.FRONTEND_URL || 'https://biddaro.com';
  const resetLink = `${frontendUrl}/reset-password?token=${token}`;

  try {
    await withTimeout(sendPasswordResetEmail(email, user.firstName, resetLink), 10_000);
  } catch (err) {
    console.error('[PASSWORD_RESET] Failed to send email:', err);
  }

  sendSuccess(res, null, genericMsg);
}

// ─── Reset password ───────────────────────────────────────────────────────────

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, newPassword } = req.body;

  const resetToken = await prisma.passwordResetToken.findFirst({
    where: {
      token,
      used: false,
      expiresAt: { gt: new Date() },
    },
  });

  if (!resetToken) {
    sendError(res, 'Invalid or expired reset link. Please request a new one.', 400);
    return;
  }

  // Mark token as used
  await prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { used: true } });

  // Update password and invalidate all sessions
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { email: resetToken.email },
    data: { passwordHash, refreshToken: null },
  });

  sendSuccess(res, null, 'Password reset successfully. Please log in with your new password.');
}
