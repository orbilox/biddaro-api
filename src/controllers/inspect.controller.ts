/**
 * Biddaro Inspect — AI-Powered Inspection Reports
 *
 * Models: InspectTemplate, InspectProject, InspectCapture, InspectReport
 *
 * Endpoints:
 *   Templates  GET/POST  /inspect/templates
 *              GET/PUT/DELETE /inspect/templates/:id
 *   Projects   GET/POST  /inspect/projects
 *              GET/PUT/DELETE /inspect/projects/:id
 *   Captures   GET/POST  /inspect/projects/:id/captures
 *              DELETE    /inspect/projects/:id/captures/:cid
 *   Reports    POST      /inspect/projects/:id/reports/generate
 *              GET       /inspect/projects/:id/reports
 *              GET/PUT   /inspect/reports/:id
 *              POST      /inspect/reports/:id/send
 */

import { Response } from 'express';
import OpenAI from 'openai';
import { prisma } from '../config/database';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden } from '../utils/response';
import { getPagination } from '../utils/pagination';
import type { AuthenticatedRequest } from '../types';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Ownership guards ─────────────────────────────────────────────────────────

async function getOwnedProject(projectId: string, userId: string) {
  return prisma.inspectProject.findFirst({ where: { id: projectId, userId } });
}

async function getOwnedReport(reportId: string, userId: string) {
  return prisma.inspectReport.findFirst({ where: { id: reportId, userId } });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

export async function listTemplates(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const templates = await prisma.inspectTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { projects: true } } },
    });
    sendSuccess(res, templates);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function createTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { name, description, rawContent, fileUrl } = req.body;

    if (!name) { sendError(res, 'name is required', 400); return; }

    // Use AI to parse the template structure
    let structure: object = { sections: [] };
    if (rawContent) {
      try {
        const parseResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are an inspection report template parser. Given raw report template content, extract the structure as JSON.
Return ONLY valid JSON with this shape:
{
  "sections": [
    { "id": "section-slug", "title": "Section Title", "description": "what goes here", "hasPhotos": true/false, "hasTable": true/false }
  ],
  "tone": "formal|technical|plain",
  "industry": "construction|engineering|property|mep|general"
}`,
            },
            {
              role: 'user',
              content: `Parse this inspection report template:\n\n${rawContent.slice(0, 4000)}`,
            },
          ],
          temperature: 0.1,
        });

        const jsonText = parseResponse.choices[0]?.message?.content ?? '{}';
        const cleaned = jsonText.replace(/```json\n?|\n?```/g, '').trim();
        structure = JSON.parse(cleaned);
      } catch {
        // Fallback to a sensible default structure if AI parsing fails
        structure = {
          sections: [
            { id: 'executive-summary', title: 'Executive Summary', description: 'Overview of inspection findings', hasPhotos: false },
            { id: 'site-observations', title: 'Site Observations', description: 'Detailed on-site findings', hasPhotos: true },
            { id: 'defects-findings', title: 'Defects & Findings', description: 'Issues identified during inspection', hasPhotos: true },
            { id: 'recommendations', title: 'Recommendations', description: 'Actions required', hasPhotos: false },
            { id: 'conclusion', title: 'Conclusion', description: 'Summary and sign-off', hasPhotos: false },
          ],
          tone: 'technical',
          industry: 'construction',
        };
      }
    }

    const template = await prisma.inspectTemplate.create({
      data: { userId, name, description, rawContent, fileUrl, structure },
    });
    sendCreated(res, template);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function getTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const template = await prisma.inspectTemplate.findFirst({ where: { id, userId } });
    if (!template) { sendNotFound(res, 'Template'); return; }
    sendSuccess(res, template);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function updateTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const existing = await prisma.inspectTemplate.findFirst({ where: { id, userId } });
    if (!existing) { sendNotFound(res, 'Template'); return; }
    const { name, description, rawContent, fileUrl } = req.body;
    const template = await prisma.inspectTemplate.update({
      where: { id },
      data: { name, description, rawContent, fileUrl },
    });
    sendSuccess(res, template);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function deleteTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const existing = await prisma.inspectTemplate.findFirst({ where: { id, userId } });
    if (!existing) { sendNotFound(res, 'Template'); return; }
    await prisma.inspectTemplate.delete({ where: { id } });
    sendSuccess(res, { deleted: true });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROJECTS
// ═══════════════════════════════════════════════════════════════════════════════

export async function listProjects(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { page, limit, skip } = getPagination(req as any);
    const { status } = req.query;

    const where: Record<string, unknown> = { userId };
    if (status) where.status = status;

    const [projects, total] = await Promise.all([
      prisma.inspectProject.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          template: { select: { id: true, name: true } },
          _count: { select: { captures: true, reports: true } },
        },
      }),
      prisma.inspectProject.count({ where }),
    ]);

    sendSuccess(res, { projects, total, page, limit });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function createProject(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { name, location, clientName, clientEmail, description, templateId } = req.body;
    if (!name) { sendError(res, 'name is required', 400); return; }

    // Verify template belongs to user if provided
    if (templateId) {
      const tmpl = await prisma.inspectTemplate.findFirst({ where: { id: templateId, userId } });
      if (!tmpl) { sendForbidden(res, 'Template not found'); return; }
    }

    const project = await prisma.inspectProject.create({
      data: { userId, name, location, clientName, clientEmail, description, templateId: templateId ?? null },
      include: { template: { select: { id: true, name: true } } },
    });
    sendCreated(res, project);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function getProject(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const project = await prisma.inspectProject.findFirst({
      where: { id, userId },
      include: {
        template: true,
        captures: { orderBy: { createdAt: 'desc' } },
        reports: { orderBy: { createdAt: 'desc' }, select: { id: true, title: true, status: true, createdAt: true, updatedAt: true } },
      },
    });
    if (!project) { sendNotFound(res, 'Project'); return; }
    sendSuccess(res, project);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function updateProject(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const project = await getOwnedProject(id, userId);
    if (!project) { sendNotFound(res, 'Project'); return; }
    const { name, location, clientName, clientEmail, description, status, templateId } = req.body;
    const updated = await prisma.inspectProject.update({
      where: { id },
      data: { name, location, clientName, clientEmail, description, status, templateId },
      include: { template: { select: { id: true, name: true } } },
    });
    sendSuccess(res, updated);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function deleteProject(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const project = await getOwnedProject(id, userId);
    if (!project) { sendNotFound(res, 'Project'); return; }
    await prisma.inspectProject.delete({ where: { id } });
    sendSuccess(res, { deleted: true });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPTURES
// ═══════════════════════════════════════════════════════════════════════════════

export async function listCaptures(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: projectId } = req.params;
    const project = await getOwnedProject(projectId, userId);
    if (!project) { sendNotFound(res, 'Project'); return; }

    const captures = await prisma.inspectCapture.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    sendSuccess(res, captures);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function addCapture(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: projectId } = req.params;
    const project = await getOwnedProject(projectId, userId);
    if (!project) { sendNotFound(res, 'Project'); return; }

    const { type, content, imageUrl, gpsLat, gpsLng, annotation, section, severity } = req.body;
    if (!type || !['photo', 'voice', 'text'].includes(type)) {
      sendError(res, 'type must be photo|voice|text', 400); return;
    }
    if (type !== 'photo' && !content) {
      sendError(res, 'content is required for voice and text captures', 400); return;
    }
    if (type === 'photo' && !imageUrl) {
      sendError(res, 'imageUrl is required for photo captures', 400); return;
    }

    // Auto-transcribe voice notes if content provided as audio URL
    // (In production this would call a speech-to-text service)

    const capture = await prisma.inspectCapture.create({
      data: {
        projectId,
        type,
        content: content ?? null,
        imageUrl: imageUrl ?? null,
        gpsLat: gpsLat ? parseFloat(gpsLat) : null,
        gpsLng: gpsLng ? parseFloat(gpsLng) : null,
        annotation: annotation ?? null,
        section: section ?? null,
        severity: severity ?? 'normal',
      },
    });
    sendCreated(res, capture);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function updateCapture(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: projectId, cid } = req.params;
    const project = await getOwnedProject(projectId, userId);
    if (!project) { sendNotFound(res, 'Project'); return; }

    const { content, annotation, section, severity } = req.body;
    const capture = await prisma.inspectCapture.update({
      where: { id: cid },
      data: { content, annotation, section, severity },
    });
    sendSuccess(res, capture);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function deleteCapture(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: projectId, cid } = req.params;
    const project = await getOwnedProject(projectId, userId);
    if (!project) { sendNotFound(res, 'Project'); return; }
    await prisma.inspectCapture.delete({ where: { id: cid } });
    sendSuccess(res, { deleted: true });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: projectId } = req.params;

    const project = await prisma.inspectProject.findFirst({
      where: { id: projectId, userId },
      include: {
        template: true,
        captures: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!project) { sendNotFound(res, 'Project'); return; }
    if (project.captures.length === 0) {
      sendError(res, 'Add at least one field capture before generating a report', 400); return;
    }

    // Build the context for AI
    const capturesSummary = project.captures.map((c, i) => {
      const lines = [`[${i + 1}] Type: ${c.type.toUpperCase()} | Section: ${c.section ?? 'General'} | Severity: ${c.severity}`];
      if (c.content) lines.push(`  Content: ${c.content}`);
      if (c.imageUrl) lines.push(`  Photo: ${c.imageUrl}`);
      if (c.annotation) lines.push(`  Annotation: ${c.annotation}`);
      if (c.gpsLat && c.gpsLng) lines.push(`  GPS: ${c.gpsLat.toFixed(6)}, ${c.gpsLng.toFixed(6)}`);
      return lines.join('\n');
    }).join('\n\n');

    // Get template structure
    const templateStructure = project.template?.structure as { sections?: Array<{ id: string; title: string; description: string }> } | null;
    const sections = templateStructure?.sections ?? [
      { id: 'executive-summary', title: 'Executive Summary', description: 'Overview of findings' },
      { id: 'site-observations', title: 'Site Observations', description: 'Detailed on-site observations' },
      { id: 'defects-findings', title: 'Defects & Findings', description: 'Issues identified' },
      { id: 'recommendations', title: 'Recommendations', description: 'Required actions' },
      { id: 'conclusion', title: 'Conclusion', description: 'Summary and sign-off' },
    ];

    const systemPrompt = `You are a professional inspection report writer for construction and engineering projects.
You write clear, precise, technical inspection reports based on field observations.
Your writing is formal, factual, and professional — matching the style used by licensed building inspectors and engineers.
Structure your report according to the sections provided. For each section, write 2-4 paragraphs.
Reference specific observations from the field capture data.
Highlight defects and safety issues clearly with severity levels.
Return the report as a JSON object with this exact structure:
{
  "title": "Inspection Report — [Project Name] — [Date]",
  "sections": [
    {
      "id": "section-id",
      "title": "Section Title",
      "content": "Full prose content for this section. Multiple paragraphs separated by \\n\\n.",
      "findings": ["Finding 1", "Finding 2"],
      "severity": "normal|warning|critical"
    }
  ],
  "summary": {
    "totalFindings": 0,
    "criticalCount": 0,
    "warningCount": 0,
    "normalCount": 0,
    "overallStatus": "satisfactory|requires_attention|critical"
  }
}`;

    const userPrompt = `Generate a professional inspection report for this project:

PROJECT: ${project.name}
LOCATION: ${project.location ?? 'Not specified'}
CLIENT: ${project.clientName ?? 'Not specified'}
DATE: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}

REPORT SECTIONS TO FILL:
${sections.map(s => `- ${s.title}: ${s.description}`).join('\n')}

FIELD CAPTURES (${project.captures.length} total):
${capturesSummary}

Write the full inspection report now as JSON.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const rawJson = completion.choices[0]?.message?.content ?? '{}';
    const reportContent = JSON.parse(rawJson) as {
      title: string;
      sections: Array<{ id: string; title: string; content: string; findings: string[]; severity: string }>;
      summary: { totalFindings: number; criticalCount: number; warningCount: number; normalCount: number; overallStatus: string };
    };

    // Build markdown for easy reading / future export
    const markdown = [
      `# ${reportContent.title}`,
      `**Project:** ${project.name}`,
      `**Location:** ${project.location ?? 'N/A'}`,
      `**Client:** ${project.clientName ?? 'N/A'}`,
      `**Date:** ${new Date().toLocaleDateString()}`,
      '',
      ...reportContent.sections.map(s => [
        `## ${s.title}`,
        s.content,
        s.findings?.length ? `\n**Key Findings:**\n${s.findings.map(f => `- ${f}`).join('\n')}` : '',
      ].filter(Boolean).join('\n\n')),
    ].join('\n\n');

    const report = await prisma.inspectReport.create({
      data: {
        projectId,
        userId,
        title: reportContent.title ?? `Inspection Report — ${project.name}`,
        status: 'draft',
        content: reportContent as object,
        rawMarkdown: markdown,
      },
    });

    sendCreated(res, report);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS — CRUD
// ═══════════════════════════════════════════════════════════════════════════════

export async function listReports(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: projectId } = req.params;
    const project = await getOwnedProject(projectId, userId);
    if (!project) { sendNotFound(res, 'Project'); return; }

    const reports = await prisma.inspectReport.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, status: true, createdAt: true, updatedAt: true, sentAt: true, sentTo: true },
    });
    sendSuccess(res, reports);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function getReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const report = await prisma.inspectReport.findFirst({
      where: { id, userId },
      include: { project: { select: { id: true, name: true, location: true, clientName: true } } },
    });
    if (!report) { sendNotFound(res, 'Report'); return; }
    sendSuccess(res, report);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function updateReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const report = await getOwnedReport(id, userId);
    if (!report) { sendNotFound(res, 'Report'); return; }
    const { title, status, content, rawMarkdown } = req.body;
    const updated = await prisma.inspectReport.update({
      where: { id },
      data: { title, status, content, rawMarkdown },
    });
    sendSuccess(res, updated);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function deleteReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const report = await getOwnedReport(id, userId);
    if (!report) { sendNotFound(res, 'Report'); return; }
    await prisma.inspectReport.delete({ where: { id } });
    sendSuccess(res, { deleted: true });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function sendReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { sentTo } = req.body;
    if (!sentTo) { sendError(res, 'sentTo email is required', 400); return; }

    const report = await getOwnedReport(id, userId);
    if (!report) { sendNotFound(res, 'Report'); return; }

    const updated = await prisma.inspectReport.update({
      where: { id },
      data: { status: 'sent', sentAt: new Date(), sentTo },
    });
    // TODO: integrate email delivery (SendGrid / nodemailer)
    sendSuccess(res, updated);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getDashboardStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const [
      totalProjects,
      activeProjects,
      totalReports,
      draftReports,
      totalCaptures,
    ] = await Promise.all([
      prisma.inspectProject.count({ where: { userId } }),
      prisma.inspectProject.count({ where: { userId, status: 'active' } }),
      prisma.inspectReport.count({ where: { userId } }),
      prisma.inspectReport.count({ where: { userId, status: 'draft' } }),
      prisma.inspectCapture.count({ where: { project: { userId } } }),
    ]);

    const recentProjects = await prisma.inspectProject.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      include: { _count: { select: { captures: true, reports: true } } },
    });

    const recentReports = await prisma.inspectReport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, status: true, createdAt: true, project: { select: { name: true } } },
    });

    sendSuccess(res, {
      stats: { totalProjects, activeProjects, totalReports, draftReports, totalCaptures },
      recentProjects,
      recentReports,
    });
  } catch (err: any) {
    sendError(res, err.message);
  }
}
