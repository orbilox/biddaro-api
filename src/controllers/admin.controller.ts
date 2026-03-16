import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError } from '../utils/response';
import { AuthenticatedRequest } from '../types';

// ─── Platform Analytics ──────────────────────────────────────────────────────

export async function getPlatformStats(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const [
    totalUsers, newUsersThisMonth,
    totalJobPosters, totalContractors,
    activeUsers,
    totalJobs, openJobs, inProgressJobs, completedJobs,
    totalContracts, activeContracts, completedContracts, disputedContracts,
    totalBids, pendingBids, acceptedBids,
    totalDisputes, openDisputes, resolvedDisputes,
    totalTransactions, totalRevenue, thisMonthRevenue, lastMonthRevenue,
    pendingDeposits, approvedDeposits, totalDepositAmount,
    totalWalletBalance,
    totalReviews,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.user.count({ where: { role: 'job_poster' } }),
    prisma.user.count({ where: { role: 'contractor' } }),
    prisma.user.count({ where: { isActive: true } }),

    prisma.job.count(),
    prisma.job.count({ where: { status: 'open' } }),
    prisma.job.count({ where: { status: 'in_progress' } }),
    prisma.job.count({ where: { status: 'completed' } }),

    prisma.contract.count(),
    prisma.contract.count({ where: { status: 'active' } }),
    prisma.contract.count({ where: { status: 'completed' } }),
    prisma.contract.count({ where: { status: 'disputed' } }),

    prisma.bid.count(),
    prisma.bid.count({ where: { status: 'pending' } }),
    prisma.bid.count({ where: { status: 'accepted' } }),

    prisma.dispute.count(),
    prisma.dispute.count({ where: { status: { in: ['open', 'under_review'] } } }),
    prisma.dispute.count({ where: { status: 'resolved' } }),

    prisma.transaction.count(),
    prisma.transaction.aggregate({ where: { type: 'fee', status: 'completed' }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { type: 'fee', status: 'completed', createdAt: { gte: monthStart } }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { type: 'fee', status: 'completed', createdAt: { gte: lastMonthStart, lte: lastMonthEnd } }, _sum: { amount: true } }),

    prisma.depositRequest.count({ where: { status: 'pending' } }),
    prisma.depositRequest.count({ where: { status: 'approved' } }),
    prisma.depositRequest.aggregate({ where: { status: 'approved' }, _sum: { amount: true } }),

    prisma.wallet.aggregate({ _sum: { balance: true } }),

    prisma.review.count(),
  ]);

  const thisMonthRev = Number(thisMonthRevenue._sum.amount ?? 0);
  const lastMonthRev = Number(lastMonthRevenue._sum.amount ?? 0);
  const revenueGrowth = lastMonthRev > 0
    ? (((thisMonthRev - lastMonthRev) / lastMonthRev) * 100).toFixed(1)
    : null;

  sendSuccess(res, {
    users: {
      total: totalUsers,
      newThisMonth: newUsersThisMonth,
      jobPosters: totalJobPosters,
      contractors: totalContractors,
      active: activeUsers,
      inactive: totalUsers - activeUsers,
    },
    jobs: { total: totalJobs, open: openJobs, inProgress: inProgressJobs, completed: completedJobs },
    contracts: { total: totalContracts, active: activeContracts, completed: completedContracts, disputed: disputedContracts },
    bids: { total: totalBids, pending: pendingBids, accepted: acceptedBids },
    disputes: { total: totalDisputes, open: openDisputes, resolved: resolvedDisputes },
    revenue: {
      allTime: Number(totalRevenue._sum.amount ?? 0),
      thisMonth: thisMonthRev,
      lastMonth: lastMonthRev,
      growthPercent: revenueGrowth,
    },
    deposits: {
      pending: pendingDeposits,
      approved: approvedDeposits,
      totalApprovedAmount: Number(totalDepositAmount._sum.amount ?? 0),
    },
    platform: {
      totalWalletBalance: Number(totalWalletBalance._sum.balance ?? 0),
      totalTransactions,
      totalReviews,
    },
  });
}

// ─── Revenue Chart Data ───────────────────────────────────────────────────────

export async function getRevenueChart(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);

  const months = 12;
  const data: { month: string; revenue: number; transactions: number }[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    const start = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const end = new Date(d.getFullYear(), d.getMonth() - i + 1, 0, 23, 59, 59);

    const [rev, txCount] = await Promise.all([
      prisma.transaction.aggregate({
        where: { type: 'fee', status: 'completed', createdAt: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      prisma.transaction.count({ where: { createdAt: { gte: start, lte: end } } }),
    ]);

    data.push({
      month: start.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      revenue: Number(rev._sum.amount ?? 0),
      transactions: txCount,
    });
  }

  sendSuccess(res, { chart: data });
}

// ─── User Growth Chart ────────────────────────────────────────────────────────

export async function getUserGrowthChart(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);

  const months = 12;
  const data: { month: string; jobPosters: number; contractors: number; total: number }[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    const start = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const end = new Date(d.getFullYear(), d.getMonth() - i + 1, 0, 23, 59, 59);

    const [posters, contractors] = await Promise.all([
      prisma.user.count({ where: { role: 'job_poster', createdAt: { gte: start, lte: end } } }),
      prisma.user.count({ where: { role: 'contractor', createdAt: { gte: start, lte: end } } }),
    ]);

    data.push({
      month: start.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      jobPosters: posters,
      contractors,
      total: posters + contractors,
    });
  }

  sendSuccess(res, { chart: data });
}

// ─── User Management ──────────────────────────────────────────────────────────

export async function listUsers(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);

  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const skip = (page - 1) * limit;
  const search = req.query.search as string | undefined;
  const role = req.query.role as string | undefined;
  const isActive = req.query.isActive as string | undefined;
  const isVerified = req.query.isVerified as string | undefined;
  const sortBy = (req.query.sortBy as string) || 'createdAt';
  const sortOrder = (req.query.sortOrder as string) || 'desc';

  const where: any = {};
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (role) where.role = role;
  if (isActive !== undefined) where.isActive = isActive === 'true';
  if (isVerified !== undefined) where.isVerified = isVerified === 'true';

  const orderBy: any = {};
  if (sortBy === 'name') {
    orderBy.firstName = sortOrder;
  } else {
    orderBy[sortBy] = sortOrder;
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, isActive: true, isVerified: true,
        profileImage: true, phone: true, location: true,
        rating: true, createdAt: true, updatedAt: true,
        wallet: { select: { balance: true, totalEarned: true } },
        _count: {
          select: {
            postedJobs: true,
            placedBids: true,
            contractsAsContractor: true,
            contractsAsPoster: true,
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  sendSuccess(res, {
    users,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

export async function getUser(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      wallet: true,
      _count: {
        select: {
          postedJobs: true, placedBids: true,
          contractsAsContractor: true, contractsAsPoster: true,
          givenReviews: true, raisedDisputes: true,
        },
      },
    },
  });

  if (!user) return sendError(res, 'User not found', 404);

  const [recentTransactions, recentJobs, recentContracts] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.job.findMany({
      where: { posterId: id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, status: true, budget: true, createdAt: true },
    }),
    prisma.contract.findMany({
      where: { OR: [{ posterId: id }, { contractorId: id }] },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, totalAmount: true, status: true, createdAt: true, job: { select: { title: true } } },
    }),
  ]);

  const { passwordHash, verificationToken, ...safeUser } = user as any;
  sendSuccess(res, { user: safeUser, recentTransactions, recentJobs, recentContracts });
}

export async function updateUser(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);
  const { id } = req.params;
  const { role, isActive, isVerified, firstName, lastName, email, adminNote } = req.body;

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return sendError(res, 'User not found', 404);

  // Prevent demoting self
  if (id === req.user.userId && role && role !== 'admin') {
    return sendError(res, 'Cannot change your own role', 400);
  }

  const data: any = {};
  if (role !== undefined) data.role = role;
  if (isActive !== undefined) data.isActive = isActive;
  if (isVerified !== undefined) data.isVerified = isVerified;
  if (firstName) data.firstName = firstName;
  if (lastName) data.lastName = lastName;
  if (email) data.email = email;

  const user = await prisma.user.update({ where: { id }, data });
  const { passwordHash, verificationToken, ...safeUser } = user as any;
  sendSuccess(res, { user: safeUser }, 'User updated successfully');
}

export async function deleteUser(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);
  const { id } = req.params;

  if (id === req.user.userId) return sendError(res, 'Cannot delete your own account', 400);

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return sendError(res, 'User not found', 404);

  // Soft delete
  await prisma.user.update({ where: { id }, data: { isActive: false } });
  sendSuccess(res, null, 'User deactivated successfully');
}

export async function adjustUserWallet(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);
  const { id } = req.params;
  const { amount, type, description } = req.body;

  if (!amount || !type || !['credit', 'debit'].includes(type)) {
    return sendError(res, 'amount and type (credit|debit) are required', 400);
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId: id } });
  if (!wallet) return sendError(res, 'User wallet not found', 404);

  if (type === 'debit' && wallet.balance < amount) {
    return sendError(res, 'Insufficient wallet balance', 400);
  }

  const [updatedWallet, tx] = await prisma.$transaction([
    prisma.wallet.update({
      where: { userId: id },
      data: {
        balance: type === 'credit' ? { increment: amount } : { decrement: amount },
        totalEarned: type === 'credit' ? { increment: amount } : undefined,
      },
    }),
    prisma.transaction.create({
      data: {
        userId: id,
        type,
        amount,
        status: 'completed',
        description: description || `Admin wallet adjustment (${type})`,
      },
    }),
  ]);

  sendSuccess(res, { wallet: updatedWallet, transaction: tx }, 'Wallet adjusted successfully');
}

// ─── Job Management ───────────────────────────────────────────────────────────

export async function listJobs(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);

  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const skip = (page - 1) * limit;
  const search = req.query.search as string | undefined;
  const status = req.query.status as string | undefined;
  const category = req.query.category as string | undefined;

  const where: any = {};
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (status) where.status = status;
  if (category) where.category = category;

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        poster: { select: { id: true, firstName: true, lastName: true, email: true, profileImage: true } },
        _count: { select: { bids: true, contracts: true } },
      },
    }),
    prisma.job.count({ where }),
  ]);

  sendSuccess(res, {
    jobs,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

export async function getJob(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);
  const { id } = req.params;

  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      poster: { select: { id: true, firstName: true, lastName: true, email: true } },
      bids: {
        include: { contractor: { select: { id: true, firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      contracts: {
        include: {
          poster: { select: { id: true, firstName: true, lastName: true } },
          contractor: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      _count: { select: { bids: true } },
    },
  });

  if (!job) return sendError(res, 'Job not found', 404);
  sendSuccess(res, { job });
}

export async function adminUpdateJob(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);
  const { id } = req.params;
  const { status, title } = req.body;

  const job = await prisma.job.update({ where: { id }, data: { status, title } });
  sendSuccess(res, { job }, 'Job updated');
}

export async function adminDeleteJob(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);
  const { id } = req.params;

  await prisma.job.update({ where: { id }, data: { status: 'cancelled' } });
  sendSuccess(res, null, 'Job cancelled successfully');
}

// ─── Contract Management ──────────────────────────────────────────────────────

export async function listContracts(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);

  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const skip = (page - 1) * limit;
  const status = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;

  const where: any = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { job: { title: { contains: search, mode: 'insensitive' } } },
      { poster: { email: { contains: search, mode: 'insensitive' } } },
      { contractor: { email: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        job: { select: { id: true, title: true, category: true } },
        poster: { select: { id: true, firstName: true, lastName: true, email: true, profileImage: true } },
        contractor: { select: { id: true, firstName: true, lastName: true, email: true, profileImage: true } },
        _count: { select: { transactions: true } },
      },
    }),
    prisma.contract.count({ where }),
  ]);

  sendSuccess(res, {
    contracts,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

export async function getContract(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);
  const { id } = req.params;

  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      job: true,
      bid: true,
      poster: { select: { id: true, firstName: true, lastName: true, email: true, profileImage: true } },
      contractor: { select: { id: true, firstName: true, lastName: true, email: true, profileImage: true } },
      transactions: { orderBy: { createdAt: 'desc' } },
      dispute: true,
    },
  });

  if (!contract) return sendError(res, 'Contract not found', 404);
  sendSuccess(res, { contract });
}

// ─── Transaction Management ───────────────────────────────────────────────────

export async function listTransactions(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);

  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const skip = (page - 1) * limit;
  const type = req.query.type as string | undefined;
  const status = req.query.status as string | undefined;
  const userId = req.query.userId as string | undefined;
  const search = req.query.search as string | undefined;

  const where: any = {};
  if (type) where.type = type;
  if (status) where.status = status;
  if (userId) where.userId = userId;
  if (search) {
    where.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [transactions, total, summary] = await Promise.all([
    prisma.transaction.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, profileImage: true } },
      },
    }),
    prisma.transaction.count({ where }),
    prisma.transaction.groupBy({
      by: ['type'],
      where: { ...where, status: 'completed' },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  sendSuccess(res, {
    transactions,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    summary,
  });
}

// ─── Dispute Management ───────────────────────────────────────────────────────

export async function listAllDisputes(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);

  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const skip = (page - 1) * limit;
  const status = req.query.status as string | undefined;

  const where: any = {};
  if (status) where.status = status;

  const [disputes, total] = await Promise.all([
    prisma.dispute.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        raisedBy: { select: { id: true, firstName: true, lastName: true, email: true, profileImage: true } },
        contract: {
          include: {
            job: { select: { id: true, title: true } },
            poster: { select: { id: true, firstName: true, lastName: true } },
            contractor: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    }),
    prisma.dispute.count({ where }),
  ]);

  sendSuccess(res, {
    disputes,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

// ─── Reviews Management ───────────────────────────────────────────────────────

export async function listAllReviews(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);

  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const skip = (page - 1) * limit;
  const minRating = parseInt(req.query.minRating as string) || 1;
  const maxRating = parseInt(req.query.maxRating as string) || 5;

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where: { rating: { gte: minRating, lte: maxRating } },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        reviewer: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
        reviewee: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
        contract: { include: { job: { select: { id: true, title: true } } } },
      },
    }),
    prisma.review.count({ where: { rating: { gte: minRating, lte: maxRating } } }),
  ]);

  sendSuccess(res, {
    reviews,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

export async function adminDeleteReview(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);
  const { id } = req.params;

  const review = await prisma.review.findUnique({ where: { id } });
  if (!review) return sendError(res, 'Review not found', 404);

  await prisma.review.delete({ where: { id } });
  sendSuccess(res, null, 'Review deleted');
}

// ─── Platform Activity Feed ───────────────────────────────────────────────────

export async function getRecentActivity(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

  const [newUsers, newJobs, newContracts, recentTransactions, recentDisputes] = await Promise.all([
    prisma.user.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, createdAt: true },
    }),
    prisma.job.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, status: true, budget: true, createdAt: true, poster: { select: { firstName: true, lastName: true } } },
    }),
    prisma.contract.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, totalAmount: true, status: true, createdAt: true, job: { select: { title: true } } },
    }),
    prisma.transaction.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, amount: true, status: true, description: true, createdAt: true, user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.dispute.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, reason: true, status: true, createdAt: true, raisedBy: { select: { firstName: true, lastName: true } }, contract: { select: { job: { select: { title: true } } } } },
    }),
  ]);

  sendSuccess(res, { newUsers, newJobs, newContracts, recentTransactions, recentDisputes });
}

// ─── Notifications Broadcast ──────────────────────────────────────────────────

export async function broadcastNotification(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);
  const { title, message, targetRole, type } = req.body;

  if (!title || !message) return sendError(res, 'title and message are required', 400);

  const where: any = { isActive: true };
  if (targetRole && targetRole !== 'all') where.role = targetRole;

  const users = await prisma.user.findMany({ where, select: { id: true } });

  await prisma.notification.createMany({
    data: users.map(u => ({
      userId: u.id,
      type: type || 'admin_broadcast',
      title,
      message,
    })),
  });

  sendSuccess(res, { sentTo: users.length }, `Notification sent to ${users.length} users`);
}
