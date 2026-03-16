import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError, sendNotFound } from '../utils/response';
import { getPagination, buildPaginatedResult } from '../utils/pagination';
import type { AuthenticatedRequest } from '../types';

// ─── Get wallet ───────────────────────────────────────────────────────────────

export async function getWallet(req: AuthenticatedRequest, res: Response): Promise<void> {
  const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.userId } });
  if (!wallet) {
    // Auto-create wallet if missing
    const created = await prisma.wallet.create({
      data: { userId: req.user!.userId, balance: 0, pendingBalance: 0, totalEarned: 0 },
    });
    sendSuccess(res, created); return;
  }
  sendSuccess(res, wallet);
}

// ─── Get transactions ─────────────────────────────────────────────────────────

export async function getTransactions(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { page, limit, skip } = getPagination(req);
  const { type, status } = req.query;
  const userId = req.user!.userId;

  const where: Record<string, unknown> = { userId };
  if (type) where.type = type;
  if (status) where.status = status;

  const [transactions, total] = await prisma.$transaction([
    prisma.transaction.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.transaction.count({ where }),
  ]);

  sendSuccess(res, buildPaginatedResult(transactions, total, { page, limit, skip }));
}

// ─── Deposit ──────────────────────────────────────────────────────────────────

export async function deposit(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { amount, paymentMethod } = req.body;
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) { sendError(res, 'Invalid amount', 400); return; }
  if (numAmount < 10) { sendError(res, 'Minimum deposit is $10', 400); return; }

  const userId = req.user!.userId;

  // In production: integrate Stripe/payment gateway here
  const [transaction] = await prisma.$transaction([
    prisma.transaction.create({
      data: {
        userId,
        type: 'credit',
        amount: numAmount,
        description: `Deposit via ${paymentMethod || 'card'}`,
        status: 'completed',
        metadata: JSON.stringify({ paymentMethod }),
      },
    }),
    prisma.wallet.upsert({
      where: { userId },
      create: { userId, balance: numAmount, pendingBalance: 0, totalEarned: 0 },
      update: { balance: { increment: numAmount } },
    }),
  ]);

  sendSuccess(res, transaction, `$${numAmount.toFixed(2)} deposited successfully`);
}

// ─── Withdraw ─────────────────────────────────────────────────────────────────

export async function withdraw(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { amount, bankAccount } = req.body;
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) { sendError(res, 'Invalid amount', 400); return; }
  if (numAmount < 20) { sendError(res, 'Minimum withdrawal is $20', 400); return; }

  const userId = req.user!.userId;
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) { sendNotFound(res, 'Wallet'); return; }
  if (Number(wallet.balance) < numAmount) { sendError(res, 'Insufficient balance', 400); return; }

  const [transaction] = await prisma.$transaction([
    prisma.transaction.create({
      data: {
        userId,
        type: 'withdrawal',
        amount: numAmount,
        description: `Withdrawal to bank account`,
        status: 'pending',
        metadata: JSON.stringify({ bankAccount: maskAccount(bankAccount) }),
      },
    }),
    prisma.wallet.update({
      where: { userId },
      data: { balance: { decrement: numAmount } },
    }),
  ]);

  sendSuccess(res, transaction, `Withdrawal of $${numAmount.toFixed(2)} initiated`);
}

// ─── Get wallet stats ─────────────────────────────────────────────────────────

export async function getWalletStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [wallet, monthlyCredit, monthlyFees, pendingTx] = await prisma.$transaction([
    prisma.wallet.findUnique({ where: { userId } }),
    prisma.transaction.aggregate({
      where: { userId, type: 'credit', status: 'completed', createdAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, type: 'fee', status: 'completed', createdAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.transaction.count({ where: { userId, status: 'pending' } }),
  ]);

  sendSuccess(res, {
    balance: wallet?.balance ?? 0,
    pendingBalance: wallet?.pendingBalance ?? 0,
    totalEarned: wallet?.totalEarned ?? 0,
    thisMonthEarnings: Number(monthlyCredit._sum.amount ?? 0),
    thisMonthFees: Number(monthlyFees._sum.amount ?? 0),
    pendingTransactions: pendingTx,
  });
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function maskAccount(account: string): string {
  if (!account || account.length < 4) return '****';
  return '****' + account.slice(-4);
}
