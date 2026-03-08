import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError, sendNotFound } from '../utils/response';
import { getPagination, buildPaginatedResult } from '../utils/pagination';
import type { AuthenticatedRequest } from '../types';

function safeUser(user: Record<string, unknown>) {
  const { passwordHash, refreshToken, verificationToken, ...safe } = user;
  return safe;
}

// ─── Get user profile (public) ────────────────────────────────────────────────

export async function getUserProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: {
      receivedReviews: {
        include: { reviewer: { select: { id: true, firstName: true, lastName: true, profileImage: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      _count: {
        select: { postedJobs: true, placedBids: true, contractsAsContractor: true },
      },
    },
  });

  if (!user) { sendNotFound(res, 'User'); return; }

  const avgRating = user.receivedReviews.length > 0
    ? user.receivedReviews.reduce((s, r) => s + r.rating, 0) / user.receivedReviews.length
    : null;

  sendSuccess(res, { ...safeUser(user as unknown as Record<string, unknown>), averageRating: avgRating });
}

// ─── Update profile ───────────────────────────────────────────────────────────

export async function updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  const allowedFields = [
    'firstName', 'lastName', 'phone', 'location', 'bio',
    'profileImage', 'skills', 'licenseNumber', 'yearsExperience',
  ];

  const data: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      data[field] = Array.isArray(req.body[field])
        ? JSON.stringify(req.body[field])
        : req.body[field];
    }
  }

  if (Object.keys(data).length === 0) {
    sendError(res, 'No valid fields to update', 400); return;
  }

  const user = await prisma.user.update({ where: { id: req.user!.userId }, data });
  sendSuccess(res, safeUser(user as unknown as Record<string, unknown>), 'Profile updated');
}

// ─── List contractors (public) ────────────────────────────────────────────────

export async function listContractors(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { page, limit, skip } = getPagination(req);
  const { search, location } = req.query;

  const where: Record<string, unknown> = { role: 'contractor', isActive: true };

  if (search) {
    where.OR = [
      { firstName: { contains: search as string } },
      { lastName: { contains: search as string } },
      { bio: { contains: search as string } },
    ];
  }

  if (location) where.location = { contains: location as string };

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { rating: 'desc' },
      include: {
        _count: { select: { contractsAsContractor: true, receivedReviews: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const safeUsers = users.map((u) => safeUser(u as unknown as Record<string, unknown>));
  sendSuccess(res, buildPaginatedResult(safeUsers, total, { page, limit, skip }));
}

// ─── Get user stats ───────────────────────────────────────────────────────────

export async function getUserStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const role   = req.user!.role;

  const reviews = await prisma.review.findMany({ where: { revieweeId: userId } });
  const avgRating = reviews.length > 0
    ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
    : null;

  if (role === 'job_poster') {
    // Get all job IDs posted by this user so we can count received bids
    const myJobIds = await prisma.job
      .findMany({ where: { posterId: userId }, select: { id: true } })
      .then((rows) => rows.map((r) => r.id));

    const [activeJobs, totalBidsReceived, activeContracts] = await Promise.all([
      prisma.job.count({ where: { posterId: userId, status: 'open' } }),
      myJobIds.length > 0
        ? prisma.bid.count({ where: { jobId: { in: myJobIds } } })
        : Promise.resolve(0),
      prisma.contract.count({ where: { posterId: userId, status: 'active' } }),
    ]);

    sendSuccess(res, {
      activeJobs,
      totalBidsReceived,
      activeContracts,
      reviewCount: reviews.length,
      averageRating: avgRating,
    });
  } else {
    // contractor
    const [activeBids, jobsWon] = await Promise.all([
      prisma.bid.count({ where: { contractorId: userId, status: 'pending' } }),
      prisma.contract.count({ where: { contractorId: userId } }),
    ]);

    sendSuccess(res, {
      activeBids,
      jobsWon,
      reviewCount: reviews.length,
      averageRating: avgRating,
    });
  }
}

// ─── Delete account (soft) ────────────────────────────────────────────────────

export async function deleteAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
  await prisma.user.update({
    where: { id: req.user!.userId },
    data: { isActive: false, refreshToken: null },
  });
  sendSuccess(res, null, 'Account deactivated');
}
