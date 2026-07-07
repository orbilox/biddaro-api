import crypto from 'crypto';
import { Response } from 'express';
import { prisma } from '../config/database';
import { razorpay } from '../utils/razorpay';
import { sendSuccess, sendError, sendNotFound } from '../utils/response';
import { sendPushToUser } from '../utils/push';
import type { AuthenticatedRequest } from '../types';

const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const RESERVED_SLUGS = new Set([
  'me', 'admin', 'api', 'www', 'biddaro', 'app', 'login', 'register', 'dashboard',
  'contractor', 'contractors', 'jobs', 'loans', 'inspect', 'support', 'help',
  'about', 'contact', 'privacy', 'terms', 'blog', 'site', 'sites', 'new', 'edit',
]);

const SITE_PRO_AMOUNT_PAISE = 19900; // ₹199/month

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

// ─── Public: GET /sites/:slug ─────────────────────────────────────────────────
export async function getPublicSite(req: AuthenticatedRequest, res: Response) {
  const slug = String(req.params.slug || '').toLowerCase();

  const site = await prisma.contractorSite.findUnique({
    where: { slug },
    include: {
      user: {
        select: {
          id: true, firstName: true, lastName: true, profileImage: true,
          location: true, bio: true, skills: true, yearsExperience: true,
          hourlyRate: true, isVerified: true, verificationStatus: true,
          portfolio: true, certifications: true, workHistory: true,
          receivedReviews: {
            include: { reviewer: { select: { firstName: true, lastName: true, profileImage: true } } },
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
          _count: { select: { contractsAsContractor: true, receivedReviews: true } },
        },
      },
    },
  });

  if (!site || !site.enabled) { sendNotFound(res, 'Site'); return; }

  // Fire-and-forget view counter
  prisma.contractorSite.update({ where: { id: site.id }, data: { views: { increment: 1 } } }).catch(() => {});

  const reviews = site.user.receivedReviews;
  const averageRating = reviews.length > 0
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : null;

  sendSuccess(res, {
    site: {
      slug: site.slug,
      headline: site.headline,
      about: site.about,
      services: parseJson<string[]>(site.services, []),
      accentColor: site.accentColor,
      whatsapp: site.isPro ? site.whatsapp : null,
      showReviews: site.showReviews,
      showPortfolio: site.showPortfolio,
      isPro: site.isPro,
    },
    contractor: {
      id: site.user.id,
      firstName: site.user.firstName,
      lastName: site.user.lastName,
      profileImage: site.user.profileImage,
      location: site.user.location,
      bio: site.user.bio,
      skills: parseJson<string[]>(site.user.skills, []),
      yearsExperience: site.user.yearsExperience,
      hourlyRate: site.user.hourlyRate,
      isVerified: site.user.isVerified,
      verificationStatus: site.user.verificationStatus,
      portfolio: site.showPortfolio ? parseJson<unknown[]>(site.user.portfolio, []) : [],
      workHistory: parseJson<unknown[]>(site.user.workHistory, []),
      certifications: parseJson<unknown[]>(site.user.certifications, []),
      completedContracts: site.user._count.contractsAsContractor,
      totalReviews: site.user._count.receivedReviews,
      averageRating,
    },
    reviews: site.showReviews ? reviews.map(r => ({
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      reviewer: r.reviewer,
    })) : [],
  });
}

// ─── Auth'd: GET /sites/me/site ───────────────────────────────────────────────
export async function getMySite(req: AuthenticatedRequest, res: Response) {
  const site = await prisma.contractorSite.findUnique({ where: { userId: req.user!.userId } });
  sendSuccess(res, { site });
}

// ─── Auth'd: PUT /sites/me/site (create or update) ────────────────────────────
export async function upsertMySite(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const { slug, headline, about, services, accentColor, whatsapp, showReviews, showPortfolio, enabled } = req.body;

  const existing = await prisma.contractorSite.findUnique({ where: { userId } });

  // Slug validation (required on create; optional change on update)
  let normalizedSlug: string | undefined;
  if (slug !== undefined || !existing) {
    normalizedSlug = String(slug || '').toLowerCase().trim();
    if (!SLUG_RE.test(normalizedSlug)) {
      return sendError(res, 'Slug must be 3-40 characters: lowercase letters, numbers, and hyphens only', 400);
    }
    if (RESERVED_SLUGS.has(normalizedSlug)) {
      return sendError(res, 'This address is reserved — please choose another', 400);
    }
    const taken = await prisma.contractorSite.findUnique({ where: { slug: normalizedSlug } });
    if (taken && taken.userId !== userId) {
      return sendError(res, 'This address is already taken', 409);
    }
  }

  const isPro = existing?.isPro ?? false;

  const data: Record<string, unknown> = {};
  if (normalizedSlug)            data.slug = normalizedSlug;
  if (headline !== undefined)    data.headline = headline ? String(headline).slice(0, 120) : null;
  if (about !== undefined)       data.about = about ? String(about).slice(0, 2000) : null;
  if (services !== undefined)    data.services = JSON.stringify(
    (Array.isArray(services) ? services : []).map(String).map(s => s.slice(0, 40)).slice(0, 12),
  );
  if (showReviews !== undefined)   data.showReviews = !!showReviews;
  if (showPortfolio !== undefined) data.showPortfolio = !!showPortfolio;
  if (enabled !== undefined)       data.enabled = !!enabled;
  // Pro-only fields — silently ignored on the free tier
  if (isPro && accentColor !== undefined) data.accentColor = accentColor ? String(accentColor).slice(0, 9) : '#EA580C';
  if (isPro && whatsapp !== undefined)    data.whatsapp = whatsapp ? String(whatsapp).slice(0, 20) : null;

  const site = existing
    ? await prisma.contractorSite.update({ where: { userId }, data })
    : await prisma.contractorSite.create({ data: { userId, slug: normalizedSlug!, ...data } });

  sendSuccess(res, { site }, existing ? 'Site updated' : 'Site created');
}

// ─── Public: POST /sites/:slug/lead (quote request — Pro sites only) ──────────
export async function createSiteLead(req: AuthenticatedRequest, res: Response) {
  const slug = String(req.params.slug || '').toLowerCase();
  const { name, phone, message } = req.body;

  if (!name || !phone) return sendError(res, 'Name and phone are required', 400);

  const site = await prisma.contractorSite.findUnique({ where: { slug } });
  if (!site || !site.enabled) { sendNotFound(res, 'Site'); return; }
  if (!site.isPro) return sendError(res, 'This site does not accept quote requests', 403);

  const lead = await prisma.websiteLead.create({
    data: {
      siteId: site.id,
      name:    String(name).slice(0, 80),
      phone:   String(phone).slice(0, 20),
      message: message ? String(message).slice(0, 1000) : null,
    },
  });

  sendPushToUser(site.userId, {
    title: 'New quote request 🎉',
    body:  `${lead.name} wants a quote via your Biddaro site`,
    url:   '/my-site?tab=leads',
  }).catch(() => {});

  sendSuccess(res, { leadId: lead.id }, 'Request sent', 201);
}

// ─── Auth'd: GET /sites/me/leads ──────────────────────────────────────────────
export async function getMyLeads(req: AuthenticatedRequest, res: Response) {
  const site = await prisma.contractorSite.findUnique({ where: { userId: req.user!.userId } });
  if (!site) { sendSuccess(res, { leads: [] }); return; }
  const leads = await prisma.websiteLead.findMany({
    where: { siteId: site.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  sendSuccess(res, { leads, views: site.views });
}

// ─── Auth'd: POST /sites/me/subscribe — create ₹199/mo Razorpay subscription ──
export async function subscribeSitePro(req: AuthenticatedRequest, res: Response) {
  try {
    let planId = process.env.RAZORPAY_SITE_PLAN_ID;

    if (!planId) {
      console.warn('[Razorpay] RAZORPAY_SITE_PLAN_ID not set — creating a one-off plan. Set this env var to reuse it.');
      const plan = await (razorpay.plans as any).create({
        period:   'monthly',
        interval: 1,
        item: {
          name:        'Biddaro Sites Pro',
          amount:      SITE_PRO_AMOUNT_PAISE,
          currency:    'INR',
          description: 'Monthly subscription for Biddaro Sites Pro (contractor website)',
        },
      });
      planId = plan.id as string;
      console.log(`[Razorpay] Created plan: ${planId} — add RAZORPAY_SITE_PLAN_ID=${planId} to Railway env vars`);
    }

    const subscription = await (razorpay.subscriptions as any).create({
      plan_id:         planId,
      total_count:     120,   // 10 years — effectively ongoing
      customer_notify: 1,
      notes:           { product: 'biddaro_sites_pro', userId: req.user!.userId },
    });

    sendSuccess(res, {
      subscriptionId: subscription.id,
      planId,
      key: process.env.RAZORPAY_KEY_ID,
      amount: SITE_PRO_AMOUNT_PAISE,
    });
  } catch (err: any) {
    const details = err?.error || err;
    console.error('[Razorpay] subscribeSitePro error:', JSON.stringify(details));
    sendError(res, (details as any)?.description || 'Failed to create subscription', 500);
  }
}

// ─── Auth'd: POST /sites/me/verify — verify payment, activate Pro ─────────────
export async function verifySitePro(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;

  if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
    return sendError(res, 'Missing payment verification fields', 400);
  }

  // Subscription checkout signature: HMAC-SHA256(payment_id|subscription_id)
  const expectedSig = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
    .digest('hex');

  if (expectedSig !== razorpay_signature) {
    return sendError(res, 'Payment verification failed', 400);
  }

  const site = await prisma.contractorSite.findUnique({ where: { userId } });
  if (!site) return sendError(res, 'Create your site before upgrading', 400);

  const updated = await prisma.contractorSite.update({
    where: { userId },
    data: {
      isPro: true,
      proExpiresAt: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000),
    },
  });

  sendSuccess(res, { site: updated }, 'Biddaro Sites Pro activated 🎉');
}
