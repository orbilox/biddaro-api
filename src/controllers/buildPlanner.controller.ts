import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError, sendNotFound, sendForbidden } from '../utils/response';
import type { AuthenticatedRequest } from '../types';

// ─── Section checklist templates ──────────────────────────────────────────────

const SECTION_TEMPLATES: Record<string, string[]> = {
  site_map: [
    'Define property boundaries & lot size',
    'Mark utility lines (water, gas, electric)',
    'Plan vehicle access & parking',
    'Note natural drainage & grading',
    'Identify sun orientation for passive design',
    'Mark setbacks & easements',
    'Confirm soil conditions & tests',
  ],
  exterior: [
    'Choose architectural style (modern/traditional/etc.)',
    'Select exterior cladding materials',
    'Design roof style & materials',
    'Plan windows & door placement',
    'Design outdoor lighting plan',
    'Plan driveway & pathways',
    'Design landscaping & fencing',
    'Select exterior color palette',
  ],
  interior: [
    'Define all room layouts & purposes',
    'Plan interior traffic flow',
    'Choose flooring materials per room',
    'Plan interior lighting layout',
    'Select wall finishes & paint palette',
    'Design built-in storage solutions',
    'Plan ceiling heights & features',
    'Choose interior doors & hardware',
  ],
  plumbing: [
    'Locate main water supply connection',
    'Design hot & cold water line routing',
    'Plan bathroom & toilet locations',
    'Design kitchen plumbing layout',
    'Water heater type & location',
    'Drainage & sewer connection plan',
    'Outdoor irrigation system',
    'Gas line routing (if applicable)',
  ],
  electrical: [
    'Main electrical panel location & capacity',
    'Outlet placement per room',
    'Lighting circuit design',
    'HVAC electrical requirements',
    'Smart home / automation wiring',
    'EV charging provision',
    'Safety, GFCI & smoke detector placement',
    'Exterior security lighting',
  ],
  structural: [
    'Foundation type (slab/crawlspace/basement)',
    'Load-bearing wall identification',
    'Roof structure & truss design',
    'Beam & column sizing',
    'Seismic & wind load compliance',
    'Material specifications (concrete/steel/wood)',
    'Contractor structural engineer review',
  ],
  hvac: [
    'Heating system type & capacity',
    'Cooling system & zoning plan',
    'Ductwork routing layout',
    'Ventilation & air quality design',
    'Thermostat placement & smart controls',
    'Energy efficiency rating targets',
    'Air filtration system',
  ],
  finishes: [
    'Paint color selection per room',
    'Tile & stone selections',
    'Cabinet styles & hardware',
    'Countertop material selection',
    'Trim, molding & millwork details',
    'Fixture & fitting specifications',
    'Window treatments & blinds',
  ],
  other: [
    'Define scope & goals for this section',
    'Research materials & options',
    'Get contractor input',
    'Finalise design decisions',
    'Budget allocation confirmed',
  ],
};

// ─── Gamification achievements ─────────────────────────────────────────────────

interface AchievementDef {
  slug: string;
  emoji: string;
  title: string;
  description: string;
}

const ACHIEVEMENT_DEFS: AchievementDef[] = [
  { slug: 'first_blueprint',   emoji: '🎯', title: 'Blueprint Started',      description: 'Created your first build plan' },
  { slug: 'visual_planner',    emoji: '📸', title: 'Visual Planner',         description: 'Uploaded 5 or more images' },
  { slug: 'section_added',     emoji: '📐', title: 'Section Added',          description: 'Added your first planning section' },
  { slug: 'site_mapped',       emoji: '🗺️', title: 'Site Mapped',            description: 'Completed the site map section 100%' },
  { slug: 'multi_trade',       emoji: '🔧', title: 'Multi-Trade Planner',    description: 'Created 5 or more planning sections' },
  { slug: 'half_built',        emoji: '🏗️', title: 'Half-Built',             description: 'Reached 50% overall plan completion' },
  { slug: 'blueprint_ready',   emoji: '🏆', title: 'Blueprint Ready',        description: 'Reached 80% overall completion' },
  { slug: 'construction_ready',emoji: '🎊', title: 'Construction Ready!',    description: 'Completed 100% of your entire plan' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireAddon(userId: string, res: Response): Promise<boolean> {
  const rec = await prisma.userAddOn.findUnique({
    where: { userId_addOnSlug: { userId, addOnSlug: 'construction-planner' } },
  });
  if (!rec?.isActive) {
    sendError(res, 'Construction Planner add-on is not installed', 403);
    return false;
  }
  return true;
}

async function ownPlan(planId: string, userId: string): Promise<boolean> {
  const p = await prisma.buildPlan.findUnique({ where: { id: planId }, select: { posterId: true } });
  return p?.posterId === userId;
}

function computeStats(plan: {
  sections: Array<{
    type: string;
    checkItems: Array<{ isChecked: boolean }>;
  }>;
  media: Array<unknown>;
}) {
  const sections = plan.sections;
  const totalItems = sections.reduce((s, sec) => s + sec.checkItems.length, 0);
  const checkedItems = sections.reduce((s, sec) => s + sec.checkItems.filter((i) => i.isChecked).length, 0);
  const overallPercent = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

  const fullyCompletedSections = sections.filter(
    (sec) => sec.checkItems.length > 0 && sec.checkItems.every((i) => i.isChecked)
  );

  return {
    totalSections: sections.length,
    totalItems,
    checkedItems,
    overallPercent,
    fullyCompletedSectionCount: fullyCompletedSections.length,
    completedSectionTypes: fullyCompletedSections.map((s) => s.type),
    totalMedia: plan.media.length,
  };
}

function computeAchievements(stats: ReturnType<typeof computeStats>) {
  return ACHIEVEMENT_DEFS.map((def) => {
    let unlocked = false;
    switch (def.slug) {
      case 'first_blueprint':    unlocked = true; break; // just having a plan unlocks this
      case 'visual_planner':     unlocked = stats.totalMedia >= 5; break;
      case 'section_added':      unlocked = stats.totalSections >= 1; break;
      case 'site_mapped':        unlocked = stats.completedSectionTypes.includes('site_map'); break;
      case 'multi_trade':        unlocked = stats.totalSections >= 5; break;
      case 'half_built':         unlocked = stats.overallPercent >= 50; break;
      case 'blueprint_ready':    unlocked = stats.overallPercent >= 80; break;
      case 'construction_ready': unlocked = stats.overallPercent === 100 && stats.totalSections >= 3; break;
    }
    return { ...def, unlocked };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLANS
// ═══════════════════════════════════════════════════════════════════════════════

export async function listPlans(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  if (!(await requireAddon(userId, res))) return;

  const plans = await prisma.buildPlan.findMany({
    where: { posterId: userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { sections: true, media: true } },
      sections: {
        include: { checkItems: { select: { isChecked: true } } },
      },
    },
  });

  const enriched = plans.map((p) => {
    const stats = computeStats({ sections: p.sections, media: new Array(p._count.media) });
    return {
      id: p.id, title: p.title, description: p.description, buildType: p.buildType,
      emoji: p.emoji, color: p.color, coverImage: p.coverImage, status: p.status,
      address: p.address, totalBudget: p.totalBudget, currency: p.currency,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
      _count: p._count, stats,
    };
  });

  sendSuccess(res, enriched);
}

export async function createPlan(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  if (!(await requireAddon(userId, res))) return;

  const { title, description, buildType, address, totalBudget, currency, emoji, color, coverImage } = req.body;
  if (!title?.trim()) { sendError(res, 'Title is required'); return; }

  const plan = await prisma.buildPlan.create({
    data: {
      posterId: userId,
      title: title.trim(),
      description: description?.trim() || null,
      buildType: buildType || 'residential',
      address: address?.trim() || null,
      totalBudget: totalBudget ? parseFloat(totalBudget) : null,
      currency: currency || 'USD',
      emoji: emoji || '🏗️',
      color: color || '#3b82f6',
      coverImage: coverImage?.trim() || null,
    },
  });

  res.status(201).json({ success: true, message: 'Build plan created', data: plan });
}

export async function getPlan(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownPlan(id, userId))) { sendForbidden(res); return; }

  const plan = await prisma.buildPlan.findUnique({
    where: { id },
    include: {
      sections: {
        orderBy: { order: 'asc' },
        include: {
          checkItems: { orderBy: { order: 'asc' } },
          media: { orderBy: { addedAt: 'desc' } },
        },
      },
      media: { orderBy: { addedAt: 'desc' } },
    },
  });
  if (!plan) { sendNotFound(res, 'Plan'); return; }

  const stats = computeStats(plan);
  const achievements = computeAchievements(stats);

  sendSuccess(res, { plan, stats, achievements });
}

export async function updatePlan(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownPlan(id, userId))) { sendForbidden(res); return; }

  const { title, description, buildType, address, totalBudget, currency, emoji, color, coverImage, status } = req.body;

  const plan = await prisma.buildPlan.update({
    where: { id },
    data: {
      ...(title        !== undefined && { title: title.trim() }),
      ...(description  !== undefined && { description: description.trim() || null }),
      ...(buildType    !== undefined && { buildType }),
      ...(address      !== undefined && { address: address.trim() || null }),
      ...(totalBudget  !== undefined && { totalBudget: totalBudget ? parseFloat(totalBudget) : null }),
      ...(currency     !== undefined && { currency }),
      ...(emoji        !== undefined && { emoji }),
      ...(color        !== undefined && { color }),
      ...(coverImage   !== undefined && { coverImage: coverImage.trim() || null }),
      ...(status       !== undefined && { status }),
    },
  });
  sendSuccess(res, plan);
}

export async function deletePlan(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownPlan(id, userId))) { sendForbidden(res); return; }
  await prisma.buildPlan.delete({ where: { id } });
  sendSuccess(res, null, 'Build plan deleted');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export async function addSection(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { planId } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownPlan(planId, userId))) { sendForbidden(res); return; }

  const { type, title, notes } = req.body;
  if (!type?.trim()) { sendError(res, 'Section type is required'); return; }

  const sectionCount = await prisma.buildSection.count({ where: { planId } });

  const section = await prisma.buildSection.create({
    data: {
      planId,
      type: type.trim(),
      title: title?.trim() || type.trim(),
      notes: notes?.trim() || null,
      order: sectionCount,
    },
  });

  // Auto-populate checklist from template
  const templateItems = SECTION_TEMPLATES[type] ?? SECTION_TEMPLATES.other;
  if (templateItems.length > 0) {
    await prisma.buildCheckItem.createMany({
      data: templateItems.map((label, i) => ({
        sectionId: section.id,
        label,
        order: i,
      })),
    });
  }

  const fullSection = await prisma.buildSection.findUnique({
    where: { id: section.id },
    include: { checkItems: { orderBy: { order: 'asc' } } },
  });

  res.status(201).json({ success: true, message: 'Section added', data: fullSection });
}

export async function updateSection(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { sectionId } = req.params;
  if (!(await requireAddon(userId, res))) return;

  const section = await prisma.buildSection.findUnique({
    where: { id: sectionId },
    include: { plan: { select: { posterId: true } } },
  });
  if (!section || section.plan.posterId !== userId) { sendForbidden(res); return; }

  const { title, notes } = req.body;
  const updated = await prisma.buildSection.update({
    where: { id: sectionId },
    data: {
      ...(title !== undefined && { title: title.trim() }),
      ...(notes !== undefined && { notes: notes.trim() || null }),
    },
    include: { checkItems: { orderBy: { order: 'asc' } } },
  });
  sendSuccess(res, updated);
}

export async function deleteSection(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { sectionId } = req.params;
  if (!(await requireAddon(userId, res))) return;

  const section = await prisma.buildSection.findUnique({
    where: { id: sectionId },
    include: { plan: { select: { posterId: true } } },
  });
  if (!section || section.plan.posterId !== userId) { sendForbidden(res); return; }

  await prisma.buildSection.delete({ where: { id: sectionId } });
  sendSuccess(res, null, 'Section deleted');
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK ITEMS
// ═══════════════════════════════════════════════════════════════════════════════

export async function toggleCheckItem(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { itemId } = req.params;
  if (!(await requireAddon(userId, res))) return;

  const item = await prisma.buildCheckItem.findUnique({
    where: { id: itemId },
    include: { section: { include: { plan: { select: { posterId: true } } } } },
  });
  if (!item || item.section.plan.posterId !== userId) { sendForbidden(res); return; }

  const updated = await prisma.buildCheckItem.update({
    where: { id: itemId },
    data: { isChecked: !item.isChecked },
  });
  sendSuccess(res, updated);
}

export async function addCheckItem(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { sectionId } = req.params;
  if (!(await requireAddon(userId, res))) return;

  const section = await prisma.buildSection.findUnique({
    where: { id: sectionId },
    include: { plan: { select: { posterId: true } } },
  });
  if (!section || section.plan.posterId !== userId) { sendForbidden(res); return; }

  const { label } = req.body;
  if (!label?.trim()) { sendError(res, 'Label is required'); return; }

  const count = await prisma.buildCheckItem.count({ where: { sectionId } });
  const item = await prisma.buildCheckItem.create({
    data: { sectionId, label: label.trim(), order: count },
  });

  res.status(201).json({ success: true, message: 'Item added', data: item });
}

export async function deleteCheckItem(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { itemId } = req.params;
  if (!(await requireAddon(userId, res))) return;

  const item = await prisma.buildCheckItem.findUnique({
    where: { id: itemId },
    include: { section: { include: { plan: { select: { posterId: true } } } } },
  });
  if (!item || item.section.plan.posterId !== userId) { sendForbidden(res); return; }

  await prisma.buildCheckItem.delete({ where: { id: itemId } });
  sendSuccess(res, null, 'Item deleted');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA
// ═══════════════════════════════════════════════════════════════════════════════

export async function listMedia(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { planId } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownPlan(planId, userId))) { sendForbidden(res); return; }

  const media = await prisma.buildMedia.findMany({
    where: { planId },
    orderBy: { addedAt: 'desc' },
    include: { section: { select: { id: true, type: true, title: true } } },
  });
  sendSuccess(res, media);
}

export async function addMedia(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { planId } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownPlan(planId, userId))) { sendForbidden(res); return; }

  const { name, url, mediaType, caption, sectionId } = req.body;
  if (!name?.trim() || !url?.trim()) { sendError(res, 'Name and URL are required'); return; }

  if (sectionId) {
    const sec = await prisma.buildSection.findFirst({ where: { id: sectionId, planId } });
    if (!sec) { sendError(res, 'Section not found in this plan'); return; }
  }

  const media = await prisma.buildMedia.create({
    data: {
      planId,
      sectionId: sectionId || null,
      addedById: userId,
      name: name.trim(),
      url: url.trim(),
      mediaType: mediaType || 'image',
      caption: caption?.trim() || null,
    },
    include: { section: { select: { id: true, type: true, title: true } } },
  });

  res.status(201).json({ success: true, message: 'Media added', data: media });
}

export async function deleteMedia(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { mediaId } = req.params;
  if (!(await requireAddon(userId, res))) return;

  const media = await prisma.buildMedia.findUnique({
    where: { id: mediaId },
    include: { plan: { select: { posterId: true } } },
  });
  if (!media || media.plan.posterId !== userId) { sendForbidden(res); return; }

  await prisma.buildMedia.delete({ where: { id: mediaId } });
  sendSuccess(res, null, 'Media deleted');
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACHIEVEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getAchievements(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { planId } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownPlan(planId, userId))) { sendForbidden(res); return; }

  const plan = await prisma.buildPlan.findUnique({
    where: { id: planId },
    include: {
      sections: { include: { checkItems: { select: { isChecked: true } } } },
      media: { select: { id: true } },
    },
  });
  if (!plan) { sendNotFound(res, 'Plan'); return; }

  const stats = computeStats(plan);
  const achievements = computeAchievements(stats);
  sendSuccess(res, { achievements, stats });
}
