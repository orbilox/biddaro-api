import { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { prisma } from '../config/database';
import { sendSuccess, sendError, sendNotFound, sendForbidden } from '../utils/response';
import type { AuthenticatedRequest } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const POSTER_SELECT = { id: true, firstName: true, lastName: true, profileImage: true };

/** Verify the requesting user is a party to this contract and has the add-on installed */
async function resolveContract(contractId: string, userId: string) {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      posterId: true,
      contractorId: true,
      status: true,
      job: { select: { title: true } },
      poster: { select: POSTER_SELECT },
      contractor: { select: POSTER_SELECT },
    },
  });
  if (!contract) return null;
  if (contract.posterId !== userId && contract.contractorId !== userId) return null;
  return contract;
}

async function hasAddon(userId: string): Promise<boolean> {
  const rec = await prisma.userAddOn.findUnique({
    where: { userId_addOnSlug: { userId, addOnSlug: 'live-project-tracking' } },
  });
  return !!(rec?.isActive);
}

// ─── GET /project-tracking ────────────────────────────────────────────────────
// Returns all active contracts for the user with their latest update + progress

export async function getDashboard(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;

  if (!(await hasAddon(userId))) {
    sendError(res, 'Live Project Tracking add-on is not installed', 403);
    return;
  }

  const contracts = await prisma.contract.findMany({
    where: {
      OR: [{ posterId: userId }, { contractorId: userId }],
      status: { in: ['active', 'disputed'] },
    },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      currency: true,
      createdAt: true,
      job: { select: { id: true, title: true, category: true, location: true } },
      poster: { select: POSTER_SELECT },
      contractor: { select: POSTER_SELECT },
      projectUpdates: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          message: true,
          progressPercent: true,
          type: true,
          createdAt: true,
          postedBy: { select: POSTER_SELECT },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Compute overall progress per contract = latest progressPercent or 0
  const enriched = contracts.map((c) => ({
    ...c,
    latestUpdate: c.projectUpdates[0] ?? null,
    overallProgress: c.projectUpdates[0]?.progressPercent ?? 0,
  }));

  sendSuccess(res, enriched);
}

// ─── GET /project-tracking/:contractId ───────────────────────────────────────
// Full update feed for a single contract

export async function getContractFeed(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { contractId } = req.params;

  if (!(await hasAddon(userId))) {
    sendError(res, 'Live Project Tracking add-on is not installed', 403);
    return;
  }

  const contract = await resolveContract(contractId, userId);
  if (!contract) { sendNotFound(res, 'Contract'); return; }

  const updates = await prisma.projectUpdate.findMany({
    where: { contractId },
    orderBy: { createdAt: 'desc' },
    include: {
      postedBy: { select: POSTER_SELECT },
    },
  });

  // Latest progress
  const latestProgress = updates.find((u) => u.progressPercent !== null)?.progressPercent ?? 0;

  sendSuccess(res, {
    contract,
    updates,
    overallProgress: latestProgress,
    totalUpdates: updates.length,
  });
}

// ─── POST /project-tracking/:contractId/updates ───────────────────────────────
// Contractor posts a new progress update

export async function postUpdate(req: AuthenticatedRequest, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    sendError(res, errors.array()[0].msg as string);
    return;
  }

  const userId = req.user!.userId;
  const { contractId } = req.params;
  const { message, progressPercent, imageUrl, type } = req.body;

  if (!(await hasAddon(userId))) {
    sendError(res, 'Live Project Tracking add-on is not installed', 403);
    return;
  }

  const contract = await resolveContract(contractId, userId);
  if (!contract) { sendNotFound(res, 'Contract'); return; }

  // Only contractor (or poster for notes) can post
  const isContractor = contract.contractorId === userId;
  const isPoster     = contract.posterId === userId;

  if (!isContractor && !isPoster) { sendForbidden(res); return; }

  // Only contractor can post progress updates (type = update/photo/milestone)
  // Poster can only post type = note
  if (!isContractor && type !== 'note') {
    sendError(res, 'Only the contractor can post progress updates');
    return;
  }

  // Validate progress percent
  let percent: number | undefined;
  if (progressPercent !== undefined && progressPercent !== null) {
    percent = parseInt(String(progressPercent));
    if (isNaN(percent) || percent < 0 || percent > 100) {
      sendError(res, 'Progress percent must be between 0 and 100');
      return;
    }
  }

  const update = await prisma.projectUpdate.create({
    data: {
      contractId,
      postedById: userId,
      message,
      progressPercent: percent ?? null,
      imageUrl: imageUrl || null,
      type: type || 'update',
    },
    include: {
      postedBy: { select: POSTER_SELECT },
    },
  });

  // Notify the other party
  const notifyUserId = isContractor ? contract.posterId : contract.contractorId;
  await prisma.notification.create({
    data: {
      userId: notifyUserId,
      type: 'project_update',
      title: 'New Project Update',
      message: `${isContractor ? contract.contractor.firstName : contract.poster.firstName} posted a new update on "${contract.job.title}"`,
      data: JSON.stringify({ contractId, updateId: update.id }),
    },
  });

  res.status(201).json({ success: true, message: 'Update posted', data: update });
}

// ─── DELETE /project-tracking/:contractId/updates/:updateId ──────────────────

export async function deleteUpdate(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { contractId, updateId } = req.params;

  const update = await prisma.projectUpdate.findUnique({ where: { id: updateId } });
  if (!update || update.contractId !== contractId) { sendNotFound(res, 'Update'); return; }
  if (update.postedById !== userId) { sendForbidden(res); return; }

  await prisma.projectUpdate.delete({ where: { id: updateId } });
  sendSuccess(res, null, 'Update deleted');
}
