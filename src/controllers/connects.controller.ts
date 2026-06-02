import crypto from 'crypto';
import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError, sendNotFound } from '../utils/response';
import { getPagination, buildPaginatedResult } from '../utils/pagination';
import { razorpay } from '../utils/razorpay';
import type { AuthenticatedRequest } from '../types';

// ─── Connect Packages ─────────────────────────────────────────────────────────

const CONNECT_PACKAGES = {
  starter: { connects: 10,  priceInPaise: 9900  },   // ₹99
  pro:     { connects: 30,  priceInPaise: 24900 },   // ₹249
  power:   { connects: 60,  priceInPaise: 44900 },   // ₹449
  elite:   { connects: 120, priceInPaise: 79900 },   // ₹799
} as const;

type PackageKey = keyof typeof CONNECT_PACKAGES;

// ─── Get packages (public) ────────────────────────────────────────────────────

export async function getConnectPackages(_req: Request, res: Response): Promise<void> {
  const packages = Object.entries(CONNECT_PACKAGES).map(([key, p]) => ({
    key,
    connects: p.connects,
    priceInPaise: p.priceInPaise,
    priceInRupees: p.priceInPaise / 100,
    label: `${p.connects} Connects`,
    perConnect: Math.round((p.priceInPaise / 100 / p.connects) * 10) / 10,
  }));
  sendSuccess(res, packages);
}

// ─── Get my balance + history ─────────────────────────────────────────────────

export async function getMyConnects(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { page, limit, skip } = getPagination(req);

  const [user, txns, total] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { connectsBalance: true } }),
    prisma.connectTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.connectTransaction.count({ where: { userId } }),
  ]);

  if (!user) { sendNotFound(res, 'User'); return; }

  sendSuccess(res, {
    balance: user.connectsBalance,
    transactions: buildPaginatedResult(txns, total, { page, limit, skip }),
  });
}

// ─── Step 1: Create Razorpay order ───────────────────────────────────────────

export async function createConnectOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { packageKey } = req.body as { packageKey: PackageKey };
  const pkg = CONNECT_PACKAGES[packageKey];

  if (!pkg) { sendError(res, 'Invalid package key', 400); return; }

  try {
    const order = await razorpay.orders.create({
      amount: pkg.priceInPaise,
      currency: 'INR',
      receipt: `connects_${packageKey}_${Date.now()}`,
      notes: { packageKey, connects: String(pkg.connects) },
    });

    sendSuccess(res, {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err: unknown) {
    console.error('[Connects] createConnectOrder error:', err);
    sendError(res, 'Failed to create payment order', 500);
  }
}

// ─── Step 2: Verify payment + credit connects ─────────────────────────────────

export async function verifyAndCreditConnects(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    packageKey,
  } = req.body as {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
    packageKey: PackageKey;
  };

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    sendError(res, 'Missing payment verification fields', 400); return;
  }

  const pkg = CONNECT_PACKAGES[packageKey];
  if (!pkg) { sendError(res, 'Invalid package key', 400); return; }

  // Verify HMAC signature (same pattern as razorpayLoans.controller.ts)
  const expectedSig = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSig !== razorpay_signature) {
    sendError(res, 'Payment verification failed', 400); return;
  }

  // Idempotency guard: prevent double-crediting same payment
  const existing = await prisma.connectTransaction.findFirst({
    where: { razorpayPaymentId: razorpay_payment_id },
  });
  if (existing) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { connectsBalance: true } });
    sendSuccess(res, { balance: user?.connectsBalance ?? 0 }, 'Already credited');
    return;
  }

  // Credit connects atomically
  const [updatedUser] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { connectsBalance: { increment: pkg.connects } },
      select: { connectsBalance: true },
    }),
    prisma.connectTransaction.create({
      data: {
        userId,
        type: 'purchase',
        amount: pkg.connects,
        description: `Purchased ${pkg.connects} connects (${packageKey} package) — ₹${pkg.priceInPaise / 100}`,
        razorpayOrderId:   razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
        packageKey,
      },
    }),
  ]);

  sendSuccess(res, { balance: updatedUser.connectsBalance }, `${pkg.connects} connects added to your account`);
}
