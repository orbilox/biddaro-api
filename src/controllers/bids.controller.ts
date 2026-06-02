import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden } from '../utils/response';
import { getPagination, buildPaginatedResult } from '../utils/pagination';
import { sendBidReceivedEmail, sendBidAcceptedEmail } from '../utils/email';
import { sendPushToUser, userWantsPush } from '../utils/push';
import { getConnectCost } from '../utils/connectCost';
import type { AuthenticatedRequest } from '../types';

const BID_INCLUDE = {
  contractor: {
    select: {
      id: true, firstName: true, lastName: true, profileImage: true,
      isVerified: true, yearsExperience: true, rating: true, location: true,
    },
  },
  job: {
    select: {
      id: true, title: true, budget: true, budgetType: true, currency: true,
      location: true, category: true, status: true, posterId: true,
      poster: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
    },
  },
};

// ─── JSON helpers ─────────────────────────────────────────────────────────────

function tryParse(val: string | null | undefined): unknown {
  if (!val) return [];
  try { return JSON.parse(val); } catch { return val; }
}

function parseBidData(bid: Record<string, unknown>): Record<string, unknown> {
  return {
    ...bid,
    documents:    tryParse(bid.documents    as string | null),
    milestones:   tryParse(bid.milestones   as string | null),
    portfolio:    tryParse(bid.portfolio    as string | null),
    certificates: tryParse(bid.certificates as string | null),
  };
}

// ─── Submit a bid ─────────────────────────────────────────────────────────────

export async function createBid(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { jobId } = req.params;
  const { amount, estimatedDays, proposal, portfolio, certificates, documents, milestones, isPriority } = req.body;

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) { sendNotFound(res, 'Job'); return; }
  if (job.status !== 'open') { sendError(res, 'This job is not accepting bids', 400); return; }
  if (job.posterId === req.user!.userId) { sendError(res, 'Cannot bid on your own job', 400); return; }

  // Check if already bid
  const existing = await prisma.bid.findFirst({
    where: { jobId, contractorId: req.user!.userId, status: { not: 'withdrawn' } },
  });
  if (existing) { sendError(res, 'You have already placed a bid on this job', 409); return; }

  // ── Connect check & atomic deduction ──────────────────────────────────────
  const connectCost = getConnectCost(job.budget, job.budgetType ?? 'fixed', job.currency ?? 'USD', isPriority === true);

  let bid;
  try {
    bid = await prisma.$transaction(async (tx) => {
      // Re-read inside transaction to prevent race conditions
      const contractor = await tx.user.findUnique({
        where: { id: req.user!.userId },
        select: { connectsBalance: true },
      });
      if (!contractor || contractor.connectsBalance < connectCost) {
        throw new Error('INSUFFICIENT_CONNECTS');
      }

      const createdBid = await tx.bid.create({
        data: {
          jobId,
          contractorId: req.user!.userId,
          amount: parseFloat(amount),
          estimatedDays: estimatedDays ? parseInt(estimatedDays) : undefined,
          proposal,
          portfolio:    portfolio    ? JSON.stringify(portfolio)    : undefined,
          certificates: certificates ? JSON.stringify(certificates) : undefined,
          documents:  Array.isArray(documents)  && documents.length  > 0 ? JSON.stringify(documents)  : undefined,
          milestones: Array.isArray(milestones) && milestones.length > 0 ? JSON.stringify(milestones) : undefined,
          isPriority: isPriority === true,
          connectCost,
        },
        include: BID_INCLUDE,
      });

      await tx.user.update({
        where: { id: req.user!.userId },
        data: { connectsBalance: { decrement: connectCost } },
      });

      await tx.connectTransaction.create({
        data: {
          userId: req.user!.userId,
          type: 'debit',
          amount: connectCost,
          bidId: createdBid.id,
          description: `Used ${connectCost} connects to bid on "${job.title}"`,
        },
      });

      return createdBid;
    });
  } catch (err: unknown) {
    if ((err as Error).message === 'INSUFFICIENT_CONNECTS') {
      sendError(
        res,
        `Insufficient connects. You need ${connectCost} connects to bid on this job.`,
        402,
      );
      return;
    }
    throw err;
  }

  // Notify job poster
  await createNotification(
    job.posterId, 'bid_received',
    'New Bid Received',
    `${bid.contractor.firstName} ${bid.contractor.lastName} submitted a bid of $${amount} on your job "${job.title}"`,
    { bidId: bid.id, jobId },
  );

  // Fire-and-forget: email poster about new bid
  prisma.user.findUnique({ where: { id: job.posterId }, select: { email: true, firstName: true } })
    .then(poster => {
      if (poster) return sendBidReceivedEmail({
        posterEmail: poster.email, posterName: poster.firstName,
        contractorName: `${bid.contractor.firstName} ${bid.contractor.lastName}`,
        jobTitle: job.title, bidAmount: bid.amount, jobId,
      });
    }).catch(err => console.error('[EMAIL] bid_received:', err));

  sendCreated(res, parseBidData(bid as unknown as Record<string, unknown>), 'Bid submitted successfully');
}

// ─── Get bids for a job ───────────────────────────────────────────────────────

export async function getJobBids(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { jobId } = req.params;
  const { page, limit, skip } = getPagination(req);

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) { sendNotFound(res, 'Job'); return; }

  // Only poster can see all bids; others see count only
  if (req.user?.userId !== job.posterId) {
    const count = await prisma.bid.count({ where: { jobId } });
    sendSuccess(res, { bidCount: count });
    return;
  }

  const [bids, total] = await prisma.$transaction([
    prisma.bid.findMany({ where: { jobId }, skip, take: limit, orderBy: { createdAt: 'desc' }, include: BID_INCLUDE }),
    prisma.bid.count({ where: { jobId } }),
  ]);

  const parsed = bids.map(b => parseBidData(b as unknown as Record<string, unknown>));
  sendSuccess(res, buildPaginatedResult(parsed, total, { page, limit, skip }));
}

// ─── Get bids received on poster's jobs ───────────────────────────────────────

export async function getReceivedBids(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { page, limit, skip } = getPagination(req);
  const { status } = req.query;

  const where: Record<string, unknown> = { job: { posterId: req.user!.userId } };
  if (status) where.status = status;

  const [bids, total] = await prisma.$transaction([
    prisma.bid.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: BID_INCLUDE }),
    prisma.bid.count({ where }),
  ]);

  const parsed = bids.map(b => parseBidData(b as unknown as Record<string, unknown>));
  sendSuccess(res, buildPaginatedResult(parsed, total, { page, limit, skip }));
}

// ─── Get my bids ──────────────────────────────────────────────────────────────

export async function getMyBids(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { page, limit, skip } = getPagination(req);
  const { status } = req.query;

  const where: Record<string, unknown> = { contractorId: req.user!.userId };
  if (status) where.status = status;

  const [bids, total] = await prisma.$transaction([
    prisma.bid.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: BID_INCLUDE }),
    prisma.bid.count({ where }),
  ]);

  const parsed = bids.map(b => parseBidData(b as unknown as Record<string, unknown>));
  sendSuccess(res, buildPaginatedResult(parsed, total, { page, limit, skip }));
}

// ─── Accept a bid ─────────────────────────────────────────────────────────────

export async function acceptBid(req: AuthenticatedRequest, res: Response): Promise<void> {
  const bid = await prisma.bid.findUnique({ where: { id: req.params.id }, include: { job: true, contractor: true } });
  if (!bid) { sendNotFound(res, 'Bid'); return; }
  if (bid.job.posterId !== req.user!.userId) { sendForbidden(res); return; }
  if (bid.status !== 'pending') { sendError(res, 'Bid is no longer pending', 400); return; }

  // Check no existing contract for this job
  const existingContract = await prisma.contract.findFirst({ where: { jobId: bid.jobId } });
  if (existingContract) { sendError(res, 'A contract already exists for this job', 400); return; }

  // Create contract + update statuses in a transaction
  const [contract] = await prisma.$transaction([
    prisma.contract.create({
      data: {
        jobId: bid.jobId,
        bidId: bid.id,
        posterId: bid.job.posterId,
        contractorId: bid.contractorId,
        totalAmount: bid.amount,
        currency: bid.currency,
        status: 'active',
        signedByPoster: new Date(),
        // Copy bid milestones → contract milestones, each with status: 'pending'
        milestones: bid.milestones
          ? JSON.stringify(
              (JSON.parse(bid.milestones) as Array<Record<string, unknown>>).map(
                (m) => ({ ...m, status: 'pending' })
              )
            )
          : undefined,
      },
      include: { job: true, contractor: true, poster: true },
    }),
    prisma.bid.update({ where: { id: bid.id }, data: { status: 'accepted' } }),
    // Decline all other pending bids
    prisma.bid.updateMany({
      where: { jobId: bid.jobId, id: { not: bid.id }, status: 'pending' },
      data: { status: 'declined' },
    }),
    prisma.job.update({ where: { id: bid.jobId }, data: { status: 'in_progress' } }),
  ]);

  // Refund connects for all auto-declined bidders (fire-and-forget)
  prisma.bid.findMany({
    where: { jobId: bid.jobId, id: { not: bid.id }, status: 'declined' },
    select: { id: true, contractorId: true, connectCost: true },
  }).then(async (declined) => {
    if (declined.length === 0) return;
    const jobForCost = bid.job as unknown as { budget: number; budgetType: string; currency: string };
    const fallbackCost = getConnectCost(
      jobForCost.budget,
      jobForCost.budgetType ?? 'fixed',
      jobForCost.currency ?? 'USD',
    );
    await prisma.$transaction([
      ...declined.map(b => prisma.user.update({
        where: { id: b.contractorId },
        data: { connectsBalance: { increment: (b as any).connectCost || fallbackCost } },
      })),
      ...declined.map(b => prisma.connectTransaction.create({
        data: {
          userId: b.contractorId,
          type: 'refund',
          amount: (b as any).connectCost || fallbackCost,
          bidId: b.id,
          description: `Connects refunded: another contractor was selected for "${bid.job.title}"`,
        },
      })),
    ]);
    // Notify each declined bidder about their refund
    for (const b of declined) {
      const cost = (b as any).connectCost || fallbackCost;
      await createNotification(
        b.contractorId, 'connects_refunded',
        'Connects Refunded',
        `${cost} connects were refunded to your account — another contractor was selected for "${bid.job.title}".`,
        { jobId: bid.jobId },
      );
    }
  }).catch(err => console.error('[Connects] auto-decline refund failed:', err));

  // Notify contractor
  await createNotification(
    bid.contractorId, 'bid_accepted',
    'Bid Accepted! 🎉',
    `Your bid of $${bid.amount} for "${bid.job.title}" has been accepted. A contract has been created.`,
    { contractId: contract.id, jobId: bid.jobId },
  );

  // Fire-and-forget: email contractor about accepted bid
  Promise.all([
    prisma.user.findUnique({ where: { id: bid.contractorId }, select: { email: true } }),
    prisma.user.findUnique({ where: { id: bid.job.posterId }, select: { firstName: true, lastName: true } }),
  ]).then(([contractor, poster]) => {
    if (contractor) return sendBidAcceptedEmail({
      contractorEmail: contractor.email,
      contractorName: `${bid.contractor.firstName} ${bid.contractor.lastName}`,
      posterName: poster ? `${poster.firstName} ${poster.lastName}` : 'Client',
      jobTitle: bid.job.title, contractId: contract.id, amount: bid.amount,
    });
  }).catch(err => console.error('[EMAIL] bid_accepted:', err));

  sendSuccess(res, contract, 'Bid accepted and contract created');
}

// ─── Decline a bid ────────────────────────────────────────────────────────────

export async function declineBid(req: AuthenticatedRequest, res: Response): Promise<void> {
  const bid = await prisma.bid.findUnique({ where: { id: req.params.id }, include: { job: true } });
  if (!bid) { sendNotFound(res, 'Bid'); return; }
  if (bid.job.posterId !== req.user!.userId) { sendForbidden(res); return; }
  if (bid.status !== 'pending') { sendError(res, 'Bid is not pending', 400); return; }

  await prisma.bid.update({ where: { id: bid.id }, data: { status: 'declined' } });

  // Auto-refund connects when poster declines
  let refundCost = 0;
  try {
    refundCost = (bid as any).connectCost || getConnectCost(
      bid.job.budget,
      (bid.job as Record<string, unknown>).budgetType as string ?? 'fixed',
      (bid.job as Record<string, unknown>).currency as string ?? 'USD',
    );
    await prisma.$transaction([
      prisma.user.update({
        where: { id: bid.contractorId },
        data: { connectsBalance: { increment: refundCost } },
      }),
      prisma.connectTransaction.create({
        data: {
          userId: bid.contractorId,
          type: 'refund',
          amount: refundCost,
          bidId: bid.id,
          description: `Connects refunded: bid declined for "${bid.job.title}"`,
        },
      }),
    ]);
  } catch (refundErr) {
    console.error('[Connects] refund on decline failed:', refundErr);
  }

  await createNotification(
    bid.contractorId, 'bid_declined',
    'Bid Declined',
    `Your bid for "${bid.job.title}" was not selected this time.`,
    { jobId: bid.jobId },
  );

  if (refundCost > 0) {
    await createNotification(
      bid.contractorId, 'connects_refunded',
      'Connects Refunded',
      `${refundCost} connects were refunded to your account after your bid on "${bid.job.title}" was declined.`,
      { jobId: bid.jobId },
    );
  }

  sendSuccess(res, null, 'Bid declined');
}

// ─── Bid insights for a job poster ───────────────────────────────────────────

export async function getBidInsights(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { jobId } = req.params;

  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, posterId: true, budget: true, createdAt: true } });
  if (!job) { sendNotFound(res, 'Job'); return; }
  if (job.posterId !== req.user!.userId) { sendForbidden(res); return; }

  const bids = await prisma.bid.findMany({
    where: { jobId, status: { not: 'withdrawn' } },
    select: { amount: true, createdAt: true, isPriority: true },
    orderBy: { createdAt: 'asc' },
  });

  if (bids.length === 0) {
    sendSuccess(res, {
      totalBids: 0,
      avgAmount: null,
      minAmount: null,
      maxAmount: null,
      fastestResponseMins: null,
      budgetVsAvg: null,
      priorityBids: 0,
    });
    return;
  }

  const amounts = bids.map(b => Number(b.amount));
  const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const minAmount = Math.min(...amounts);
  const maxAmount = Math.max(...amounts);

  // Minutes from job post to first bid
  const fastestResponseMins = Math.round(
    (bids[0].createdAt.getTime() - job.createdAt.getTime()) / 60_000,
  );

  // Positive = budget exceeds avg bid (contractor-friendly); negative = under budget
  const budgetVsAvg = job.budget
    ? Math.round(((Number(job.budget) - avgAmount) / avgAmount) * 1000) / 10
    : null;

  sendSuccess(res, {
    totalBids: bids.length,
    avgAmount: Math.round(avgAmount * 100) / 100,
    minAmount,
    maxAmount,
    fastestResponseMins,
    budgetVsAvg,
    priorityBids: bids.filter(b => b.isPriority).length,
  });
}

// ─── Withdraw a bid ───────────────────────────────────────────────────────────

export async function withdrawBid(req: AuthenticatedRequest, res: Response): Promise<void> {
  const bid = await prisma.bid.findUnique({
    where: { id: req.params.id },
    include: { job: { select: { title: true, budget: true, budgetType: true, currency: true } } },
  });
  if (!bid) { sendNotFound(res, 'Bid'); return; }
  if (bid.contractorId !== req.user!.userId) { sendForbidden(res); return; }
  if (bid.status !== 'pending') { sendError(res, 'Can only withdraw a pending bid', 400); return; }

  const now = new Date();
  const bidAge = (now.getTime() - bid.createdAt.getTime()) / 1000 / 60; // minutes
  const fullCost = (bid as any).connectCost || getConnectCost(
    (bid.job as any).budget, (bid.job as any).budgetType ?? 'fixed', (bid.job as any).currency ?? 'USD',
  );
  // Full refund within 60 minutes; 50% refund after
  const refundAmount = bidAge <= 60 ? fullCost : Math.floor(fullCost / 2);

  await prisma.$transaction([
    prisma.bid.update({ where: { id: bid.id }, data: { status: 'withdrawn', withdrawnAt: now } }),
    prisma.user.update({ where: { id: req.user!.userId }, data: { connectsBalance: { increment: refundAmount } } }),
    prisma.connectTransaction.create({
      data: {
        userId: req.user!.userId,
        type: 'refund',
        amount: refundAmount,
        bidId: bid.id,
        description: bidAge <= 60
          ? `Full refund: bid withdrawn within 1 hour for "${(bid.job as any).title}"`
          : `Partial refund (50%): bid withdrawn for "${(bid.job as any).title}"`,
      },
    }),
  ]);
  sendSuccess(res, { refunded: refundAmount }, `Bid withdrawn — ${refundAmount} connects refunded`);
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  data?: Record<string, unknown>,
) {
  await prisma.notification.create({
    data: { userId, type, title, message, data: data ? JSON.stringify(data) : undefined },
  }).catch(() => {});
  // Push — respect user's bids notification preference
  userWantsPush(userId, 'bids').then(wants => {
    if (wants) sendPushToUser(userId, { title, body: message, url: data?.url as string | undefined }).catch(() => {});
  }).catch(() => {});
}
