import { Response } from 'express';
import { prisma } from '../config/database';
import { hashPassword, comparePassword } from '../utils/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { sendSuccess, sendCreated, sendError, sendUnauthorized } from '../utils/response';
import type { AuthenticatedRequest } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeUser(user: Record<string, unknown>) {
  const { passwordHash, refreshToken, verificationToken, ...safe } = user;
  return safe;
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function register(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { email, password, firstName, lastName, role, phone, country } = req.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) { sendError(res, 'Email already in use', 409); return; }

  const validCountries = ['IN', 'AE', 'SG', 'US'];
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email, passwordHash, firstName, lastName, role, phone,
      country: validCountries.includes(country) ? country : null,
    },
  });

  // Auto-create wallet with currency based on country
  const countryCurrency: Record<string, string> = { IN: 'INR', AE: 'AED', SG: 'SGD', US: 'USD' };
  const walletCurrency = (country && countryCurrency[country]) || 'USD';
  await prisma.wallet.create({ data: { userId: user.id, currency: walletCurrency } });

  const payload = { userId: user.id, email: user.email, role: user.role };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

  sendCreated(res, {
    user: safeUser(user as unknown as Record<string, unknown>),
    accessToken,
    refreshToken,
  }, 'Registration successful');
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { sendUnauthorized(res, 'Invalid credentials'); return; }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) { sendUnauthorized(res, 'Invalid credentials'); return; }

  if (!user.isActive) { sendError(res, 'Account is deactivated', 403); return; }

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
