import crypto from 'crypto';
import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError } from '../utils/response';
import type { AuthenticatedRequest } from '../types';

// ─── Public: submit inquiry right after Razorpay payment ─────────────────────
export async function submitInquiry(req: AuthenticatedRequest, res: Response) {
  const {
    // Payment proof
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature,
    // Form fields
    loanType, amount, purpose, employmentType, monthlyIncome,
    firstName, lastName, email, phone, address, city,
    feePaid,
  } = req.body;

  // ── Signature verification ────────────────────────────────────────────────
  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return sendError(res, 'Missing payment verification fields', 400);
  }

  const expectedSig = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSig !== razorpay_signature) {
    return sendError(res, 'Payment verification failed', 400);
  }

  // ── Required fields ───────────────────────────────────────────────────────
  if (!loanType || !amount || !firstName || !lastName || !email || !phone) {
    return sendError(res, 'Missing required fields', 400);
  }

  // ── Prevent duplicate submission for same payment ─────────────────────────
  const existing = await prisma.loanInquiry.findFirst({
    where: { razorpayPaymentId: razorpay_payment_id },
  });
  if (existing) {
    return sendSuccess(res, { inquiry: existing }, 'Inquiry already recorded', 200);
  }

  // ── Save inquiry ──────────────────────────────────────────────────────────
  const inquiry = await prisma.loanInquiry.create({
    data: {
      loanType,
      amount:        parseFloat(amount),
      purpose:       purpose || null,
      employmentType: employmentType || null,
      monthlyIncome: monthlyIncome ? parseFloat(monthlyIncome) : null,
      firstName,
      lastName,
      email,
      phone,
      address:       address || null,
      city:          city    || null,
      country:       'IN',
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId:   razorpay_order_id,
      razorpaySignature: razorpay_signature,
      feePaid:       feePaid ? parseInt(feePaid) : 5000,
      status:        'new',
    },
  });

  return sendSuccess(res, { inquiry }, 'Inquiry recorded successfully', 201);
}

// ─── Admin: list all inquiries ────────────────────────────────────────────────
export async function adminListInquiries(req: AuthenticatedRequest, res: Response) {
  const page   = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit  = Math.min(50, parseInt(req.query.limit as string) || 20);
  const status = req.query.status as string | undefined;
  const skip   = (page - 1) * limit;

  const where = status && status !== 'all' ? { status } : {};

  const [inquiries, total] = await Promise.all([
    prisma.loanInquiry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.loanInquiry.count({ where }),
  ]);

  // Stats
  const [newCount, contactedCount, convertedCount, closedCount] = await Promise.all([
    prisma.loanInquiry.count({ where: { status: 'new' } }),
    prisma.loanInquiry.count({ where: { status: 'contacted' } }),
    prisma.loanInquiry.count({ where: { status: 'converted' } }),
    prisma.loanInquiry.count({ where: { status: 'closed' } }),
  ]);

  return sendSuccess(res, {
    inquiries,
    total,
    pages: Math.ceil(total / limit),
    page,
    stats: {
      total: await prisma.loanInquiry.count(),
      new:       newCount,
      contacted: contactedCount,
      converted: convertedCount,
      closed:    closedCount,
    },
  });
}

// ─── Admin: update inquiry status / note ─────────────────────────────────────
export async function adminUpdateInquiry(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const { status, adminNote } = req.body;

  const allowed = ['new', 'contacted', 'converted', 'closed'];
  if (status && !allowed.includes(status)) {
    return sendError(res, `Invalid status. Must be one of: ${allowed.join(', ')}`, 400);
  }

  const inquiry = await prisma.loanInquiry.update({
    where: { id },
    data: {
      ...(status    ? { status }    : {}),
      ...(adminNote !== undefined ? { adminNote } : {}),
    },
  });

  return sendSuccess(res, { inquiry }, 'Inquiry updated');
}
