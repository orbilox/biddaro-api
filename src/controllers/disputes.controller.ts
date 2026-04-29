import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden } from '../utils/response';
import { getPagination, buildPaginatedResult } from '../utils/pagination';
import { sendDisputeOpenedEmail } from '../utils/email';
import type { AuthenticatedRequest } from '../types';

const DISPUTE_INCLUDE = {
  raisedBy: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
  contract: {
    select: {
      id: true,
      totalAmount: true,
      jobId: true,
      job: { select: { id: true, title: true } },
      posterId: true,
      contractorId: true,
    },
  },
};

// ─── Open a dispute ───────────────────────────────────────────────────────────

export async function openDispute(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { contractId, reason, description } = req.body;
  const userId = req.user!.userId;

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) { sendNotFound(res, 'Contract'); return; }
  if (contract.posterId !== userId && contract.contractorId !== userId) { sendForbidden(res); return; }
  if (contract.status !== 'active') { sendError(res, 'Disputes can only be opened on active contracts', 400); return; }

  // Only one open dispute per contract
  const existing = await prisma.dispute.findFirst({
    where: { contractId, status: { in: ['open', 'under_review'] } },
  });
  if (existing) { sendError(res, 'A dispute is already open for this contract', 409); return; }

  const dispute = await prisma.dispute.create({
    data: {
      contractId,
      jobId: contract.jobId,
      raisedById: userId,
      reason,
      description,
      amount: contract.totalAmount,
    },
    include: DISPUTE_INCLUDE,
  });

  // Update contract status
  await prisma.contract.update({ where: { id: contractId }, data: { status: 'disputed' } });

  // Notify the other party
  const otherId = userId === contract.posterId ? contract.contractorId : contract.posterId;
  await notify(otherId, 'dispute_opened', 'Dispute Opened',
    `A dispute has been raised on your contract.`, { disputeId: dispute.id });

  // Fire-and-forget: email other party about dispute
  prisma.user.findUnique({ where: { id: otherId }, select: { email: true, firstName: true } })
    .then(other => {
      if (other) return sendDisputeOpenedEmail({
        recipientEmail: other.email, recipientName: other.firstName,
        raisedByName: `${dispute.raisedBy.firstName} ${dispute.raisedBy.lastName}`,
        jobTitle: dispute.contract.job.title,
        contractId: dispute.contract.id,
      });
    }).catch(err => console.error('[EMAIL] dispute_opened:', err));

  sendCreated(res, dispute, 'Dispute opened');
}

// ─── Get my disputes ──────────────────────────────────────────────────────────

export async function getMyDisputes(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { page, limit, skip } = getPagination(req);
  const { status } = req.query;
  const userId = req.user!.userId;

  const where: Record<string, unknown> = {
    OR: [
      { raisedById: userId },
      { contract: { OR: [{ posterId: userId }, { contractorId: userId }] } },
    ],
  };
  if (status) where.status = status;

  const [disputes, total] = await prisma.$transaction([
    prisma.dispute.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: DISPUTE_INCLUDE }),
    prisma.dispute.count({ where }),
  ]);

  sendSuccess(res, buildPaginatedResult(disputes, total, { page, limit, skip }));
}

// ─── Get single dispute ───────────────────────────────────────────────────────

export async function getDispute(req: AuthenticatedRequest, res: Response): Promise<void> {
  const dispute = await prisma.dispute.findUnique({
    where: { id: req.params.id },
    include: DISPUTE_INCLUDE,
  });
  if (!dispute) { sendNotFound(res, 'Dispute'); return; }

  const userId = req.user!.userId;
  const isParty = dispute.raisedById === userId ||
    dispute.contract.posterId === userId ||
    dispute.contract.contractorId === userId;

  if (!isParty) { sendForbidden(res); return; }

  sendSuccess(res, dispute);
}

// ─── Respond to dispute ───────────────────────────────────────────────────────

export async function respondToDispute(req: AuthenticatedRequest, res: Response): Promise<void> {
  const dispute = await prisma.dispute.findUnique({
    where: { id: req.params.id },
    include: { contract: true },
  });
  if (!dispute) { sendNotFound(res, 'Dispute'); return; }

  const userId = req.user!.userId;
  const isParty = dispute.raisedById === userId ||
    dispute.contract.posterId === userId ||
    dispute.contract.contractorId === userId;

  if (!isParty) { sendForbidden(res); return; }
  if (!['open', 'under_review'].includes(dispute.status)) {
    sendError(res, 'Dispute is no longer active', 400); return;
  }

  const { response } = req.body;

  const updated = await prisma.dispute.update({
    where: { id: dispute.id },
    data: {
      response,
      status: 'under_review',
      respondedAt: new Date(),
    },
    include: DISPUTE_INCLUDE,
  });

  // Notify admin/other party
  const otherId = userId === dispute.raisedById
    ? (dispute.contract.posterId === userId ? dispute.contract.contractorId : dispute.contract.posterId)
    : dispute.raisedById;

  await notify(otherId, 'dispute_response', 'Dispute Response',
    `A response has been submitted to the dispute.`, { disputeId: dispute.id });

  sendSuccess(res, updated, 'Response submitted');
}

// ─── Resolve dispute (admin) ──────────────────────────────────────────────────

export async function resolveDispute(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (req.user!.role !== 'admin') { sendForbidden(res); return; }

  const dispute = await prisma.dispute.findUnique({
    where: { id: req.params.id },
    include: { contract: true },
  });
  if (!dispute) { sendNotFound(res, 'Dispute'); return; }
  if (dispute.status === 'resolved') { sendError(res, 'Dispute already resolved', 400); return; }

  const { resolution, refundAmount } = req.body;

  await prisma.$transaction([
    prisma.dispute.update({
      where: { id: dispute.id },
      data: { status: 'resolved', resolution, resolvedAt: new Date(), resolvedById: req.user!.userId },
    }),
    prisma.contract.update({
      where: { id: dispute.contractId },
      data: { status: refundAmount > 0 ? 'cancelled' : 'completed' },
    }),
  ]);

  // Notify both parties
  await Promise.all([
    notify(dispute.raisedById, 'dispute_resolved', 'Dispute Resolved',
      `Your dispute has been resolved.`, { disputeId: dispute.id }),
    notify(
      dispute.contract.posterId === dispute.raisedById ? dispute.contract.contractorId : dispute.contract.posterId,
      'dispute_resolved', 'Dispute Resolved', `A dispute has been resolved.`, { disputeId: dispute.id }
    ),
  ]);

  sendSuccess(res, null, 'Dispute resolved');
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function notify(userId: string, type: string, title: string, message: string, data?: Record<string, unknown>) {
  await prisma.notification.create({
    data: { userId, type, title, message, data: data ? JSON.stringify(data) : undefined },
  }).catch(() => {});
}
