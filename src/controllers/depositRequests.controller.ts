import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError, sendNotFound } from '../utils/response';
import { getPagination, buildPaginatedResult } from '../utils/pagination';
import { sendDepositApprovedEmail, sendDepositRejectedEmail } from '../utils/email';
import { sendPushToUser, userWantsPush } from '../utils/push';
import type { AuthenticatedRequest } from '../types';

// ─── Create a deposit request (user submits proof of bank transfer) ───────────

export async function createDepositRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { amount, transactionId, screenshotUrl, senderName, senderBank } = req.body;

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    sendError(res, 'Invalid amount', 400); return;
  }
  if (numAmount < 10) {
    sendError(res, 'Minimum deposit is $10', 400); return;
  }
  if (!transactionId || !transactionId.trim()) {
    sendError(res, 'Transaction ID is required', 400); return;
  }
  if (!screenshotUrl || !screenshotUrl.trim()) {
    sendError(res, 'Screenshot URL is required', 400); return;
  }

  const userId = req.user!.userId;

  // Prevent duplicate transaction IDs
  const existing = await prisma.depositRequest.findFirst({ where: { transactionId: transactionId.trim() } });
  if (existing) {
    sendError(res, 'A deposit request with this transaction ID already exists', 409); return;
  }

  const request = await prisma.depositRequest.create({
    data: {
      userId,
      amount: numAmount,
      transactionId: transactionId.trim(),
      screenshotUrl: screenshotUrl.trim(),
      senderName: senderName?.trim() || null,
      senderBank: senderBank?.trim() || null,
      status: 'pending',
    },
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
  });

  sendSuccess(res, request, 'Deposit request submitted. It will be reviewed within 1–24 hours.');
}

// ─── Get my deposit requests ───────────────────────────────────────────────────

export async function getMyDepositRequests(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { page, limit, skip } = getPagination(req);

  const [requests, total] = await prisma.$transaction([
    prisma.depositRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.depositRequest.count({ where: { userId } }),
  ]);

  sendSuccess(res, buildPaginatedResult(requests, total, { page, limit, skip }));
}

// ─── Admin: list all deposit requests ─────────────────────────────────────────

export async function adminListDepositRequests(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (req.user!.role !== 'admin') { sendError(res, 'Forbidden', 403); return; }

  const { page, limit, skip } = getPagination(req);
  const { status } = req.query;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  const [requests, total] = await prisma.$transaction([
    prisma.depositRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    }),
    prisma.depositRequest.count({ where }),
  ]);

  sendSuccess(res, buildPaginatedResult(requests, total, { page, limit, skip }));
}

// ─── Admin: approve or reject a deposit request ────────────────────────────────

export async function adminReviewDepositRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (req.user!.role !== 'admin') { sendError(res, 'Forbidden', 403); return; }

  const { id } = req.params;
  const { action, adminNote } = req.body;  // action: 'approve' | 'reject'

  if (!['approve', 'reject'].includes(action)) {
    sendError(res, 'Action must be approve or reject', 400); return;
  }

  const depositRequest = await prisma.depositRequest.findUnique({
    where: { id },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
  });
  if (!depositRequest) { sendNotFound(res, 'Deposit request'); return; }
  if (depositRequest.status !== 'pending') {
    sendError(res, 'This request has already been reviewed', 400); return;
  }

  const reviewedAt = new Date();
  const reviewedBy = req.user!.userId;
  const userId = depositRequest.userId;
  const { user } = depositRequest;
  const userName = `${user.firstName} ${user.lastName}`;

  if (action === 'approve') {
    // Atomically update status + credit wallet + create transaction record
    const [updated] = await prisma.$transaction([
      prisma.depositRequest.update({
        where: { id },
        data: { status: 'approved', adminNote: adminNote || null, reviewedBy, reviewedAt },
      }),
      prisma.wallet.upsert({
        where: { userId },
        create: {
          userId,
          balance: depositRequest.amount,
          pendingBalance: 0,
          totalEarned: depositRequest.amount,
        },
        update: {
          balance: { increment: depositRequest.amount },
          totalEarned: { increment: depositRequest.amount },
        },
      }),
      prisma.transaction.create({
        data: {
          userId,
          type: 'credit',
          amount: depositRequest.amount,
          status: 'completed',
          description: `Bank transfer deposit approved (Ref: ${depositRequest.transactionId})`,
          metadata: JSON.stringify({
            depositRequestId: depositRequest.id,
            transactionId: depositRequest.transactionId,
            reviewedBy,
          }),
        },
      }),
    ]);

    // Push notification (non-blocking)
    userWantsPush(userId, 'wallet').then(wants => {
      if (wants) sendPushToUser(userId, {
        title: 'Deposit Approved ✅',
        body: `$${depositRequest.amount.toFixed(2)} has been added to your wallet`,
        url: '/wallet',
      }).catch(() => {});
    }).catch(() => {});

    // Email notification (non-blocking)
    sendDepositApprovedEmail({
      recipientEmail: user.email,
      recipientName: userName,
      amount: depositRequest.amount,
      transactionId: depositRequest.transactionId,
      adminNote: adminNote || undefined,
    }).catch(() => {});

    sendSuccess(res, updated, `$${depositRequest.amount.toFixed(2)} credited to user's wallet.`);
  } else {
    // Reject — just update status
    const updated = await prisma.depositRequest.update({
      where: { id },
      data: { status: 'rejected', adminNote: adminNote || null, reviewedBy, reviewedAt },
    });

    // Push notification (non-blocking)
    userWantsPush(userId, 'wallet').then(wants => {
      if (wants) sendPushToUser(userId, {
        title: 'Deposit Request Declined',
        body: `Your deposit of $${depositRequest.amount.toFixed(2)} could not be verified`,
        url: '/wallet',
      }).catch(() => {});
    }).catch(() => {});

    // Email notification (non-blocking)
    sendDepositRejectedEmail({
      recipientEmail: user.email,
      recipientName: userName,
      amount: depositRequest.amount,
      transactionId: depositRequest.transactionId,
      adminNote: adminNote || undefined,
    }).catch(() => {});

    sendSuccess(res, updated, 'Deposit request rejected.');
  }
}
