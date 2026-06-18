import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError } from '../utils/response';
import {
  sendLoanFollowupStage1,
  sendLoanFollowupStage2,
  sendLoanFollowupStage3,
  sendLoanFollowupStage4,
} from '../utils/email';
import { sendPushToUser } from '../utils/push';
import type { AuthenticatedRequest } from '../types';

const STAGE_PUSH_BODIES = [
  '',
  "You're one step away — complete your application",
  'Your loan application is still waiting for you',
  'Get the funds you need — apply for your loan today',
  'Final reminder: your loan offer is still available',
];

// ─── Thresholds for each reminder stage (in ms) ───────────────────────────────
const STAGE_DELAYS_MS = [
  1  * 60 * 60 * 1000,  // stage 0→1: 1 hour  after lead created
  24 * 60 * 60 * 1000,  // stage 1→2: 24 hours after stage 1
  3  * 24 * 60 * 60 * 1000,  // stage 2→3: 3 days after stage 2
  7  * 24 * 60 * 60 * 1000,  // stage 3→4: 7 days after stage 3
];

const STAGE_EMAIL_FNS = [
  sendLoanFollowupStage1,
  sendLoanFollowupStage2,
  sendLoanFollowupStage3,
  sendLoanFollowupStage4,
];

// ─── Public: capture lead before payment ─────────────────────────────────────
export async function createLead(req: AuthenticatedRequest, res: Response) {
  const { name, email, phone, loanType, amount, city, source } = req.body;

  if (!name || !email || !phone) {
    return sendError(res, 'name, email and phone are required', 400);
  }

  // Upsert by email — don't overwrite a converted lead
  const existing = await prisma.loanLead.findFirst({ where: { email } });

  if (existing) {
    if (existing.converted) {
      // Already paid — nothing to do
      return sendSuccess(res, { leadId: existing.id }, 'Lead already converted', 200);
    }
    // Update contact info in case it changed
    const updated = await prisma.loanLead.update({
      where: { id: existing.id },
      data: {
        name,
        phone,
        loanType: loanType || existing.loanType,
        amount:   amount ? parseFloat(amount) : existing.amount,
        city:     city   || existing.city,
        source:   source || existing.source,
      },
    });
    return sendSuccess(res, { leadId: updated.id }, 'Lead updated', 200);
  }

  const lead = await prisma.loanLead.create({
    data: {
      name,
      email,
      phone,
      loanType: loanType || null,
      amount:   amount ? parseFloat(amount) : null,
      city:     city   || null,
      source:   source || null,
    },
  });

  return sendSuccess(res, { leadId: lead.id }, 'Lead captured', 201);
}

// ─── Cron: process follow-up reminders ───────────────────────────────────────
export async function processLoanReminders(req: AuthenticatedRequest, res: Response) {
  const secret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return sendError(res, 'Unauthorized', 401);
  }

  const now = new Date();
  const frontendUrl = process.env.FRONTEND_URL || 'https://biddaro.com';
  const apiUrl      = process.env.API_URL       || process.env.FRONTEND_URL || 'https://biddaro.com';

  const leads = await prisma.loanLead.findMany({
    where: {
      converted:     false,
      optOut:        false,
      reminderStage: { lt: 4 },
    },
  });

  let sent = 0;

  for (const lead of leads) {
    const stage = lead.reminderStage;
    const delayMs = STAGE_DELAYS_MS[stage];

    // Reference time: createdAt for stage 0, lastReminderAt for stages 1+
    const refTime = stage === 0 ? lead.createdAt : (lead.lastReminderAt ?? lead.createdAt);
    const elapsed = now.getTime() - refTime.getTime();

    if (elapsed < delayMs) continue;

    const emailFn = STAGE_EMAIL_FNS[stage];
    const stageNum = stage + 1;
    const applyUrl = `${frontendUrl}/loan-apply?utm_source=email&utm_campaign=loan_followup&utm_content=stage${stageNum}`;
    const token    = Buffer.from(lead.id).toString('base64url');
    const unsubUrl = `${apiUrl}/api/v1/loans/lead/unsubscribe/${token}`;

    try {
      await emailFn({
        toEmail:  lead.email,
        toName:   lead.name,
        loanType: lead.loanType || 'construction loan',
        applyUrl,
        unsubUrl,
      });

      await prisma.loanLead.update({
        where: { id: lead.id },
        data: {
          reminderStage:  stage + 1,
          lastReminderAt: now,
        },
      });

      // Also push-notify if lead has a platform account
      const user = await prisma.user.findFirst({ where: { email: lead.email } });
      if (user) {
        const webUrl = process.env.WEB_URL || process.env.FRONTEND_URL || 'https://www.biddaro.com';
        sendPushToUser(user.id, {
          title: 'Complete Your Loan Application',
          body:  STAGE_PUSH_BODIES[stageNum],
          url:   `${webUrl}/loan-apply`,
        }).catch(() => {});
      }

      sent++;
    } catch {
      // don't abort the loop on individual email failure
    }
  }

  return sendSuccess(res, { sent });
}

// ─── Public: one-click unsubscribe ───────────────────────────────────────────
export async function unsubscribeLead(req: AuthenticatedRequest, res: Response) {
  const { token } = req.params;

  let leadId: string;
  try {
    leadId = Buffer.from(token, 'base64url').toString('utf-8');
  } catch {
    return sendError(res, 'Invalid unsubscribe token', 400);
  }

  const lead = await prisma.loanLead.findUnique({ where: { id: leadId } });
  if (!lead) {
    return sendError(res, 'Lead not found', 404);
  }

  await prisma.loanLead.update({
    where: { id: leadId },
    data:  { optOut: true },
  });

  return sendSuccess(res, {}, "You've been unsubscribed from loan reminders.");
}
