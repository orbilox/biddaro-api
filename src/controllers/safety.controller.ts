import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendCreated, sendError, sendNotFound } from '../utils/response';
import { sendPushToUser } from '../utils/push';
import type { AuthenticatedRequest } from '../types';
import { SAFETY_TOPICS, DEFAULT_AUDIT_TEMPLATES } from '../data/safetyContent';

const HAZARD_TYPES = ['fall', 'electrical', 'fire', 'ppe', 'housekeeping', 'machinery', 'excavation', 'other'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const HAZARD_STATUSES = ['open', 'in_progress', 'closed'];

interface AuditItem {
  id: string;
  section: string;
  label: string;
  result?: 'pass' | 'fail' | 'na' | null;
  photoUrl?: string | null;
  note?: string | null;
}

interface Attendee {
  name: string;
  photoUrl?: string | null;
  signature?: string | null;
  recordedAt?: string;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function computeScore(items: AuditItem[]): number | null {
  const pass = items.filter((i) => i.result === 'pass').length;
  const fail = items.filter((i) => i.result === 'fail').length;
  if (pass + fail === 0) return null;
  return Math.round((pass / (pass + fail)) * 1000) / 10;
}

/** Load a site owned by the requesting user, or null. */
async function ownedSite(userId: string, siteId: string) {
  return prisma.safetySite.findFirst({ where: { id: siteId, userId } });
}

// ─── Content library ─────────────────────────────────────────────────────────

export async function getTopics(_req: AuthenticatedRequest, res: Response) {
  sendSuccess(res, { topics: SAFETY_TOPICS });
}

export async function getDefaultTemplates(_req: AuthenticatedRequest, res: Response) {
  sendSuccess(res, { templates: DEFAULT_AUDIT_TEMPLATES });
}

// ─── Sites ───────────────────────────────────────────────────────────────────

export async function listSites(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const sites = await prisma.safetySite.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { talks: true, audits: true, hazards: true } },
    },
  });

  // Attach latest completed audit score + open hazard count per site
  const withStats = await Promise.all(sites.map(async (site) => {
    const [latestAudit, openHazards] = await Promise.all([
      prisma.safetyAudit.findFirst({
        where: { siteId: site.id, status: 'completed' },
        orderBy: { completedAt: 'desc' },
        select: { score: true, completedAt: true },
      }),
      prisma.safetyHazard.count({ where: { siteId: site.id, status: { not: 'closed' } } }),
    ]);
    return { ...site, latestScore: latestAudit?.score ?? null, openHazards };
  }));

  sendSuccess(res, { sites: withStats });
}

export async function createSite(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const { name, location, clientName } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    sendError(res, 'Site name is required'); return;
  }
  const site = await prisma.safetySite.create({
    data: { userId, name: name.trim(), location: location || null, clientName: clientName || null },
  });
  sendCreated(res, { site });
}

export async function getSite(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const site = await prisma.safetySite.findFirst({
    where: { id: req.params.id, userId },
    include: { _count: { select: { talks: true, audits: true, hazards: true } } },
  });
  if (!site) { sendNotFound(res, 'Site'); return; }

  const [latestAudit, openHazards, lastTalk] = await Promise.all([
    prisma.safetyAudit.findFirst({
      where: { siteId: site.id, status: 'completed' },
      orderBy: { completedAt: 'desc' },
      select: { id: true, score: true, completedAt: true, templateName: true },
    }),
    prisma.safetyHazard.count({ where: { siteId: site.id, status: { not: 'closed' } } }),
    prisma.safetyToolboxTalk.findFirst({
      where: { siteId: site.id },
      orderBy: { conductedAt: 'desc' },
      select: { id: true, topicTitle: true, conductedAt: true },
    }),
  ]);

  sendSuccess(res, { site: { ...site, latestAudit, openHazards, lastTalk } });
}

export async function updateSite(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const existing = await ownedSite(userId, req.params.id);
  if (!existing) { sendNotFound(res, 'Site'); return; }

  const { name, location, clientName, status } = req.body || {};
  const site = await prisma.safetySite.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(location !== undefined ? { location: location || null } : {}),
      ...(clientName !== undefined ? { clientName: clientName || null } : {}),
      ...(status !== undefined && ['active', 'completed', 'archived'].includes(status) ? { status } : {}),
    },
  });
  sendSuccess(res, { site });
}

export async function deleteSite(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const existing = await ownedSite(userId, req.params.id);
  if (!existing) { sendNotFound(res, 'Site'); return; }
  await prisma.safetySite.delete({ where: { id: existing.id } });
  sendSuccess(res, { deleted: true });
}

// ─── Toolbox talks ───────────────────────────────────────────────────────────

export async function listSiteTalks(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const site = await ownedSite(userId, req.params.id);
  if (!site) { sendNotFound(res, 'Site'); return; }
  const talks = await prisma.safetyToolboxTalk.findMany({
    where: { siteId: site.id },
    orderBy: { conductedAt: 'desc' },
  });
  sendSuccess(res, { talks });
}

export async function createTalk(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const site = await ownedSite(userId, req.params.id);
  if (!site) { sendNotFound(res, 'Site'); return; }

  const { topicKey, topicTitle, talkingPoints, notes, attendees, gpsLat, gpsLng, conductedAt } = req.body || {};
  if (!topicTitle || typeof topicTitle !== 'string') { sendError(res, 'Topic title is required'); return; }

  // Snapshot talking points: from request, or from the library by key
  let points: string[] = asArray<string>(talkingPoints).filter((p) => typeof p === 'string');
  if (points.length === 0 && topicKey) {
    const topic = SAFETY_TOPICS.find((t) => t.key === topicKey);
    if (topic) points = topic.points;
  }

  const cleanAttendees: Attendee[] = asArray<Attendee>(attendees)
    .filter((a) => a && typeof a.name === 'string' && a.name.trim())
    .map((a) => ({
      name: a.name.trim(),
      photoUrl: a.photoUrl || null,
      signature: a.signature || null,
      recordedAt: a.recordedAt || new Date().toISOString(),
    }));

  const talk = await prisma.safetyToolboxTalk.create({
    data: {
      siteId: site.id,
      userId,
      topicKey: topicKey || 'custom',
      topicTitle: topicTitle.trim(),
      talkingPoints: points,
      notes: notes || null,
      attendees: cleanAttendees as object[],
      gpsLat: typeof gpsLat === 'number' ? gpsLat : null,
      gpsLng: typeof gpsLng === 'number' ? gpsLng : null,
      ...(conductedAt ? { conductedAt: new Date(conductedAt) } : {}),
    },
  });
  sendCreated(res, { talk });
}

export async function listAllTalks(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const talks = await prisma.safetyToolboxTalk.findMany({
    where: { userId },
    orderBy: { conductedAt: 'desc' },
    take: 100,
    include: { site: { select: { id: true, name: true } } },
  });
  sendSuccess(res, { talks });
}

export async function getTalk(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const talk = await prisma.safetyToolboxTalk.findFirst({
    where: { id: req.params.id, userId },
    include: { site: { select: { id: true, name: true, location: true } } },
  });
  if (!talk) { sendNotFound(res, 'Toolbox talk'); return; }
  sendSuccess(res, { talk });
}

export async function deleteTalk(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const talk = await prisma.safetyToolboxTalk.findFirst({ where: { id: req.params.id, userId } });
  if (!talk) { sendNotFound(res, 'Toolbox talk'); return; }
  await prisma.safetyToolboxTalk.delete({ where: { id: talk.id } });
  sendSuccess(res, { deleted: true });
}

// ─── Custom audit templates ──────────────────────────────────────────────────

export async function listTemplates(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const templates = await prisma.safetyAuditTemplate.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });
  sendSuccess(res, { templates });
}

export async function createTemplate(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const { name, structure } = req.body || {};
  if (!name || typeof name !== 'string') { sendError(res, 'Template name is required'); return; }
  if (!Array.isArray(structure) || structure.length === 0) {
    sendError(res, 'Template structure (sections with items) is required'); return;
  }
  const template = await prisma.safetyAuditTemplate.create({
    data: { userId, name: name.trim(), structure },
  });
  sendCreated(res, { template });
}

export async function updateTemplate(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const existing = await prisma.safetyAuditTemplate.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) { sendNotFound(res, 'Template'); return; }
  const { name, structure } = req.body || {};
  const template = await prisma.safetyAuditTemplate.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(Array.isArray(structure) ? { structure } : {}),
    },
  });
  sendSuccess(res, { template });
}

export async function deleteTemplate(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const existing = await prisma.safetyAuditTemplate.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) { sendNotFound(res, 'Template'); return; }
  await prisma.safetyAuditTemplate.delete({ where: { id: existing.id } });
  sendSuccess(res, { deleted: true });
}

// ─── Audits ──────────────────────────────────────────────────────────────────

export async function listSiteAudits(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const site = await ownedSite(userId, req.params.id);
  if (!site) { sendNotFound(res, 'Site'); return; }
  const audits = await prisma.safetyAudit.findMany({
    where: { siteId: site.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, templateName: true, status: true, score: true,
      completedAt: true, createdAt: true, items: true,
    },
  });
  // Trim items to a progress summary for the list view
  const summarized = audits.map((a) => {
    const items = asArray<AuditItem>(a.items);
    const answered = items.filter((i) => i.result).length;
    const failed = items.filter((i) => i.result === 'fail').length;
    const { items: _items, ...rest } = a;
    return { ...rest, totalItems: items.length, answeredItems: answered, failedItems: failed };
  });
  sendSuccess(res, { audits: summarized });
}

export async function createAudit(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const site = await ownedSite(userId, req.params.id);
  if (!site) { sendNotFound(res, 'Site'); return; }

  const { templateId, builtinKey } = req.body || {};

  let items: AuditItem[] = [];
  let templateName = 'Custom Audit';
  let dbTemplateId: string | null = null;

  if (templateId) {
    const template = await prisma.safetyAuditTemplate.findFirst({ where: { id: templateId, userId } });
    if (!template) { sendNotFound(res, 'Template'); return; }
    templateName = template.name;
    dbTemplateId = template.id;
    items = flattenStructure(template.structure);
  } else {
    const builtin = DEFAULT_AUDIT_TEMPLATES.find((t) => t.key === (builtinKey || 'general_site_audit'));
    if (!builtin) { sendNotFound(res, 'Built-in template'); return; }
    templateName = builtin.name;
    items = flattenStructure(builtin.structure);
  }

  if (items.length === 0) { sendError(res, 'Template has no checklist items'); return; }

  const audit = await prisma.safetyAudit.create({
    data: {
      siteId: site.id,
      userId,
      templateId: dbTemplateId,
      templateName,
      items: items as unknown as object[],
    },
  });
  sendCreated(res, { audit });
}

function flattenStructure(structure: unknown): AuditItem[] {
  const sections = asArray<{ section?: string; items?: { id?: string; label?: string }[] }>(structure);
  const items: AuditItem[] = [];
  for (const sec of sections) {
    for (const item of asArray<{ id?: string; label?: string }>(sec.items)) {
      if (!item.label) continue;
      items.push({
        id: item.id || `item_${items.length + 1}`,
        section: sec.section || 'General',
        label: item.label,
        result: null,
        photoUrl: null,
        note: null,
      });
    }
  }
  return items;
}

export async function getAudit(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const audit = await prisma.safetyAudit.findFirst({
    where: { id: req.params.id, userId },
    include: { site: { select: { id: true, name: true, location: true } } },
  });
  if (!audit) { sendNotFound(res, 'Audit'); return; }
  sendSuccess(res, { audit });
}

export async function updateAudit(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const existing = await prisma.safetyAudit.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) { sendNotFound(res, 'Audit'); return; }
  if (existing.status === 'completed') { sendError(res, 'Audit is already completed'); return; }

  const { items, auditorSignature } = req.body || {};
  const audit = await prisma.safetyAudit.update({
    where: { id: existing.id },
    data: {
      ...(Array.isArray(items) ? { items } : {}),
      ...(auditorSignature !== undefined ? { auditorSignature: auditorSignature || null } : {}),
    },
  });
  sendSuccess(res, { audit });
}

export async function completeAudit(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const existing = await prisma.safetyAudit.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) { sendNotFound(res, 'Audit'); return; }

  // Accept a final items payload with the completion call, if provided
  const bodyItems = Array.isArray(req.body?.items) ? (req.body.items as AuditItem[]) : null;
  const items = bodyItems ?? asArray<AuditItem>(existing.items);
  const score = computeScore(items);
  if (score === null) { sendError(res, 'Answer at least one checklist item before completing'); return; }

  const audit = await prisma.safetyAudit.update({
    where: { id: existing.id },
    data: {
      ...(bodyItems ? { items: bodyItems as unknown as object[] } : {}),
      ...(req.body?.auditorSignature !== undefined ? { auditorSignature: req.body.auditorSignature || null } : {}),
      status: 'completed',
      score,
      completedAt: new Date(),
    },
  });
  sendSuccess(res, { audit });
}

export async function deleteAudit(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const existing = await prisma.safetyAudit.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) { sendNotFound(res, 'Audit'); return; }
  await prisma.safetyAudit.delete({ where: { id: existing.id } });
  sendSuccess(res, { deleted: true });
}

/** POST /audits/:id/actions — convert failed audit items into assigned hazards. */
export async function createAuditActions(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const audit = await prisma.safetyAudit.findFirst({
    where: { id: req.params.id, userId },
    include: { site: { select: { id: true, name: true } } },
  });
  if (!audit) { sendNotFound(res, 'Audit'); return; }

  const { itemIds, assigneeUserId, assigneeName, dueDate, severity } = req.body || {};
  const wanted: string[] = asArray<string>(itemIds);
  const items = asArray<AuditItem>(audit.items).filter(
    (i) => i.result === 'fail' && (wanted.length === 0 || wanted.includes(i.id)),
  );
  if (items.length === 0) { sendError(res, 'No failed items to convert'); return; }

  // Skip items that already have a hazard for this audit
  const existing = await prisma.safetyHazard.findMany({
    where: { auditId: audit.id },
    select: { auditItemId: true },
  });
  const done = new Set(existing.map((h) => h.auditItemId));
  const fresh = items.filter((i) => !done.has(i.id));
  if (fresh.length === 0) { sendError(res, 'Hazards already created for these items'); return; }

  const sev = SEVERITIES.includes(severity) ? severity : 'medium';
  const hazards = await Promise.all(fresh.map((item) =>
    prisma.safetyHazard.create({
      data: {
        siteId: audit.siteId,
        userId,
        auditId: audit.id,
        auditItemId: item.id,
        type: 'other',
        severity: sev,
        description: `${item.section}: ${item.label}`,
        photoUrl: item.photoUrl || null,
        assigneeUserId: assigneeUserId || null,
        assigneeName: assigneeName || null,
        ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
      },
    }),
  ));

  if (assigneeUserId) {
    sendPushToUser(assigneeUserId, {
      title: '🦺 Safety actions assigned',
      body: `${hazards.length} corrective action(s) from audit at ${audit.site.name}`,
    }).catch(() => {});
  }

  sendCreated(res, { hazards, created: hazards.length });
}

// ─── Hazards ─────────────────────────────────────────────────────────────────

export async function listHazards(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const { siteId, status, severity, overdue } = req.query as Record<string, string | undefined>;

  const where: Record<string, unknown> = {
    OR: [{ userId }, { assigneeUserId: userId }, { site: { userId } }],
  };
  if (siteId) where.siteId = siteId;
  if (status && HAZARD_STATUSES.includes(status)) where.status = status;
  if (severity && SEVERITIES.includes(severity)) where.severity = severity;
  if (overdue === 'true') {
    where.status = { not: 'closed' };
    where.dueDate = { lt: new Date() };
  }

  const hazards = await prisma.safetyHazard.findMany({
    where,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 200,
    include: { site: { select: { id: true, name: true } } },
  });
  sendSuccess(res, { hazards });
}

export async function createHazard(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const site = await ownedSite(userId, req.params.id);
  if (!site) { sendNotFound(res, 'Site'); return; }

  const {
    type, severity, description, locationNote, photoUrl,
    gpsLat, gpsLng, assigneeUserId, assigneeName, dueDate,
  } = req.body || {};

  const hazard = await prisma.safetyHazard.create({
    data: {
      siteId: site.id,
      userId,
      type: HAZARD_TYPES.includes(type) ? type : 'other',
      severity: SEVERITIES.includes(severity) ? severity : 'medium',
      description: description || null,
      locationNote: locationNote || null,
      photoUrl: photoUrl || null,
      gpsLat: typeof gpsLat === 'number' ? gpsLat : null,
      gpsLng: typeof gpsLng === 'number' ? gpsLng : null,
      assigneeUserId: assigneeUserId || null,
      assigneeName: assigneeName || null,
      ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
    },
  });

  if (assigneeUserId) {
    sendPushToUser(assigneeUserId, {
      title: '⚠️ Hazard assigned to you',
      body: `${severityLabel(hazard.severity)} hazard at ${site.name}${description ? `: ${String(description).slice(0, 80)}` : ''}`,
    }).catch(() => {});
  }

  sendCreated(res, { hazard });
}

function severityLabel(sev: string): string {
  return sev.charAt(0).toUpperCase() + sev.slice(1);
}

export async function getHazard(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const hazard = await prisma.safetyHazard.findFirst({
    where: {
      id: req.params.id,
      OR: [{ userId }, { assigneeUserId: userId }, { site: { userId } }],
    },
    include: { site: { select: { id: true, name: true, location: true } } },
  });
  if (!hazard) { sendNotFound(res, 'Hazard'); return; }
  sendSuccess(res, { hazard });
}

export async function updateHazard(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const existing = await prisma.safetyHazard.findFirst({
    where: {
      id: req.params.id,
      OR: [{ userId }, { assigneeUserId: userId }, { site: { userId } }],
    },
    include: { site: { select: { id: true, name: true } } },
  });
  if (!existing) { sendNotFound(res, 'Hazard'); return; }

  const {
    type, severity, description, locationNote, photoUrl, fixedPhotoUrl,
    status, assigneeUserId, assigneeName, dueDate,
  } = req.body || {};

  if (status === 'closed' && !fixedPhotoUrl && !existing.fixedPhotoUrl) {
    sendError(res, 'Add a photo of the fixed condition before closing this hazard'); return;
  }

  const reassigned = assigneeUserId && assigneeUserId !== existing.assigneeUserId;

  const hazard = await prisma.safetyHazard.update({
    where: { id: existing.id },
    data: {
      ...(type !== undefined && HAZARD_TYPES.includes(type) ? { type } : {}),
      ...(severity !== undefined && SEVERITIES.includes(severity) ? { severity } : {}),
      ...(description !== undefined ? { description: description || null } : {}),
      ...(locationNote !== undefined ? { locationNote: locationNote || null } : {}),
      ...(photoUrl !== undefined ? { photoUrl: photoUrl || null } : {}),
      ...(fixedPhotoUrl !== undefined ? { fixedPhotoUrl: fixedPhotoUrl || null } : {}),
      ...(assigneeUserId !== undefined ? { assigneeUserId: assigneeUserId || null } : {}),
      ...(assigneeName !== undefined ? { assigneeName: assigneeName || null } : {}),
      ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
      ...(status !== undefined && HAZARD_STATUSES.includes(status)
        ? { status, ...(status === 'closed' ? { closedAt: new Date() } : { closedAt: null }) }
        : {}),
    },
  });

  if (reassigned) {
    sendPushToUser(assigneeUserId, {
      title: '⚠️ Hazard assigned to you',
      body: `${severityLabel(hazard.severity)} hazard at ${existing.site.name}`,
    }).catch(() => {});
  }

  sendSuccess(res, { hazard });
}

export async function deleteHazard(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const existing = await prisma.safetyHazard.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) { sendNotFound(res, 'Hazard'); return; }
  await prisma.safetyHazard.delete({ where: { id: existing.id } });
  sendSuccess(res, { deleted: true });
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export async function getDashboard(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const { siteId } = req.query as Record<string, string | undefined>;

  const siteFilter = siteId ? { siteId } : { site: { userId } };
  if (siteId) {
    const site = await ownedSite(userId, siteId);
    if (!site) { sendNotFound(res, 'Site'); return; }
  }

  const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    sitesCount, openBySeverity, overdueCount, recentAudits,
    talks30d, talksRecent, hazardsRecent,
  ] = await Promise.all([
    prisma.safetySite.count({ where: { userId, status: 'active' } }),
    prisma.safetyHazard.groupBy({
      by: ['severity'],
      where: { ...siteFilter, status: { not: 'closed' } },
      _count: { _all: true },
    }),
    prisma.safetyHazard.count({
      where: { ...siteFilter, status: { not: 'closed' }, dueDate: { lt: new Date() } },
    }),
    prisma.safetyAudit.findMany({
      where: { ...siteFilter, status: 'completed' },
      orderBy: { completedAt: 'desc' },
      take: 10,
      select: { id: true, score: true, completedAt: true, templateName: true, site: { select: { name: true } } },
    }),
    prisma.safetyToolboxTalk.count({ where: { ...siteFilter, conductedAt: { gte: d30 } } }),
    prisma.safetyToolboxTalk.findMany({
      where: siteFilter,
      orderBy: { conductedAt: 'desc' },
      take: 60,
      select: { conductedAt: true },
    }),
    prisma.safetyHazard.findMany({
      where: siteFilter,
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true, type: true, severity: true, status: true, description: true,
        createdAt: true, site: { select: { name: true } },
      },
    }),
  ]);

  // Talk streak: consecutive calendar days (ending today or yesterday) with ≥1 talk
  const dayset = new Set(talksRecent.map((t) => t.conductedAt.toISOString().slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  if (!dayset.has(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1);
  while (dayset.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const openHazards: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const row of openBySeverity) openHazards[row.severity] = row._count._all;

  sendSuccess(res, {
    sitesCount,
    openHazards,
    openHazardsTotal: Object.values(openHazards).reduce((a, b) => a + b, 0),
    overdueCount,
    talkStreak: streak,
    talks30d,
    scoreTrend: recentAudits
      .map((a) => ({ id: a.id, score: a.score, completedAt: a.completedAt, templateName: a.templateName, siteName: a.site.name }))
      .reverse(),
    recentHazards: hazardsRecent,
  });
}

// ─── Settings (PDF branding) ─────────────────────────────────────────────────

export async function getSettings(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const settings = await prisma.safetySettings.findUnique({ where: { userId } });
  sendSuccess(res, { settings });
}

export async function updateSettings(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId;
  const { companyName, logoUrl, brandColor, footerText } = req.body || {};
  const data = {
    companyName: companyName || null,
    logoUrl: logoUrl || null,
    brandColor: brandColor || null,
    footerText: footerText || null,
  };
  const settings = await prisma.safetySettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  sendSuccess(res, { settings });
}
