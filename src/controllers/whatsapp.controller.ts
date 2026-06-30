import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess } from '../utils/response';
import { normalizeWhatsAppPhone } from '../utils/whatsapp';
import type { AuthenticatedRequest } from '../types';

// ─── Webhook: Meta verification handshake (GET) ───────────────────────────────
export function verifyWhatsAppWebhook(req: Request, res: Response) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(String(challenge));
  }
  return res.sendStatus(403);
}

// ─── Webhook: delivery/read status callbacks + inbound STOP (POST) ────────────
const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

export async function receiveWhatsAppWebhook(req: Request, res: Response) {
  // Always 200 fast so Meta doesn't retry; process best-effort.
  res.sendStatus(200);

  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry?.changes || []) {
        const value = change?.value || {};

        // 1) Delivery / read / failed status updates
        for (const st of value.statuses || []) {
          const messageId = st?.id;
          const status    = st?.status;            // sent | delivered | read | failed
          if (!messageId || !status) continue;
          const error = Array.isArray(st?.errors) && st.errors[0]?.title ? st.errors[0].title : undefined;

          const log = await prisma.whatsAppLog.findUnique({ where: { messageId } });
          if (!log) continue;
          // Don't downgrade (e.g. a late "delivered" after "read"); failures always apply.
          if (status !== 'failed' && (RANK[status] || 0) <= (RANK[log.status] || 0)) continue;
          await prisma.whatsAppLog.update({
            where: { messageId },
            data: { status, error: status === 'failed' ? (error || 'failed') : log.error },
          });
        }

        // 2) Inbound "STOP" → opt the lead out
        for (const msg of value.messages || []) {
          const text = msg?.text?.body?.trim()?.toLowerCase();
          const from = msg?.from;
          if (!from || !text) continue;
          if (text === 'stop' || text === 'unsubscribe') {
            const norm = normalizeWhatsAppPhone(from);
            const leads = await prisma.loanLead.findMany({ where: { optOut: false } });
            const match = leads.find((l) => normalizeWhatsAppPhone(l.phone) === norm);
            if (match) await prisma.loanLead.update({ where: { id: match.id }, data: { optOut: true } });
          }
        }
      }
    }
  } catch (err) {
    console.error('[whatsapp] webhook processing error:', (err as Error).message);
  }
}

// ─── Admin: WhatsApp follow-up stats ──────────────────────────────────────────
export async function adminWhatsAppStats(_req: AuthenticatedRequest, res: Response) {
  const [byStatus, logs, recent] = await Promise.all([
    prisma.whatsAppLog.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.whatsAppLog.findMany({ select: { stage: true, status: true } }),
    prisma.whatsAppLog.findMany({
      orderBy: { sentAt: 'desc' },
      take: 50,
      include: { lead: { select: { name: true, email: true } } },
    }),
  ]);

  const totals = { sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const row of byStatus) {
    if (row.status in totals) totals[row.status as keyof typeof totals] = row._count._all;
  }
  const total = totals.sent + totals.delivered + totals.read + totals.failed;
  // delivered/read are "reached"; a read message was also delivered.
  const reached   = totals.delivered + totals.read;
  const delivered = reached;               // anything delivered or read
  const read      = totals.read;

  // Per-stage breakdown (stages 1..7)
  const byStage: Record<number, { total: number; delivered: number; read: number; failed: number }> = {};
  for (let s = 1; s <= 7; s++) byStage[s] = { total: 0, delivered: 0, read: 0, failed: 0 };
  for (const l of logs) {
    const b = byStage[l.stage];
    if (!b) continue;
    b.total++;
    if (l.status === 'read') { b.read++; b.delivered++; }
    else if (l.status === 'delivered') b.delivered++;
    else if (l.status === 'failed') b.failed++;
  }

  return sendSuccess(res, {
    totals: { total, sent: totals.sent, delivered, read, failed: totals.failed },
    rates: {
      delivery: total ? Math.round((delivered / total) * 100) : 0,
      read:     total ? Math.round((read / total) * 100) : 0,
    },
    byStage,
    recentLogs: recent,
  });
}
