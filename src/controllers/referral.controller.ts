import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError } from '../utils/response';
import type { AuthenticatedRequest } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a unique 8-char alphanumeric referral code with retry loop. */
async function generateUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    const existing = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!existing) return code;
  }
  // Extremely unlikely fallback — append timestamp fragment
  return Math.random().toString(36).substring(2, 6).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();
}

// ─── Get my referral info ─────────────────────────────────────────────────────

export async function getMyReferralInfo(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;

  let user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      referralCode: true,
      referralsGiven: {
        select: {
          id: true,
          reward: true,
          status: true,
          createdAt: true,
          referred: {
            select: { firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!user) {
    sendError(res, 'User not found', 404);
    return;
  }

  // Generate referral code if the user doesn't have one yet
  if (!user.referralCode) {
    const code = await generateUniqueReferralCode();
    user = await prisma.user.update({
      where: { id: userId },
      data: { referralCode: code },
      select: {
        id: true,
        referralCode: true,
        referralsGiven: {
          select: {
            id: true,
            reward: true,
            status: true,
            createdAt: true,
            referred: {
              select: { firstName: true, lastName: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  const referralCount = user.referralsGiven.length;
  const totalEarned = user.referralsGiven.reduce((sum, r) => sum + r.reward, 0);

  const referredUsers = user.referralsGiven.map((r) => ({
    name: `${r.referred.firstName} ${r.referred.lastName}`,
    joinedAt: r.createdAt,
    reward: r.reward,
    status: r.status,
  }));

  sendSuccess(res, {
    referralCode: user.referralCode,
    referralCount,
    totalEarned,
    referredUsers,
  });
}

// ─── Get referral stats ───────────────────────────────────────────────────────

export async function getReferralStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;

  const referrals = await prisma.referral.findMany({
    where: { referrerId: userId },
    select: { reward: true, status: true },
  });

  const referralCount = referrals.length;
  const totalEarned = referrals.reduce((sum, r) => sum + r.reward, 0);

  sendSuccess(res, { referralCount, totalEarned });
}
