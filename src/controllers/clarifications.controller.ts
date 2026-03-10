import { Response } from 'express';
import type { AuthenticatedRequest } from '../types';
import { prisma } from '../config/database';
import { sendSuccess, sendError, sendCreated } from '../utils/response';

// ─── Business-days helper ─────────────────────────────────────────────────────
// Returns the number of business days (Mon–Fri) between today (midnight) and
// the given future date (midnight). Returns 0 if the target is today or in the past.

function businessDaysUntil(target: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(target);
  end.setHours(0, 0, 0, 0);
  if (today >= end) return 0;

  let count = 0;
  const cur = new Date(today);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay(); // 0 = Sun, 6 = Sat
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

// ─── Shared select for user fields ───────────────────────────────────────────

const userSelect = {
  id: true,
  firstName: true,
  lastName: true,
  profileImage: true,
};

// ─── List clarifications for a contract ──────────────────────────────────────

export async function listClarifications(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.userId;
  const { id: contractId } = req.params;

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) { sendError(res, 'Contract not found', 404); return; }
  if (contract.posterId !== userId && contract.contractorId !== userId) {
    sendError(res, 'Forbidden', 403); return;
  }

  const clarifications = await prisma.clarificationRequest.findMany({
    where: { contractId },
    include: {
      askedBy:    { select: userSelect },
      answeredBy: { select: userSelect },
    },
    orderBy: { createdAt: 'desc' },
  });

  sendSuccess(res, clarifications);
}

// ─── Contractor asks a clarification ─────────────────────────────────────────

export async function createClarification(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.userId;
  const { id: contractId } = req.params;
  const { question } = req.body;

  if (!question?.trim()) { sendError(res, 'Question is required', 400); return; }

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { job: { select: { endDate: true, title: true } } },
  });
  if (!contract)                        { sendError(res, 'Contract not found', 404); return; }
  if (contract.contractorId !== userId) { sendError(res, 'Only the contractor can request clarifications', 403); return; }
  if (contract.status !== 'active')     { sendError(res, 'Clarifications can only be requested on active contracts', 400); return; }

  // ── 5 business-days rule ───────────────────────────────────────────────────
  if (contract.job?.endDate) {
    const daysLeft = businessDaysUntil(new Date(contract.job.endDate));
    if (daysLeft < 5) {
      sendError(
        res,
        `Clarifications must be submitted at least 5 business days before the project end date. ` +
        `Only ${daysLeft} business day${daysLeft === 1 ? '' : 's'} remaining.`,
        400
      );
      return;
    }
  }

  const clarification = await prisma.clarificationRequest.create({
    data: {
      contractId,
      askedById: userId,
      question:  question.trim(),
      status:    'pending',
    },
    include: { askedBy: { select: userSelect } },
  });

  // Notify the poster
  await prisma.notification.create({
    data: {
      userId:  contract.posterId,
      type:    'clarification_requested',
      title:   'Clarification Requested',
      message: `The contractor has submitted a clarification request on "${contract.job?.title ?? 'your project'}".`,
    },
  });

  sendCreated(res, clarification, 'Clarification submitted successfully');
}

// ─── Poster answers a clarification ──────────────────────────────────────────

export async function answerClarification(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = req.user!.userId;
  const { id: contractId, clarificationId } = req.params;
  const { answer } = req.body;

  if (!answer?.trim()) { sendError(res, 'Answer is required', 400); return; }

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { job: { select: { title: true } } },
  });
  if (!contract)                     { sendError(res, 'Contract not found', 404); return; }
  if (contract.posterId !== userId)  { sendError(res, 'Only the job poster can answer clarifications', 403); return; }

  const clarification = await prisma.clarificationRequest.findUnique({
    where: { id: clarificationId },
  });
  if (!clarification || clarification.contractId !== contractId) {
    sendError(res, 'Clarification not found', 404); return;
  }
  if (clarification.status !== 'pending') {
    sendError(res, 'This clarification has already been answered', 400); return;
  }

  const updated = await prisma.clarificationRequest.update({
    where: { id: clarificationId },
    data: {
      answer:       answer.trim(),
      answeredById: userId,
      status:       'answered',
      answeredAt:   new Date(),
    },
    include: {
      askedBy:    { select: userSelect },
      answeredBy: { select: userSelect },
    },
  });

  // Notify the contractor
  await prisma.notification.create({
    data: {
      userId:  contract.contractorId,
      type:    'clarification_answered',
      title:   'Clarification Answered',
      message: `Your clarification on "${contract.job?.title ?? 'your project'}" has been answered by the client.`,
    },
  });

  sendSuccess(res, updated, 'Clarification answered');
}
