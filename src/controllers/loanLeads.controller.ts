import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError } from '../utils/response';
import {
  sendLoanFollowupStage1,
  sendLoanFollowupStage2,
  sendLoanFollowupStage3,
  sendLoanFollowupStage4,
  sendLoanFollowupStage5,
  sendLoanFollowupStage6,
  sendLoanFollowupStage7,
} from '../utils/email';
import { sendPushToUser } from '../utils/push';
import { sendWhatsAppTemplate, normalizeWhatsAppPhone, isWhatsAppConfigured } from '../utils/whatsapp';
import type { AuthenticatedRequest } from '../types';

const STAGE_PUSH_BODIES = [
  '',
  "You're one step away — complete your loan application",
  'Your profile looks eligible — confirm your loan now ✓',
  'Pre-approval check started — complete the last step',
  '🎉 Your loan has been pre-approved — claim it now!',
  'Your pre-approved loan amount is waiting for you',
  '⏰ URGENT: Your pre-approved offer expires in 48 hours',
  '🔴 Last chance — your loan offer closes tonight',
];

// Short Hinglish utility lines passed as the {{2}} variable of the loan_followup template.
const STAGE_WHATSAPP_BODIES = [
  '',
  'aapki loan application abhi tak complete nahi hui — bas ek step baaki hai.',
  'aapka profile eligible lag raha hai — apni loan application confirm kijiye.',
  'aapki pre-approval check shuru ho gayi hai — last step complete kijiye.',
  'badhai ho! aapki loan pre-approved hai — abhi claim kijiye.',
  'aapka pre-approved loan amount aapka intezaar kar raha hai.',
  'zaroori: aapka pre-approved offer 48 ghante mein expire ho raha hai.',
  'aakhri mauka — aapka loan offer aaj raat band ho raha hai.',
];

// ─── 7-stage journey, all within 7 days ──────────────────────────────────────
const STAGE_DELAYS_MS = [
  30  * 60 * 1000,            // 0→1: 30 min after lead captured
  5.5 * 60 * 60 * 1000,      // 1→2: 5.5h  (6h total from capture)
  18  * 60 * 60 * 1000,      // 2→3: 18h   (24h total)
  24  * 60 * 60 * 1000,      // 3→4: 24h   (2 days total)
  2   * 24 * 60 * 60 * 1000, // 4→5: 2 days (4 days total)
  2   * 24 * 60 * 60 * 1000, // 5→6: 2 days (6 days total)
  24  * 60 * 60 * 1000,      // 6→7: 24h   (7 days total)
];

const STAGE_EMAIL_FNS = [
  sendLoanFollowupStage1,
  sendLoanFollowupStage2,
  sendLoanFollowupStage3,
  sendLoanFollowupStage4,
  sendLoanFollowupStage5,
  sendLoanFollowupStage6,
  sendLoanFollowupStage7,
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
      reminderStage: { lt: 7 },
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
        amount:   lead.amount,
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

      // Also WhatsApp the lead (no-op until Meta is configured); log every attempt.
      if (isWhatsAppConfigured()) {
        sendWhatsAppTemplate(
          normalizeWhatsAppPhone(lead.phone),
          [lead.name, STAGE_WHATSAPP_BODIES[stageNum], applyUrl],
        )
          .then((messageId) => prisma.whatsAppLog.create({
            data: { leadId: lead.id, phone: lead.phone, stage: stageNum, messageId, status: 'sent' },
          }))
          .catch((err) => prisma.whatsAppLog.create({
            data: { leadId: lead.id, phone: lead.phone, stage: stageNum, status: 'failed', error: String(err?.message || err) },
          }).catch(() => {}));
      }

      sent++;
    } catch {
      // don't abort the loop on individual email failure
    }
  }

  return sendSuccess(res, { sent });
}

// ─── Admin: list all loan leads ───────────────────────────────────────────────
export async function adminListLoanLeads(req: AuthenticatedRequest, res: Response) {
  const page   = Math.max(1, parseInt(String(req.query.page  || '1')));
  const limit  = Math.min(100, parseInt(String(req.query.limit || '50')));
  const skip   = (page - 1) * limit;
  const filter = req.query.filter as string | undefined; // 'active' | 'converted' | 'optout'

  const where: Record<string, unknown> = {};
  if (filter === 'active')    { where.converted = false; where.optOut = false; }
  if (filter === 'converted') { where.converted = true; }
  if (filter === 'optout')    { where.optOut = true; }

  const [leads, total] = await prisma.$transaction([
    prisma.loanLead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.loanLead.count({ where }),
  ]);

  return sendSuccess(res, { leads, total, page, limit });
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
