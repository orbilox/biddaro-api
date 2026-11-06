/**
 * Job Alerts — notify matching contractors the moment a job is posted.
 *
 * Channels: in-app Notification + web/mobile push + email.
 * WhatsApp is intentionally NOT included yet — it needs a Meta-approved
 * "job alert" template plus explicit contractor opt-in (see notifyMatchingContractors
 * call site / README). Push + email go to registered contractors about jobs that
 * match their trade, and each contractor can opt out via notifPrefs.jobAlerts.
 *
 * Called fire-and-forget from createJob — it must never block or fail the
 * job-post response.
 */

import { prisma } from '../config/database';
import { sendPushToUser, userWantsPush } from './push';
import { sendNewJobEmail } from './email';

const NOTIF_TYPE = 'job_alert';
const NOTIF_PREF = 'jobAlerts';

// Caps (override via env if needed)
const MAX_MATCHES_PER_JOB = Number(process.env.JOB_ALERT_MAX_MATCHES || 200); // in-app + push
const MAX_EMAILS_PER_JOB = Number(process.env.JOB_ALERT_MAX_EMAILS || 40);
const MAX_ALERTS_PER_CONTRACTOR_PER_DAY = Number(process.env.JOB_ALERT_DAILY_CAP || 8);

// Contractor skills that should match any job's trade
const GENERIC_SKILLS = ['general', 'general construction', 'renovation', 'other'];

export interface JobLike {
  id: string;
  posterId: string;
  title: string;
  category: string;
  skills: string | null;
  location: string;
  budget: number;
  currency: string;
}

function parseArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

const norm = (s: string): string => s.trim().toLowerCase();

/** True if any of the contractor's skills overlaps the job's trade terms. */
function matchesTrade(contractorSkills: string[], jobTerms: string[]): boolean {
  for (const cs of contractorSkills) {
    if (GENERIC_SKILLS.includes(cs)) return true;
    for (const jt of jobTerms) {
      if (!jt) continue;
      if (cs === jt || cs.includes(jt) || jt.includes(cs)) return true;
    }
  }
  return false;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Find contractors whose trade + country match a newly-posted job and notify them.
 * Safe to call without awaiting; swallows its own errors.
 */
export async function notifyMatchingContractors(job: JobLike): Promise<void> {
  // The job's country = the poster's country, so a US job doesn't ping IN contractors.
  const poster = await prisma.user.findUnique({
    where: { id: job.posterId },
    select: { country: true },
  });
  const country = poster?.country || null;

  const jobTerms = [job.category, ...parseArray(job.skills)].filter(Boolean).map(norm);
  const jobCity = norm(job.location || '');

  // Candidate pool: active contractors in the same country (never the poster).
  const candidates = await prisma.user.findMany({
    where: {
      role: 'contractor',
      isActive: true,
      id: { not: job.posterId },
      ...(country ? { country } : {}),
    },
    select: { id: true, email: true, firstName: true, skills: true, location: true },
  });

  // Match by trade, then rank same-city first.
  const matches: { id: string; email: string | null; name: string; sameCity: boolean }[] = [];
  for (const c of candidates) {
    const cs = parseArray(c.skills).map(norm);
    if (cs.length === 0) continue;
    if (!matchesTrade(cs, jobTerms)) continue;
    const sameCity = Boolean(jobCity) && norm(c.location || '') === jobCity;
    matches.push({ id: c.id, email: c.email, name: c.firstName || 'there', sameCity });
  }
  matches.sort((a, b) => Number(b.sameCity) - Number(a.sameCity));

  const recipients = matches.slice(0, MAX_MATCHES_PER_JOB);
  if (recipients.length === 0) {
    console.log(`[JobAlerts] job ${job.id}: no matching contractors`);
    return;
  }

  // Dry run: set JOB_ALERTS_ENABLED=false to watch matching quality in logs
  // without sending anything. Flip to true (or unset) to send for real.
  if (process.env.JOB_ALERTS_ENABLED === 'false') {
    console.log(
      `[JobAlerts] DRY RUN job ${job.id} (${job.category} @ ${job.location}): ` +
        `${matches.length} matched, would notify ${recipients.length} ` +
        `(same-city ${matches.filter((m) => m.sameCity).length})`,
    );
    return;
  }

  // Per-contractor daily cap — one grouped query instead of one per recipient.
  const todayStart = startOfToday();
  const todayCounts = await prisma.notification.groupBy({
    by: ['userId'],
    where: { userId: { in: recipients.map((r) => r.id) }, type: NOTIF_TYPE, createdAt: { gte: todayStart } },
    _count: { _all: true },
  });
  const countByUser = new Map(todayCounts.map((c) => [c.userId, c._count._all]));

  const title = 'New job near you';
  const message = `${job.title} — ${job.category}${job.location ? ` in ${job.location}` : ''}. Be the first to bid.`;
  const url = `/jobs/${job.id}`;

  let pushed = 0;
  let emailsSent = 0;

  for (const r of recipients) {
    try {
      if ((countByUser.get(r.id) || 0) >= MAX_ALERTS_PER_CONTRACTOR_PER_DAY) continue;

      // In-app notification (always)
      await prisma.notification
        .create({
          data: {
            userId: r.id,
            type: NOTIF_TYPE,
            title,
            message,
            data: JSON.stringify({ jobId: job.id, url, category: job.category }),
          },
        })
        .catch(() => {});

      const wants = await userWantsPush(r.id, NOTIF_PREF); // reads notifPrefs.jobAlerts (default on)

      // Push (web + mobile)
      if (wants) {
        sendPushToUser(r.id, { title, body: message, url }).catch(() => {});
        pushed++;
      }

      // Email (stricter cap; same-city prioritized by the earlier sort)
      if (wants && r.email && emailsSent < MAX_EMAILS_PER_JOB) {
        sendNewJobEmail({
          contractorEmail: r.email,
          contractorName: r.name,
          jobTitle: job.title,
          category: job.category,
          location: job.location,
          budget: job.budget,
          currency: job.currency,
          jobId: job.id,
        }).catch(() => {});
        emailsSent++;
      }
    } catch (err) {
      console.error(`[JobAlerts] recipient ${r.id} failed:`, err);
    }
  }

  console.log(
    `[JobAlerts] job ${job.id}: matched ${matches.length}, notified ${recipients.length} (push ${pushed}, email ${emailsSent})`,
  );
}
