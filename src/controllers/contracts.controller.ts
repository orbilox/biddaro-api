import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError, sendNotFound, sendForbidden } from '../utils/response';
import { getPagination, buildPaginatedResult } from '../utils/pagination';
import { config } from '../config';
import type { AuthenticatedRequest } from '../types';

function tryParse(val: unknown) {
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch { return val; }
}

const CONTRACT_INCLUDE = {
  job: { select: { id: true, title: true, category: true, location: true } },
  contractor: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
  poster: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
};

// ─── List my contracts ────────────────────────────────────────────────────────

export async function getMyContracts(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { page, limit, skip } = getPagination(req);
  const { status } = req.query;
  const userId = req.user!.userId;

  const where: Record<string, unknown> = {
    OR: [{ posterId: userId }, { contractorId: userId }],
  };
  if (status) where.status = status;

  const [contracts, total] = await prisma.$transaction([
    prisma.contract.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: CONTRACT_INCLUDE }),
    prisma.contract.count({ where }),
  ]);

  const parsed = contracts.map((c) => ({ ...c, milestones: tryParse(c.milestones) }));
  sendSuccess(res, buildPaginatedResult(parsed, total, { page, limit, skip }));
}

// ─── Get single contract ──────────────────────────────────────────────────────

export async function getContract(req: AuthenticatedRequest, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { id: req.params.id },
    include: {
      ...CONTRACT_INCLUDE,
      bid: { select: { id: true, amount: true, estimatedDays: true, proposal: true } },
      transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
      dispute: true,
      review: true,
    },
  });
  if (!contract) { sendNotFound(res, 'Contract'); return; }

  const userId = req.user!.userId;
  if (contract.posterId !== userId && contract.contractorId !== userId) { sendForbidden(res); return; }

  sendSuccess(res, { ...contract, milestones: tryParse(contract.milestones) });
}

// ─── Update milestones ────────────────────────────────────────────────────────

export async function updateMilestones(req: AuthenticatedRequest, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) { sendNotFound(res, 'Contract'); return; }

  const userId = req.user!.userId;
  if (contract.posterId !== userId && contract.contractorId !== userId) { sendForbidden(res); return; }
  if (contract.status !== 'active') { sendError(res, 'Contract is not active', 400); return; }

  const { milestones } = req.body;
  const updated = await prisma.contract.update({
    where: { id: contract.id },
    data: { milestones: JSON.stringify(milestones) },
  });

  sendSuccess(res, { ...updated, milestones }, 'Milestones updated');
}

// ─── Mark milestone complete ──────────────────────────────────────────────────

export async function completeMilestone(req: AuthenticatedRequest, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) { sendNotFound(res, 'Contract'); return; }
  if (contract.contractorId !== req.user!.userId) { sendForbidden(res); return; }
  if (contract.status !== 'active') { sendError(res, 'Contract is not active', 400); return; }

  const milestones: Array<Record<string, unknown>> = tryParse(contract.milestones) || [];
  const { milestoneIndex } = req.body;

  if (milestoneIndex === undefined || milestoneIndex < 0 || milestoneIndex >= milestones.length) {
    sendError(res, 'Invalid milestone index', 400); return;
  }

  milestones[milestoneIndex] = { ...milestones[milestoneIndex], status: 'completed', completedAt: new Date().toISOString() };

  const updated = await prisma.contract.update({
    where: { id: contract.id },
    data: { milestones: JSON.stringify(milestones) },
  });

  await notify(contract.posterId, 'milestone_completed',
    'Milestone Completed',
    `A milestone has been marked complete on your contract.`,
    { contractId: contract.id });

  sendSuccess(res, { ...updated, milestones }, 'Milestone marked complete');
}

// ─── Complete contract ────────────────────────────────────────────────────────

export async function completeContract(req: AuthenticatedRequest, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { id: req.params.id },
    include: { contractor: true, poster: true },
  });
  if (!contract) { sendNotFound(res, 'Contract'); return; }
  if (contract.posterId !== req.user!.userId) { sendForbidden(res); return; }
  if (contract.status !== 'active') { sendError(res, 'Contract is not active', 400); return; }

  const feePercent = config.platform.feePercent;
  const platformFee = Number(contract.totalAmount) * (feePercent / 100);
  const contractorPayout = Number(contract.totalAmount) - platformFee;

  await prisma.$transaction([
    prisma.contract.update({
      where: { id: contract.id },
      data: { status: 'completed', completedAt: new Date() },
    }),
    prisma.job.update({ where: { id: contract.jobId }, data: { status: 'completed' } }),
    // Credit contractor wallet
    prisma.wallet.upsert({
      where: { userId: contract.contractorId },
      create: { userId: contract.contractorId, balance: contractorPayout, totalEarned: contractorPayout },
      update: { balance: { increment: contractorPayout }, totalEarned: { increment: contractorPayout } },
    }),
    // Create transaction record
    prisma.transaction.create({
      data: {
        contractId: contract.id,
        userId: contract.contractorId,
        type: 'credit',
        amount: contractorPayout,
        description: `Payment for contract #${contract.id.slice(-6)}`,
        status: 'completed',
      },
    }),
  ]);

  await notify(contract.contractorId, 'contract_completed',
    'Contract Completed! 🎉',
    `Your contract has been completed. $${contractorPayout.toFixed(2)} has been added to your wallet.`,
    { contractId: contract.id });

  sendSuccess(res, null, 'Contract completed');
}

// ─── Cancel contract ──────────────────────────────────────────────────────────

export async function cancelContract(req: AuthenticatedRequest, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) { sendNotFound(res, 'Contract'); return; }

  const userId = req.user!.userId;
  if (contract.posterId !== userId && contract.contractorId !== userId) { sendForbidden(res); return; }
  if (!['active', 'pending'].includes(contract.status)) { sendError(res, 'Cannot cancel this contract', 400); return; }

  const otherId = userId === contract.posterId ? contract.contractorId : contract.posterId;

  await prisma.$transaction([
    prisma.contract.update({ where: { id: contract.id }, data: { status: 'cancelled' } }),
    prisma.job.update({ where: { id: contract.jobId }, data: { status: 'open' } }),
  ]);

  await notify(otherId, 'contract_cancelled', 'Contract Cancelled',
    `A contract has been cancelled.`, { contractId: contract.id });

  sendSuccess(res, null, 'Contract cancelled');
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function notify(userId: string, type: string, title: string, message: string, data?: Record<string, unknown>) {
  await prisma.notification.create({
    data: { userId, type, title, message, data: data ? JSON.stringify(data) : undefined },
  }).catch(() => {});
}
