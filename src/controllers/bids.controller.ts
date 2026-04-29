import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden } from '../utils/response';
import { getPagination, buildPaginatedResult } from '../utils/pagination';
import { sendBidReceivedEmail, sendBidAcceptedEmail } from '../utils/email';
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
      id: true, title: true, budget: true, location: true, category: true, status: true, posterId: true,
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

  const bid = await prisma.bid.create({
    data: {
      jobId,
      contractorId: req.user!.userId,
      amount: parseFloat(amount),
      estimatedDays: estimatedDays ? parseInt(estimatedDays) : undefined,
      proposal,
      portfolio:    portfolio    ? JSON.stringify(portfolio)    : undefined,
      certificates: certificates ? JSON.stringify(certificates) : undefined,
      // New fields: store arrays as JSON strings
      documents:  Array.isArray(documents)  && documents.length  > 0 ? JSON.stringify(documents)  : undefined,
      milestones: Array.isArray(milestones) && milestones.length > 0 ? JSON.stringify(milestones) : undefined,
      isPriority: isPriority === true,
    },
    include: BID_INCLUDE,
  });

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

  await createNotification(
    bid.contractorId, 'bid_declined',
    'Bid Declined',
    `Your bid for "${bid.job.title}" was not selected this time.`,
    { jobId: bid.jobId },
  );

  sendSuccess(res, null, 'Bid declined');
}

// ─── Withdraw a bid ───────────────────────────────────────────────────────────

export async function withdrawBid(req: AuthenticatedRequest, res: Response): Promise<void> {
  const bid = await prisma.bid.findUnique({ where: { id: req.params.id } });
  if (!bid) { sendNotFound(res, 'Bid'); return; }
  if (bid.contractorId !== req.user!.userId) { sendForbidden(res); return; }
  if (bid.status !== 'pending') { sendError(res, 'Can only withdraw a pending bid', 400); return; }

  await prisma.bid.update({ where: { id: bid.id }, data: { status: 'withdrawn' } });
  sendSuccess(res, null, 'Bid withdrawn');
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
}
