import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import type { AuthenticatedRequest } from '../types';

const prisma = new PrismaClient();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sendSuccess(res: Response, data: unknown, message = 'Success') {
  res.json({ success: true, message, data });
}
function sendCreated(res: Response, data: unknown, message = 'Created') {
  res.status(201).json({ success: true, message, data });
}
function sendError(res: Response, message: string, status = 400) {
  res.status(status).json({ success: false, message });
}

const PLAN_PRICES: Record<string, number> = {
  monthly: 29.99,
  quarterly: 74.97,
  annual: 249.99,
};

const PLAN_DAYS: Record<string, number> = {
  monthly: 30,
  quarterly: 90,
  annual: 365,
};

// ─── Admin: Premium Stats ────────────────────────────────────────────────────

export async function adminPremiumStats(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [allSubs, activeSubs, cancelledThisMonth, newThisMonth] = await Promise.all([
    prisma.premiumSubscription.findMany(),
    prisma.premiumSubscription.findMany({ where: { status: 'active', expiresAt: { gt: now } } }),
    prisma.premiumSubscription.count({
      where: { status: 'cancelled', cancelledAt: { gte: startOfMonth } },
    }),
    prisma.premiumSubscription.count({
      where: { status: 'active', createdAt: { gte: startOfMonth } },
    }),
  ]);

  const totalRevenue = allSubs.reduce((sum, s) => sum + s.amount, 0);
  const activeCount = activeSubs.length;

  // MRR = sum of active monthly-equivalent revenue
  const mrr = activeSubs.reduce((sum, s) => {
    if (s.plan === 'monthly') return sum + s.amount;
    if (s.plan === 'quarterly') return sum + s.amount / 3;
    if (s.plan === 'annual') return sum + s.amount / 12;
    return sum;
  }, 0);

  // By plan breakdown
  const byPlan = {
    monthly: activeSubs.filter(s => s.plan === 'monthly').length,
    quarterly: activeSubs.filter(s => s.plan === 'quarterly').length,
    annual: activeSubs.filter(s => s.plan === 'annual').length,
  };

  // Growth: compare active this month vs last month
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthNew = await prisma.premiumSubscription.count({
    where: { status: 'active', createdAt: { gte: startOfLastMonth, lt: startOfMonth } },
  });
  const growthPercent = lastMonthNew > 0
    ? (((newThisMonth - lastMonthNew) / lastMonthNew) * 100).toFixed(1)
    : newThisMonth > 0 ? '100.0' : null;

  sendSuccess(res, {
    totalRevenue,
    mrr: Math.round(mrr * 100) / 100,
    arr: Math.round(mrr * 12 * 100) / 100,
    activeSubscriptions: activeCount,
    totalSubscriptions: allSubs.length,
    cancelledThisMonth,
    newThisMonth,
    growthPercent,
    byPlan,
  });
}

// ─── Admin: List Subscriptions ───────────────────────────────────────────────

export async function adminPremiumList(req: AuthenticatedRequest, res: Response): Promise<void> {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 15);
  const status = req.query.status as string | undefined;

  const where = status ? { status } : {};

  const [subscriptions, total] = await Promise.all([
    prisma.premiumSubscription.findMany({
      where,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, profileImage: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.premiumSubscription.count({ where }),
  ]);

  sendSuccess(res, {
    subscriptions,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  });
}

// ─── Admin: Revenue Chart ────────────────────────────────────────────────────

export async function adminPremiumRevenue(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const now = new Date();
  const months: { month: string; revenue: number; count: number }[] = [];

  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const label = start.toLocaleString('en-US', { month: 'short', year: '2-digit' });

    const subs = await prisma.premiumSubscription.findMany({
      where: { createdAt: { gte: start, lt: end } },
    });

    months.push({
      month: label,
      revenue: subs.reduce((sum, s) => sum + s.amount, 0),
      count: subs.length,
    });
  }

  sendSuccess(res, months);
}

// ─── Contractor: Get Status ──────────────────────────────────────────────────

export async function getPremiumStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const now = new Date();

  const activeSub = await prisma.premiumSubscription.findFirst({
    where: { userId, status: 'active', expiresAt: { gt: now } },
    orderBy: { expiresAt: 'desc' },
  });

  sendSuccess(res, {
    isPremium: !!activeSub,
    subscription: activeSub,
  });
}

// ─── Contractor: Subscribe ───────────────────────────────────────────────────

export async function subscribePremium(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { plan } = req.body;

  if (!['monthly', 'quarterly', 'annual'].includes(plan)) {
    sendError(res, 'Invalid plan. Choose monthly, quarterly, or annual');
    return;
  }

  // Check if already has active subscription
  const now = new Date();
  const existing = await prisma.premiumSubscription.findFirst({
    where: { userId, status: 'active', expiresAt: { gt: now } },
  });
  if (existing) {
    sendError(res, 'You already have an active subscription');
    return;
  }

  const amount = PLAN_PRICES[plan];
  const days = PLAN_DAYS[plan];
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const subscription = await prisma.premiumSubscription.create({
    data: {
      userId,
      plan,
      amount,
      expiresAt,
    },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  });

  sendCreated(res, subscription, 'Premium subscription activated!');
}

// ─── Contractor: Cancel ──────────────────────────────────────────────────────

export async function cancelPremium(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const now = new Date();

  const activeSub = await prisma.premiumSubscription.findFirst({
    where: { userId, status: 'active', expiresAt: { gt: now } },
  });

  if (!activeSub) {
    sendError(res, 'No active subscription found');
    return;
  }

  const updated = await prisma.premiumSubscription.update({
    where: { id: activeSub.id },
    data: { autoRenew: false, status: 'cancelled', cancelledAt: now },
  });

  sendSuccess(res, updated, 'Subscription cancelled. Access remains until expiry.');
}

// ─── Contractor: History ─────────────────────────────────────────────────────

export async function getPremiumHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;

  const subscriptions = await prisma.premiumSubscription.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  sendSuccess(res, subscriptions);
}
