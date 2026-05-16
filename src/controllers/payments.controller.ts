/* eslint-disable @typescript-eslint/no-explicit-any */
import StripeLib = require('stripe');
import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError } from '../utils/response';
import { sendPushToUser, userWantsPush } from '../utils/push';
import type { AuthenticatedRequest } from '../types';

// Lazily initialise Stripe so missing key during build doesn't crash import
function getStripe(): StripeLib.Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY env var is not set');
  return new StripeLib(key, { apiVersion: '2026-04-22.dahlia' });
}

// ─── Create Stripe Checkout Session ──────────────────────────────────────────
// POST /payments/create-checkout-session  (authenticated)
// Body: { amount: number }  — in USD

export async function createCheckoutSession(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { amount } = req.body;
  const numAmount = parseFloat(amount);

  if (isNaN(numAmount) || numAmount < 10) { sendError(res, 'Minimum deposit is $10', 400); return; }
  if (numAmount > 5000) { sendError(res, 'Maximum single deposit is $5,000', 400); return; }

  const stripe = getStripe();
  const frontendUrl = process.env.FRONTEND_URL || 'https://biddaro.com';

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'Biddaro Wallet Top-up',
          description: `Add $${numAmount.toFixed(2)} to your Biddaro wallet`,
        },
        unit_amount: Math.round(numAmount * 100), // Stripe uses cents
      },
      quantity: 1,
    }],
    metadata: {
      userId: req.user!.userId,
      type: 'wallet_topup',
      amount: numAmount.toString(),
    },
    success_url: `${frontendUrl}/wallet?deposit_success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/wallet`,
    customer_email: req.user!.email,
  });

  sendSuccess(res, { url: session.url, sessionId: session.id });
}

// ─── Stripe Webhook ───────────────────────────────────────────────────────────
// POST /api/v1/payments/stripe-webhook  (raw body — registered in app.ts)

export async function stripeWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[STRIPE] STRIPE_WEBHOOK_SECRET is not set');
    res.status(500).json({ error: 'Webhook secret not configured' });
    return;
  }

  let event: any;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
  } catch (err) {
    console.error('[STRIPE] Webhook signature verification failed:', err);
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session: any = event.data.object;
    const { userId, type, amount } = session.metadata ?? {};

    if (type === 'wallet_topup' && userId && amount) {
      const numAmount = parseFloat(amount);
      try {
        await prisma.$transaction([
          prisma.wallet.upsert({
            where: { userId },
            create: { userId, balance: numAmount, pendingBalance: 0, totalEarned: 0 },
            update: { balance: { increment: numAmount } },
          }),
          prisma.transaction.create({
            data: {
              userId,
              type: 'credit',
              amount: numAmount,
              description: `Card deposit via Stripe (ref: ${String(session.id).slice(-8).toUpperCase()})`,
              status: 'completed',
              metadata: JSON.stringify({ type: 'stripe_deposit', sessionId: session.id }),
            },
          }),
        ]);
        console.log(`[STRIPE] Credited $${numAmount} to user ${userId}`);

        // In-app notification
        prisma.notification.create({
          data: {
            userId,
            type: 'deposit_approved',
            title: 'Card Deposit Successful',
            message: `$${numAmount.toFixed(2)} has been added to your wallet via card payment.`,
            data: JSON.stringify({ url: '/wallet' }),
          },
        }).catch(() => {});

        // Push notification
        userWantsPush(userId, 'wallet').then(wants => {
          if (wants) sendPushToUser(userId, {
            title: 'Deposit Successful 💳',
            body: `$${numAmount.toFixed(2)} added to your wallet`,
            url: '/wallet',
          }).catch(() => {});
        }).catch(() => {});

      } catch (err) {
        console.error('[STRIPE] Failed to credit wallet:', err);
        res.status(500).json({ error: 'Failed to credit wallet' });
        return;
      }
    }
  }

  res.json({ received: true });
}
