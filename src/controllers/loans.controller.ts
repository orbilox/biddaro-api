import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError } from '../utils/response';
import type { AuthenticatedRequest } from '../types';

// ─── Apply for a loan ─────────────────────────────────────────────────────────
export async function applyLoan(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const {
    loanType, amount, tenure, purpose, employmentType, monthlyIncome,
    firstName, lastName, email, phone, address, city, country, documents,
  } = req.body;

  if (!loanType || !amount || !tenure || !purpose || !employmentType || !monthlyIncome) {
    return sendError(res, 'Missing required fields', 400);
  }
  if (amount < 1000) return sendError(res, 'Minimum loan amount is $1,000', 400);
  if (tenure < 6 || tenure > 360) return sendError(res, 'Tenure must be between 6 and 360 months', 400);

  const loan = await prisma.loanApplication.create({
    data: {
      userId, loanType, amount: parseFloat(amount), tenure: parseInt(tenure),
      purpose, employmentType, monthlyIncome: parseFloat(monthlyIncome),
      firstName, lastName, email, phone, address, city, country,
      documents: documents ? JSON.stringify(documents) : null,
      status: 'pending',
    },
  });

  return sendSuccess(res, loan, 'Loan application submitted successfully. We will review it within 2–5 business days.', 201);
}

// ─── My applications ──────────────────────────────────────────────────────────
export async function myLoanApplications(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const loans = await prisma.loanApplication.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return sendSuccess(res, loans);
}

// ─── Get single application ───────────────────────────────────────────────────
export async function getLoanApplication(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const { id } = req.params;
  const loan = await prisma.loanApplication.findFirst({
    where: { id, userId },
    include: { user: { select: { firstName: true, lastName: true, email: true } } },
  });
  if (!loan) return sendError(res, 'Loan application not found', 404);
  return sendSuccess(res, loan);
}

// ─── Admin: list all applications ────────────────────────────────────────────
export async function adminListLoans(req: AuthenticatedRequest, res: Response) {
  const { status, page = 1 } = req.query;
  const take = 20;
  const skip = (Number(page) - 1) * take;

  const where = status ? { status: status as string } : {};
  const [loans, total] = await Promise.all([
    prisma.loanApplication.findMany({
      where,
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, profileImage: true } } },
      orderBy: { createdAt: 'desc' },
      take, skip,
    }),
    prisma.loanApplication.count({ where }),
  ]);

  return sendSuccess(res, { loans, total, page: Number(page), pages: Math.ceil(total / take) });
}

// ─── Admin: review application ────────────────────────────────────────────────
export async function adminReviewLoan(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const { status, adminNote, approvedAmount, interestRate } = req.body;

  const validStatuses = ['under_review', 'approved', 'rejected', 'disbursed'];
  if (!validStatuses.includes(status)) return sendError(res, 'Invalid status', 400);

  const loan = await prisma.loanApplication.findUnique({ where: { id } });
  if (!loan) return sendError(res, 'Loan application not found', 404);

  // Calculate EMI if approved
  let emiAmount: number | undefined;
  if (status === 'approved' && approvedAmount && interestRate) {
    const P = parseFloat(approvedAmount);
    const r = parseFloat(interestRate) / 100 / 12;
    const n = loan.tenure;
    emiAmount = r === 0 ? P / n : (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  }

  const updated = await prisma.loanApplication.update({
    where: { id },
    data: {
      status,
      adminNote: adminNote || null,
      approvedAmount: approvedAmount ? parseFloat(approvedAmount) : undefined,
      interestRate: interestRate ? parseFloat(interestRate) : undefined,
      emiAmount: emiAmount ? parseFloat(emiAmount.toFixed(2)) : undefined,
      reviewedAt: new Date(),
      disbursedAt: status === 'disbursed' ? new Date() : undefined,
    },
  });

  return sendSuccess(res, updated, `Loan application ${status}`);
}

// ─── Admin: stats ─────────────────────────────────────────────────────────────
export async function adminLoanStats(req: AuthenticatedRequest, res: Response) {
  const [total, pending, underReview, approved, rejected, disbursed, totalAmount] = await Promise.all([
    prisma.loanApplication.count(),
    prisma.loanApplication.count({ where: { status: 'pending' } }),
    prisma.loanApplication.count({ where: { status: 'under_review' } }),
    prisma.loanApplication.count({ where: { status: 'approved' } }),
    prisma.loanApplication.count({ where: { status: 'rejected' } }),
    prisma.loanApplication.count({ where: { status: 'disbursed' } }),
    prisma.loanApplication.aggregate({ _sum: { approvedAmount: true }, where: { status: { in: ['approved', 'disbursed'] } } }),
  ]);

  return sendSuccess(res, {
    total, pending, underReview, approved, rejected, disbursed,
    totalApprovedAmount: totalAmount._sum.approvedAmount || 0,
  });
}
