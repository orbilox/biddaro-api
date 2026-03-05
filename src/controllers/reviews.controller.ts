import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden } from '../utils/response';
import { getPagination, buildPaginatedResult } from '../utils/pagination';
import type { AuthenticatedRequest } from '../types';

const REVIEW_INCLUDE = {
  reviewer: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
  reviewee: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
  job: { select: { id: true, title: true, category: true } },
};

// ─── Submit a review ──────────────────────────────────────────────────────────

export async function submitReview(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { contractId, revieweeId, rating, comment } = req.body;
  const reviewerId = req.user!.userId;

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) { sendNotFound(res, 'Contract'); return; }
  if (contract.status !== 'completed') { sendError(res, 'Can only review completed contracts', 400); return; }
  if (contract.posterId !== reviewerId && contract.contractorId !== reviewerId) { sendForbidden(res); return; }
  if (reviewerId === revieweeId) { sendError(res, 'Cannot review yourself', 400); return; }

  // Verify reviewee is part of contract
  if (contract.posterId !== revieweeId && contract.contractorId !== revieweeId) {
    sendError(res, 'Reviewee is not part of this contract', 400); return;
  }

  // One review per contract per user
  const existing = await prisma.review.findFirst({ where: { contractId, reviewerId } });
  if (existing) { sendError(res, 'You have already reviewed this contract', 409); return; }

  const review = await prisma.review.create({
    data: {
      contractId,
      jobId: contract.jobId,
      reviewerId,
      revieweeId,
      rating: parseFloat(rating),
      comment,
    },
    include: REVIEW_INCLUDE,
  });

  // Update reviewee average rating
  await updateUserRating(revieweeId);

  sendCreated(res, review, 'Review submitted');
}

// ─── Get reviews for a user ───────────────────────────────────────────────────

export async function getUserReviews(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { userId } = req.params;
  const { page, limit, skip } = getPagination(req);

  const [reviews, total] = await prisma.$transaction([
    prisma.review.findMany({
      where: { revieweeId: userId },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: REVIEW_INCLUDE,
    }),
    prisma.review.count({ where: { revieweeId: userId } }),
  ]);

  const avg = await prisma.review.aggregate({
    where: { revieweeId: userId },
    _avg: { rating: true },
  });

  sendSuccess(res, {
    ...buildPaginatedResult(reviews, total, { page, limit, skip }),
    averageRating: avg._avg.rating ?? 0,
    totalReviews: total,
  });
}

// ─── Get reviews for a job ────────────────────────────────────────────────────

export async function getJobReviews(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { jobId } = req.params;
  const { page, limit, skip } = getPagination(req);

  const [reviews, total] = await prisma.$transaction([
    prisma.review.findMany({
      where: { jobId },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: REVIEW_INCLUDE,
    }),
    prisma.review.count({ where: { jobId } }),
  ]);

  sendSuccess(res, buildPaginatedResult(reviews, total, { page, limit, skip }));
}

// ─── Get my given reviews ─────────────────────────────────────────────────────

export async function getMyReviews(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { page, limit, skip } = getPagination(req);
  const userId = req.user!.userId;

  const [reviews, total] = await prisma.$transaction([
    prisma.review.findMany({
      where: { reviewerId: userId },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: REVIEW_INCLUDE,
    }),
    prisma.review.count({ where: { reviewerId: userId } }),
  ]);

  sendSuccess(res, buildPaginatedResult(reviews, total, { page, limit, skip }));
}

// ─── Delete a review ──────────────────────────────────────────────────────────

export async function deleteReview(req: AuthenticatedRequest, res: Response): Promise<void> {
  const review = await prisma.review.findUnique({ where: { id: req.params.id } });
  if (!review) { sendNotFound(res, 'Review'); return; }
  if (review.reviewerId !== req.user!.userId && req.user!.role !== 'admin') { sendForbidden(res); return; }

  await prisma.review.delete({ where: { id: review.id } });
  await updateUserRating(review.revieweeId);
  sendSuccess(res, null, 'Review deleted');
}

// ─── Helper: update user's cached average rating ──────────────────────────────

async function updateUserRating(userId: string) {
  const avg = await prisma.review.aggregate({
    where: { revieweeId: userId },
    _avg: { rating: true },
  });
  await prisma.user.update({
    where: { id: userId },
    data: { rating: avg._avg.rating ?? 0 },
  }).catch(() => {});
}
