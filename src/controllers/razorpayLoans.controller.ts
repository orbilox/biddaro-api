import crypto from 'crypto';
import { Response } from 'express';
import { prisma } from '../config/database';
import { razorpay } from '../utils/razorpay';
import { sendSuccess, sendError } from '../utils/response';
import { capiAddPaymentInfo, capiPurchase, capiSubmitApplication } from '../utils/metaCapi';
import type { AuthenticatedRequest } from '../types';

// ─── Shared helper: extract browser signals from request ─────────────────────
function browserSignals(req: AuthenticatedRequest) {
  return {
    clientIp:        ((req.headers['x-forwarded-for'] as string) ?? '').split(',')[0]?.trim() || (req.socket as any)?.remoteAddress,
    clientUserAgent: req.headers['user-agent'] as string | undefined,
    fbp:             (req as any).cookies?.['_fbp'] as string | undefined,
    fbc:             (req as any).cookies?.['_fbc'] as string | undefined,
  };
}

// Fee in paise: ₹50 = 5000, ₹100 = 10000
function getApplicationFee(loanType: string): number {
  return loanType === 'personal' ? 5000 : 10000;
}

// ─── Step 1: Create Razorpay order for the application fee ────────────────────
export async function createLoanOrder(req: AuthenticatedRequest, res: Response) {
  const { loanType } = req.body;

  if (!loanType) return sendError(res, 'loanType is required', 400);

  const amount = getApplicationFee(loanType);

  try {
    const order = await razorpay.orders.create({
      amount,
      currency: 'INR',
      receipt: `loan_fee_${Date.now()}`,
    });

    // ── Meta CAPI: user opened payment modal ────────────────────────────────
    capiAddPaymentInfo({
      ...browserSignals(req),
      value: amount / 100, currency: 'INR', contentCategory: loanType,
      sourceUrl: 'https://biddaro.com/loan-apply',
    });

    return sendSuccess(res, {
      orderId:  order.id,
      amount:   order.amount,
      currency: order.currency,
      key:      process.env.RAZORPAY_KEY_ID,
    });
  } catch (err: any) {
    console.error('[Razorpay] createLoanOrder error:', err?.error || err);
    return sendError(res, 'Failed to create payment order', 500);
  }
}

// ─── Subscription: Create Razorpay subscription for ₹100/month ────────────────
// Uses RAZORPAY_PLAN_ID env var (pre-created plan). If not set, creates one and
// logs the plan ID so it can be added to Railway env vars.
export async function createSubscription(req: AuthenticatedRequest, res: Response) {
  const { loanType, email, phone, firstName, lastName } = req.body;
  if (!loanType) return sendError(res, 'loanType is required', 400);

  try {
    // Reuse pre-created plan if available (preferred — avoids creating thousands of plans)
    let planId = process.env.RAZORPAY_PLAN_ID;

    if (!planId) {
      console.warn('[Razorpay] RAZORPAY_PLAN_ID not set — creating a one-off plan. Set this env var to reuse it.');
      const plan = await (razorpay.plans as any).create({
        period:   'monthly',
        interval: 1,
        item: {
          name:        'Biddaro Loan Eligibility',
          amount:      10000,   // ₹100 in paise
          currency:    'INR',
          description: 'Monthly subscription for loan eligibility check',
        },
        notes: { loanType },
      });
      planId = plan.id as string;
      console.log(`[Razorpay] Created plan: ${planId} — add RAZORPAY_PLAN_ID=${planId} to Railway env vars`);
    }

    const subscription = await (razorpay.subscriptions as any).create({
      plan_id:         planId,
      total_count:     120,    // 10 years — effectively ongoing
      customer_notify: 1,
      notes:           { loanType },
    });

    // ── Meta CAPI: user opened subscription modal ────────────────────────────
    capiAddPaymentInfo({
      ...browserSignals(req),
      email, phone, firstName, lastName,
      value: 100, currency: 'INR', contentCategory: loanType,
      sourceUrl: 'https://biddaro.com/loan-apply',
    });

    return sendSuccess(res, {
      subscriptionId: subscription.id,
      planId,
      key:            process.env.RAZORPAY_KEY_ID,
    });
  } catch (err: any) {
    const details = err?.error || err;
    console.error('[Razorpay] createSubscription error:', JSON.stringify(details));
    const message = (details as any)?.description || (details as any)?.message || 'Failed to create subscription';
    return sendError(res, message, 500);
  }
}

// ─── Step 2: Verify payment + submit loan application ─────────────────────────
export async function applyLoanPaid(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const {
    // Payment proof
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature,
    // Loan application fields
    loanType, amount, tenure, purpose, employmentType, monthlyIncome,
    firstName, lastName, email, phone, address, city, country, documents,
  } = req.body;

  // ── Signature verification ──────────────────────────────────────────────────
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

  // ── Validate loan fields ────────────────────────────────────────────────────
  if (!loanType || !amount || !tenure || !purpose || !employmentType || !monthlyIncome) {
    return sendError(res, 'Missing required loan fields', 400);
  }
  if (parseFloat(amount) < 1000) return sendError(res, 'Minimum loan amount is ₹1,000', 400);
  if (parseInt(tenure) < 6 || parseInt(tenure) > 360) {
    return sendError(res, 'Tenure must be between 6 and 360 months', 400);
  }

  // ── Create loan application ─────────────────────────────────────────────────
  const loan = await prisma.loanApplication.create({
    data: {
      userId,
      loanType,
      amount:         parseFloat(amount),
      tenure:         parseInt(tenure),
      purpose,
      employmentType,
      monthlyIncome:  parseFloat(monthlyIncome),
      firstName,
      lastName,
      email,
      phone,
      address,
      city,
      country:        country ?? 'IN',
      documents:      documents ? JSON.stringify(documents) : null,
      status:         'pending',
    },
  });

  // ── Meta CAPI: payment confirmed + application submitted ───────────────────
  const sig = browserSignals(req);
  const feeInRupees = getApplicationFee(loanType) / 100;
  capiPurchase({ email, phone, firstName, lastName, value: feeInRupees, currency: 'INR',
    contentName: loanType, orderId: razorpay_order_id, ...sig,
    sourceUrl: 'https://biddaro.com/loan-apply' });
  capiSubmitApplication({ email, phone, firstName, lastName,
    contentCategory: loanType, ...sig, sourceUrl: 'https://biddaro.com/loan-apply' });

  return sendSuccess(
    res,
    { loan, paymentId: razorpay_payment_id },
    'Application submitted successfully. We will review it within 2–5 business days.',
    201,
  );
}
