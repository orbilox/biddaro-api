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

// ─── Fund escrow ──────────────────────────────────────────────────────────────
// Poster confirms they will pay the contract amount into escrow.
// In a real system this would charge a payment method; here we record the commitment.

export async function fundEscrow(req: AuthenticatedRequest, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) { sendNotFound(res, 'Contract'); return; }
  if (contract.posterId !== req.user!.userId) { sendForbidden(res); return; }
  if (contract.status !== 'active') { sendError(res, 'Contract is not active', 400); return; }
  if (contract.escrowFunded) { sendError(res, 'Escrow is already funded', 400); return; }

  await prisma.$transaction([
    prisma.contract.update({
      where: { id: contract.id },
      data: { escrowFunded: true, escrowAmount: contract.totalAmount },
    }),
    prisma.transaction.create({
      data: {
        userId: contract.posterId,
        contractId: contract.id,
        type: 'debit',
        amount: contract.totalAmount,
        description: `Escrow funded for contract #${contract.id.slice(-6)}`,
        status: 'completed',
        metadata: JSON.stringify({ type: 'escrow_fund' }),
      },
    }),
  ]);

  await notify(contract.contractorId, 'escrow_funded',
    'Escrow Funded 🔒',
    `The client has funded the escrow ($${Number(contract.totalAmount).toFixed(2)}). You can now start working!`,
    { contractId: contract.id });

  sendSuccess(res, null, 'Escrow funded successfully. Work can now begin.');
}

// ─── Start a milestone ────────────────────────────────────────────────────────
// Contractor marks a pending milestone as in_progress.

export async function startMilestone(req: AuthenticatedRequest, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) { sendNotFound(res, 'Contract'); return; }
  if (contract.contractorId !== req.user!.userId) { sendForbidden(res); return; }
  if (contract.status !== 'active') { sendError(res, 'Contract is not active', 400); return; }
  if (!contract.escrowFunded) { sendError(res, 'Cannot start work — escrow has not been funded by the client yet', 400); return; }

  const milestones: Array<Record<string, unknown>> = tryParse(contract.milestones) || [];
  const { milestoneIndex } = req.body;

  if (milestoneIndex === undefined || milestoneIndex < 0 || milestoneIndex >= milestones.length) {
    sendError(res, 'Invalid milestone index', 400); return;
  }
  if (milestones[milestoneIndex].status !== 'pending') {
    sendError(res, 'Only a pending milestone can be started', 400); return;
  }

  milestones[milestoneIndex] = {
    ...milestones[milestoneIndex],
    status: 'in_progress',
    startedAt: new Date().toISOString(),
  };

  const updated = await prisma.contract.update({
    where: { id: contract.id },
    data: { milestones: JSON.stringify(milestones) },
  });

  const title = milestones[milestoneIndex].title as string;
  await notify(contract.posterId, 'milestone_started',
    'Milestone Started',
    `Contractor has started work on milestone "${title}".`,
    { contractId: contract.id });

  sendSuccess(res, { ...updated, milestones }, 'Milestone started');
}

// ─── Submit milestone for review ──────────────────────────────────────────────
// Contractor completes a milestone and attaches proof documents.

export async function submitMilestone(req: AuthenticatedRequest, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) { sendNotFound(res, 'Contract'); return; }
  if (contract.contractorId !== req.user!.userId) { sendForbidden(res); return; }
  if (contract.status !== 'active') { sendError(res, 'Contract is not active', 400); return; }

  const milestones: Array<Record<string, unknown>> = tryParse(contract.milestones) || [];
  const { milestoneIndex, proofDocuments } = req.body;

  if (milestoneIndex === undefined || milestoneIndex < 0 || milestoneIndex >= milestones.length) {
    sendError(res, 'Invalid milestone index', 400); return;
  }
  if (milestones[milestoneIndex].status !== 'in_progress') {
    sendError(res, 'Milestone must be in progress before submitting', 400); return;
  }

  milestones[milestoneIndex] = {
    ...milestones[milestoneIndex],
    status: 'completed',
    completedAt: new Date().toISOString(),
    proofDocuments: Array.isArray(proofDocuments) ? proofDocuments : [],
  };

  const updated = await prisma.contract.update({
    where: { id: contract.id },
    data: { milestones: JSON.stringify(milestones) },
  });

  const mTitle = milestones[milestoneIndex].title as string;
  await notify(contract.posterId, 'milestone_completed',
    'Milestone Ready for Review 📋',
    `Milestone "${mTitle}" has been submitted for review. Please approve to release payment.`,
    { contractId: contract.id });

  sendSuccess(res, { ...updated, milestones }, 'Milestone submitted for review. Awaiting client approval.');
}

// ─── Approve milestone + release payment ─────────────────────────────────────
// Poster reviews proof docs, approves, and releases per-milestone payment from escrow.

export async function approveMilestone(req: AuthenticatedRequest, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) { sendNotFound(res, 'Contract'); return; }
  if (contract.posterId !== req.user!.userId) { sendForbidden(res); return; }
  if (contract.status !== 'active') { sendError(res, 'Contract is not active', 400); return; }
  if (!contract.escrowFunded) { sendError(res, 'Escrow not funded', 400); return; }

  const milestones: Array<Record<string, unknown>> = tryParse(contract.milestones) || [];
  const { milestoneIndex } = req.body;

  if (milestoneIndex === undefined || milestoneIndex < 0 || milestoneIndex >= milestones.length) {
    sendError(res, 'Invalid milestone index', 400); return;
  }
  if (milestones[milestoneIndex].status !== 'completed') {
    sendError(res, 'Milestone must be completed (submitted for review) before approving', 400); return;
  }

  const milestone = milestones[milestoneIndex];
  const milestoneAmount = Number(milestone.amount);
  const feePercent = config.platform.feePercent;
  const platformFee = milestoneAmount * (feePercent / 100);
  const contractorPayout = milestoneAmount - platformFee;

  milestones[milestoneIndex] = {
    ...milestone,
    status: 'approved',
    approvedAt: new Date().toISOString(),
  };

  const newReleasedAmount = Number(contract.releasedAmount) + milestoneAmount;
  const allApproved = milestones.every((m) => m.status === 'approved');

  // Run everything in a transaction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops: any[] = [
    prisma.contract.update({
      where: { id: contract.id },
      data: {
        milestones: JSON.stringify(milestones),
        releasedAmount: newReleasedAmount,
        ...(allApproved ? { status: 'completed', completedAt: new Date() } : {}),
      },
    }),
    // Credit contractor wallet (payout after fee)
    prisma.wallet.upsert({
      where: { userId: contract.contractorId },
      create: { userId: contract.contractorId, balance: contractorPayout, pendingBalance: 0, totalEarned: contractorPayout },
      update: { balance: { increment: contractorPayout }, totalEarned: { increment: contractorPayout } },
    }),
    // Contractor credit transaction
    prisma.transaction.create({
      data: {
        userId: contract.contractorId,
        contractId: contract.id,
        type: 'credit',
        amount: contractorPayout,
        description: `Milestone payment: ${milestone.title as string}`,
        status: 'completed',
        metadata: JSON.stringify({ milestoneIndex, milestoneTitle: milestone.title, grossAmount: milestoneAmount, fee: platformFee }),
      },
    }),
    // Fee transaction record
    prisma.transaction.create({
      data: {
        userId: contract.contractorId,
        contractId: contract.id,
        type: 'fee',
        amount: platformFee,
        description: `Platform fee (${feePercent}%) — ${milestone.title as string}`,
        status: 'completed',
        metadata: JSON.stringify({ milestoneIndex }),
      },
    }),
  ];

  if (allApproved) {
    ops.push(prisma.job.update({ where: { id: contract.jobId }, data: { status: 'completed' } }));
  }

  await prisma.$transaction(ops);

  const mTitle = milestone.title as string;
  await notify(contract.contractorId, 'payment_released',
    'Payment Released! 💰',
    `$${contractorPayout.toFixed(2)} has been released for milestone "${mTitle}".`,
    { contractId: contract.id });

  if (allApproved) {
    await notify(contract.contractorId, 'contract_completed',
      'Contract Completed! 🎉',
      'All milestones approved. Your contract is now complete.',
      { contractId: contract.id });
    await notify(contract.posterId, 'contract_completed',
      'Contract Completed 🎉',
      'All milestones have been approved. The contract is now complete.',
      { contractId: contract.id });
  }

  sendSuccess(res, null, `$${contractorPayout.toFixed(2)} released to contractor${allApproved ? ' — Contract completed!' : ''}`);
}

// ─── Update milestones ────────────────────────────────────────────────────────

export async function updateMilestones(req: AuthenticatedRequest, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) { sendNotFound(res, 'Contract'); return; }

  const userId = req.user!.userId;
  if (contract.posterId !== userId && contract.contractorId !== userId) { sendForbidden(res); return; }
  if (contract.status !== 'active') { sendError(res, 'Contract is not active', 400); return; }
  if (contract.escrowFunded) { sendError(res, 'Cannot edit milestones after escrow is funded', 400); return; }

  const { milestones } = req.body;
  const updated = await prisma.contract.update({
    where: { id: contract.id },
    data: { milestones: JSON.stringify(milestones) },
  });

  sendSuccess(res, { ...updated, milestones }, 'Milestones updated');
}

// ─── Complete contract (no-milestone contracts) ───────────────────────────────
// Poster marks the full contract complete and releases all funds at once.
// Used when the contract has no individual milestones.

export async function completeContract(req: AuthenticatedRequest, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { id: req.params.id },
    include: { contractor: true, poster: true },
  });
  if (!contract) { sendNotFound(res, 'Contract'); return; }
  if (contract.posterId !== req.user!.userId) { sendForbidden(res); return; }
  if (contract.status !== 'active') { sendError(res, 'Contract is not active', 400); return; }

  const milestones: Array<Record<string, unknown>> = tryParse(contract.milestones) || [];
  const hasMilestones = milestones.length > 0;
  if (hasMilestones) {
    sendError(res, 'This contract uses milestones. Approve each milestone to release payments.', 400); return;
  }

  const feePercent = config.platform.feePercent;
  const platformFee = Number(contract.totalAmount) * (feePercent / 100);
  const contractorPayout = Number(contract.totalAmount) - platformFee;

  await prisma.$transaction([
    prisma.contract.update({
      where: { id: contract.id },
      data: { status: 'completed', completedAt: new Date(), releasedAmount: contract.totalAmount },
    }),
    prisma.job.update({ where: { id: contract.jobId }, data: { status: 'completed' } }),
    prisma.wallet.upsert({
      where: { userId: contract.contractorId },
      create: { userId: contract.contractorId, balance: contractorPayout, totalEarned: contractorPayout, pendingBalance: 0 },
      update: { balance: { increment: contractorPayout }, totalEarned: { increment: contractorPayout } },
    }),
    prisma.transaction.create({
      data: {
        contractId: contract.id,
        userId: contract.contractorId,
        type: 'credit',
        amount: contractorPayout,
        description: `Full payment for contract #${contract.id.slice(-6)}`,
        status: 'completed',
      },
    }),
  ]);

  await notify(contract.contractorId, 'contract_completed',
    'Contract Completed! 🎉',
    `Your contract has been completed. $${contractorPayout.toFixed(2)} has been added to your wallet.`,
    { contractId: contract.id });

  sendSuccess(res, null, 'Contract completed and payment released');
}

// ─── Cancel contract ──────────────────────────────────────────────────────────

export async function cancelContract(req: AuthenticatedRequest, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) { sendNotFound(res, 'Contract'); return; }

  const userId = req.user!.userId;
  if (contract.posterId !== userId && contract.contractorId !== userId) { sendForbidden(res); return; }
  if (!['active', 'pending'].includes(contract.status)) { sendError(res, 'Cannot cancel this contract', 400); return; }

  const otherId = userId === contract.posterId ? contract.contractorId : contract.posterId;

  // If escrow was funded and no milestones have been released, create a refund record
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const refundOps: any[] = [
    prisma.contract.update({ where: { id: contract.id }, data: { status: 'cancelled' } }),
    prisma.job.update({ where: { id: contract.jobId }, data: { status: 'open' } }),
  ];

  if (contract.escrowFunded && Number(contract.releasedAmount) === 0) {
    refundOps.push(
      prisma.transaction.create({
        data: {
          userId: contract.posterId,
          contractId: contract.id,
          type: 'refund',
          amount: Number(contract.totalAmount),
          description: `Escrow refunded — contract cancelled`,
          status: 'completed',
          metadata: JSON.stringify({ type: 'escrow_refund' }),
        },
      })
    );
  }

  await prisma.$transaction(refundOps);

  await notify(otherId, 'contract_cancelled', 'Contract Cancelled',
    `A contract has been cancelled.`, { contractId: contract.id });

  sendSuccess(res, null, 'Contract cancelled');
}

// ─── Issue NOC Certificate ────────────────────────────────────────────────────
// Only the job poster can issue; only for completed contracts; one-time only.

export async function issueNOC(req: AuthenticatedRequest, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { id: req.params.id },
    include: {
      job:        { select: { id: true, title: true, category: true, location: true } },
      contractor: { select: { id: true, firstName: true, lastName: true } },
      poster:     { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!contract) { sendNotFound(res, 'Contract'); return; }
  if (contract.posterId !== req.user!.userId) { sendForbidden(res); return; }
  if (contract.status !== 'completed') { sendError(res, 'NOC can only be issued for completed contracts', 400); return; }
  if (contract.nocIssuedAt) { sendError(res, 'NOC certificate has already been issued for this contract', 409); return; }

  const { note } = req.body as { note?: string };

  const updated = await prisma.contract.update({
    where: { id: contract.id },
    data: { nocIssuedAt: new Date(), nocIssuerNote: note?.trim() || null },
  });

  await notify(
    contract.contractorId,
    'noc_issued',
    'NOC Certificate Issued! 🏆',
    `${contract.poster?.firstName} ${contract.poster?.lastName} has issued a No Objection Certificate for "${contract.job?.title}". Download it from your contract page.`,
    { contractId: contract.id },
  );

  sendSuccess(res, { nocIssuedAt: updated.nocIssuedAt, nocIssuerNote: updated.nocIssuerNote }, 'NOC certificate issued successfully');
}

// ─── Get NOC Certificate data ─────────────────────────────────────────────────
// Both poster and contractor can fetch the certificate details.

export async function getNOC(req: AuthenticatedRequest, res: Response): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { id: req.params.id },
    include: {
      job:        { select: { id: true, title: true, category: true, location: true } },
      contractor: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
      poster:     { select: { id: true, firstName: true, lastName: true, profileImage: true } },
      review:     { select: { rating: true, comment: true, createdAt: true } },
    },
  });
  if (!contract) { sendNotFound(res, 'Contract'); return; }

  const userId = req.user!.userId;
  if (contract.posterId !== userId && contract.contractorId !== userId) { sendForbidden(res); return; }
  if (!contract.nocIssuedAt) { sendError(res, 'No NOC certificate has been issued for this contract yet', 404); return; }

  sendSuccess(res, {
    certificateNumber: `NOC-${contract.id.slice(-8).toUpperCase()}`,
    contractId:  contract.id,
    nocIssuedAt: contract.nocIssuedAt,
    nocIssuerNote: contract.nocIssuerNote,
    job:         contract.job,
    contractor:  contract.contractor,
    poster:      contract.poster,
    totalAmount: contract.totalAmount,
    currency:    contract.currency,
    completedAt: contract.completedAt,
    review:      contract.review ? { rating: contract.review.rating, comment: contract.review.comment } : null,
  });
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function notify(userId: string, type: string, title: string, message: string, data?: Record<string, unknown>) {
  await prisma.notification.create({
    data: { userId, type, title, message, data: data ? JSON.stringify(data) : undefined },
  }).catch(() => {});
}
