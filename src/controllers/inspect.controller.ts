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
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, Table, TableRow, TableCell, WidthType, ShadingType,
  Footer, PageNumber, Header, LevelFormat,
} from 'docx';
import PDFDocument from 'pdfkit';
import { prisma } from '../config/database';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden } from '../utils/response';
import { getPagination } from '../utils/pagination';
import type { AuthenticatedRequest } from '../types';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── AI Photo Captioning ──────────────────────────────────────────────────────

/**
 * Uses GPT-4o Vision to generate an inspector-grade caption for a site photo.
 * Returns a 2-3 sentence technical description focused on defects, materials,
 * conditions and safety concerns visible in the image.
 */
async function captionImage(imageUrl: string): Promise<string> {
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'You are an expert construction and building inspector. Examine this site photo and write a 2-3 sentence technical caption from an inspector\'s perspective. Focus on: visible defects, material conditions, structural elements, safety hazards, measurements if visible, and severity of any issues. Be specific, factual and professional. Do not start with "The image shows" — go straight to the observation.',
          },
          {
            type: 'image_url',
            image_url: { url: imageUrl, detail: 'high' },
          },
        ],
      }],
    });
    return res.choices[0]?.message?.content?.trim() ?? 'Photo recorded — no description available.';
  } catch {
    return 'Photo recorded — AI captioning unavailable.';
  }
}

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

/**
 * POST /inspect/projects/:id/captures/:cid/caption
 * Runs GPT-4o Vision on the photo capture and saves the AI-generated caption
 * to the capture's `content` field. Returns the updated capture.
 */
export async function captionCapture(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: projectId, cid } = req.params;

    const project = await getOwnedProject(projectId, userId);
    if (!project) { sendNotFound(res, 'Project'); return; }

    const capture = await prisma.inspectCapture.findFirst({ where: { id: cid, projectId } });
    if (!capture) { sendNotFound(res, 'Capture'); return; }
    if (capture.type !== 'photo' || !capture.imageUrl) {
      sendError(res, 'AI captioning is only available for photo captures with an image URL', 400); return;
    }

    const aiCaption = await captionImage(capture.imageUrl);
    const updated = await prisma.inspectCapture.update({
      where: { id: cid },
      data: { content: aiCaption },
    });
    sendSuccess(res, updated);
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

    // Auto-caption photos that have no text content yet
    // Run all vision calls in parallel to minimise latency
    const captionedCaptures = await Promise.all(
      project.captures.map(async (c) => {
        if (c.type === 'photo' && c.imageUrl && !c.content) {
          const aiCaption = await captionImage(c.imageUrl);
          return { ...c, content: aiCaption, _aiCaptioned: true };
        }
        return { ...c, _aiCaptioned: false };
      })
    );

    // Persist any new AI captions back to the DB (fire-and-forget, don't block report generation)
    const captionUpdates = captionedCaptures
      .filter(c => c._aiCaptioned)
      .map(c => prisma.inspectCapture.update({ where: { id: c.id }, data: { content: c.content } }));
    if (captionUpdates.length > 0) Promise.all(captionUpdates).catch(() => {/* best-effort */});

    // Build the context for AI
    const capturesSummary = captionedCaptures.map((c, i) => {
      const lines = [`[${i + 1}] Type: ${c.type.toUpperCase()} | Section: ${c.section ?? 'General'} | Severity: ${c.severity}`];
      if (c.content) lines.push(`  Content: ${c.content}`);
      if (c.imageUrl) lines.push(`  Photo URL: ${c.imageUrl}`);
      if (c.annotation) lines.push(`  Annotation: ${c.annotation}`);
      if (c.gpsLat && c.gpsLng) lines.push(`  GPS: ${c.gpsLat.toFixed(6)}, ${c.gpsLng.toFixed(6)}`);
      if ((c as typeof c & { _aiCaptioned: boolean })._aiCaptioned) lines.push(`  (Caption was AI-generated from photo)`);
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
// TASKS — Create from findings, track to completion
// ═══════════════════════════════════════════════════════════════════════════════

export async function listTasks(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: reportId } = req.params;
    // Verify the report belongs to this user
    const report = await getOwnedReport(reportId, userId);
    if (!report) { sendNotFound(res, 'Report'); return; }

    const tasks = await prisma.inspectTask.findMany({
      where: { reportId },
      orderBy: { createdAt: 'asc' },
    });
    sendSuccess(res, tasks);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function createTask(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: reportId } = req.params;

    const report = await prisma.inspectReport.findFirst({
      where: { id: reportId, userId },
      select: { id: true, projectId: true },
    });
    if (!report) { sendNotFound(res, 'Report'); return; }

    const { title, description, severity, assignedTo, dueDate, sourceSection, sourceFinding } = req.body;
    if (!title?.trim()) { sendError(res, 'title is required', 400); return; }

    const task = await prisma.inspectTask.create({
      data: {
        userId,
        reportId,
        projectId: report.projectId,
        title: title.trim(),
        description: description?.trim() ?? null,
        severity: severity ?? 'normal',
        assignedTo: assignedTo?.trim() ?? null,
        dueDate: dueDate ? new Date(dueDate) : null,
        sourceSection: sourceSection ?? null,
        sourceFinding: sourceFinding ?? null,
      },
    });
    sendCreated(res, task);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function updateTask(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { tid } = req.params;

    const existing = await prisma.inspectTask.findFirst({ where: { id: tid, userId } });
    if (!existing) { sendNotFound(res, 'Task'); return; }

    const { title, description, status, severity, assignedTo, dueDate } = req.body;
    const task = await prisma.inspectTask.update({
      where: { id: tid },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(severity !== undefined && { severity }),
        ...(assignedTo !== undefined && { assignedTo }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      },
    });
    sendSuccess(res, task);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function deleteTask(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { tid } = req.params;
    const existing = await prisma.inspectTask.findFirst({ where: { id: tid, userId } });
    if (!existing) { sendNotFound(res, 'Task'); return; }
    await prisma.inspectTask.delete({ where: { id: tid } });
    sendSuccess(res, { deleted: true });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PORTFOLIO SEARCH — Natural Language AI Assistant
// ═══════════════════════════════════════════════════════════════════════════════

type SearchResult = {
  reportId: string;
  reportTitle: string;
  projectName: string;
  projectId: string;
  section: string;
  excerpt: string;
  severity: string;
  createdAt: string;
};

type SearchResponse = {
  answer: string;
  results: SearchResult[];
  totalReports: number;
};

export async function searchPortfolio(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { query } = req.body;
    if (!query?.trim()) { sendError(res, 'query is required', 400); return; }

    // Fetch all reports for this user with project info and content
    const reports = await prisma.inspectReport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 80,  // Cap at 80 to stay within token limits
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        content: true,
        project: { select: { id: true, name: true, location: true, clientName: true } },
      },
    });

    if (reports.length === 0) {
      sendSuccess(res, {
        answer: 'No reports found in your portfolio yet. Generate your first AI report from a project.',
        results: [],
        totalReports: 0,
      } satisfies SearchResponse);
      return;
    }

    // Serialise reports into compact context the AI can reason over
    const reportContext = reports.map((r, i) => {
      const content = r.content as {
        sections?: Array<{ title: string; content: string; findings?: string[]; severity?: string }>;
        summary?: { overallStatus: string; totalFindings: number; criticalCount: number };
      };
      const sections = content?.sections ?? [];
      const sectionText = sections.map(s =>
        `  [${s.severity?.toUpperCase() ?? 'NORMAL'}] ${s.title}: ${s.content?.slice(0, 400) ?? ''}` +
        (s.findings?.length ? `\n  Findings: ${s.findings.slice(0, 5).join(' | ')}` : '')
      ).join('\n');

      return [
        `--- REPORT ${i + 1} ---`,
        `ID: ${r.id}`,
        `Title: ${r.title}`,
        `Project: ${r.project.name}${r.project.location ? ` (${r.project.location})` : ''}`,
        `Client: ${r.project.clientName ?? 'N/A'}`,
        `Date: ${new Date(r.createdAt).toLocaleDateString()}`,
        `Status: ${r.status}`,
        `Overall: ${content?.summary?.overallStatus ?? 'N/A'} | Findings: ${content?.summary?.totalFindings ?? 0} | Critical: ${content?.summary?.criticalCount ?? 0}`,
        `Sections:\n${sectionText}`,
      ].join('\n');
    }).join('\n\n');

    const systemPrompt = `You are an intelligent inspection portfolio assistant for a construction inspection platform.
You have access to all of the user's inspection reports. Answer their question precisely and helpfully.

INSTRUCTIONS:
- Answer the question directly and concisely (2-4 sentences)
- Identify specific reports, sections, and findings that are relevant
- If the query is a search (find reports with X), list matching reports
- If the query is analytical (how many reports have Y), compute the answer
- Always cite report IDs and titles when referencing specific reports
- Be professional and technical in tone

Return your response as a JSON object with this exact structure:
{
  "answer": "Direct answer to the question in 2-4 sentences.",
  "results": [
    {
      "reportId": "report-id",
      "reportTitle": "Report title",
      "projectName": "Project name",
      "projectId": "project-id",
      "section": "Section name where match was found",
      "excerpt": "Relevant quote or finding from the report (max 200 chars)",
      "severity": "normal|warning|critical",
      "createdAt": "ISO date string"
    }
  ]
}
Only include results that are genuinely relevant to the query. Return an empty array if none are relevant.`;

    const userPrompt = `QUERY: "${query}"

PORTFOLIO (${reports.length} reports):
${reportContext}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { answer?: string; results?: SearchResult[] };

    // Enrich results with createdAt from the report data we already have
    const enriched = (parsed.results ?? []).map(r => {
      const found = reports.find(rep => rep.id === r.reportId);
      return {
        ...r,
        projectId: found?.project?.id ?? r.projectId ?? '',
        createdAt: found?.createdAt?.toISOString() ?? r.createdAt,
      };
    });

    sendSuccess(res, {
      answer: parsed.answer ?? 'No answer generated.',
      results: enriched,
      totalReports: reports.length,
    } satisfies SearchResponse);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT EXPORT — WORD (.docx)
// ═══════════════════════════════════════════════════════════════════════════════

type ReportSection = {
  id: string;
  title: string;
  content: string;
  findings?: string[];
  severity?: string;
};

type ReportContent = {
  title?: string;
  sections: ReportSection[];
  summary?: {
    totalFindings: number;
    criticalCount: number;
    warningCount: number;
    normalCount: number;
    overallStatus: string;
  };
};

function severityColor(severity?: string): string {
  if (severity === 'critical') return 'C0392B';
  if (severity === 'warning')  return 'D68910';
  return '1A5276';
}

function severityLabel(severity?: string): string {
  if (severity === 'critical') return '⚠ CRITICAL';
  if (severity === 'warning')  return '⚠ WARNING';
  return '✓ SATISFACTORY';
}

function buildDocx(
  report: {
    id: string; title: string; status: string; createdAt: Date;
    sentAt: Date | null; sentTo: string | null;
  },
  content: ReportContent,
  project: { name: string; location: string | null; clientName: string | null },
): Promise<Buffer> {
  const { sections, summary } = content;
  const BRAND   = '1E3A5F';   // dark navy
  const DIVIDER = 'BDC3C7';
  const LIGHT   = 'F4F6F8';

  const thin = { style: BorderStyle.SINGLE, size: 1, color: DIVIDER };
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

  // Helper: section summary badge row
  function summaryRow(label: string, value: string | number, color: string) {
    return new TableRow({
      children: [
        new TableCell({
          borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
          width: { size: 7000, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: label, font: 'Arial', size: 20, color: '555555' })] })],
        }),
        new TableCell({
          borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
          width: { size: 2360, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: String(value), font: 'Arial', size: 20, bold: true, color })] })],
        }),
      ],
    });
  }

  const children: Paragraph[] = [];

  // ── Cover block ─────────────────────────────────────────────────────────────
  children.push(
    new Paragraph({
      spacing: { before: 0, after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BRAND, space: 1 } },
      children: [
        new TextRun({ text: 'INSPECTION REPORT', font: 'Arial', size: 40, bold: true, color: BRAND }),
      ],
    }),
    new Paragraph({
      spacing: { before: 240, after: 60 },
      children: [new TextRun({ text: report.title, font: 'Arial', size: 32, bold: true, color: '1C1C1C' })],
    }),
    new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: ' ', size: 8 })] }),
  );

  // Project meta table
  const metaRows = [
    ['Project', project.name],
    ['Location', project.location ?? '—'],
    ['Client', project.clientName ?? '—'],
    ['Date', new Date(report.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })],
    ['Report Status', report.status.toUpperCase()],
  ];
  if (report.sentAt && report.sentTo) {
    metaRows.push(['Sent To', `${report.sentTo} on ${new Date(report.sentAt).toLocaleDateString()}`]);
  }

  const metaTable = new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2880, 6480],
    rows: metaRows.map(([label, value], i) =>
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: i % 2 === 0 ? LIGHT : 'FFFFFF', type: ShadingType.CLEAR },
            borders: { top: thin, bottom: thin, left: thin, right: thin },
            width: { size: 2880, type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 160, right: 80 },
            children: [new Paragraph({ children: [new TextRun({ text: label, font: 'Arial', size: 19, bold: true, color: BRAND })] })],
          }),
          new TableCell({
            shading: { fill: i % 2 === 0 ? LIGHT : 'FFFFFF', type: ShadingType.CLEAR },
            borders: { top: thin, bottom: thin, left: thin, right: thin },
            width: { size: 6480, type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 160, right: 80 },
            children: [new Paragraph({ children: [new TextRun({ text: value, font: 'Arial', size: 19, color: '2C2C2C' })] })],
          }),
        ],
      })
    ),
  });

  children.push(
    metaTable as unknown as Paragraph,
    new Paragraph({ spacing: { before: 300, after: 60 }, children: [new TextRun({ text: ' ', size: 4 })] }),
  );

  // ── Summary block ────────────────────────────────────────────────────────────
  if (summary) {
    const overallColor = summary.overallStatus === 'critical' ? 'C0392B' : summary.overallStatus === 'requires_attention' ? 'D68910' : '1E8449';
    const overallLabel = summary.overallStatus === 'critical' ? '⚠  CRITICAL ISSUES FOUND'
      : summary.overallStatus === 'requires_attention' ? '⚠  REQUIRES ATTENTION'
      : '✓  SATISFACTORY';

    children.push(
      new Paragraph({
        spacing: { before: 240, after: 120 },
        children: [new TextRun({ text: 'FINDINGS SUMMARY', font: 'Arial', size: 22, bold: true, color: BRAND, allCaps: true })],
      }),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [9360],
        rows: [
          new TableRow({
            children: [new TableCell({
              shading: { fill: overallColor === 'C0392B' ? 'FDEDEC' : overallColor === 'D68910' ? 'FEF9E7' : 'EAFAF1', type: ShadingType.CLEAR },
              borders: { top: thin, bottom: thin, left: { style: BorderStyle.SINGLE, size: 16, color: overallColor }, right: thin },
              margins: { top: 100, bottom: 100, left: 200, right: 200 },
              children: [new Paragraph({
                children: [new TextRun({ text: overallLabel, font: 'Arial', size: 24, bold: true, color: overallColor })],
              })],
            })],
          }),
        ],
      }) as unknown as Paragraph,
      new Paragraph({ spacing: { before: 80, after: 0 }, children: [new TextRun({ text: ' ', size: 4 })] }),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [7000, 2360],
        rows: [
          summaryRow('Total Findings', summary.totalFindings, '1C1C1C'),
          summaryRow('Critical Issues', summary.criticalCount, summary.criticalCount > 0 ? 'C0392B' : '1E8449'),
          summaryRow('Warnings', summary.warningCount, summary.warningCount > 0 ? 'D68910' : '1E8449'),
          summaryRow('Satisfactory Items', summary.normalCount, '1E8449'),
        ],
      }) as unknown as Paragraph,
      new Paragraph({ spacing: { before: 300, after: 0 }, children: [new TextRun({ text: ' ', size: 4 })] }),
    );
  }

  // ── Sections ─────────────────────────────────────────────────────────────────
  sections.forEach((section, i) => {
    const sColor = severityColor(section.severity);
    const sLabel = severityLabel(section.severity);

    children.push(
      // Section heading with severity badge
      new Paragraph({
        spacing: { before: i === 0 ? 0 : 360, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: sColor, space: 1 } },
        children: [
          new TextRun({ text: `${i + 1}.  ${section.title}`, font: 'Arial', size: 26, bold: true, color: BRAND }),
          new TextRun({ text: `   ${sLabel}`, font: 'Arial', size: 18, color: sColor }),
        ],
      }),
    );

    // Section content paragraphs
    if (section.content) {
      const paras = section.content.split('\n\n').filter(Boolean);
      paras.forEach(para => {
        children.push(new Paragraph({
          spacing: { before: 120, after: 60 },
          children: [new TextRun({ text: para.trim(), font: 'Arial', size: 22, color: '2C2C2C' })],
        }));
      });
    }

    // Key findings bulleted list
    if (section.findings && section.findings.length > 0) {
      children.push(new Paragraph({
        spacing: { before: 160, after: 60 },
        children: [new TextRun({ text: 'Key Findings', font: 'Arial', size: 22, bold: true, color: BRAND })],
      }));
      section.findings.forEach((finding, fi) => {
        children.push(new Paragraph({
          spacing: { before: 60, after: 60 },
          indent: { left: 360, hanging: 360 },
          children: [
            new TextRun({ text: `${fi + 1}.  `, font: 'Arial', size: 22, bold: true, color: sColor }),
            new TextRun({ text: finding, font: 'Arial', size: 22, color: '2C2C2C' }),
          ],
        }));
      });
    }
  });

  // ── Sign-off ─────────────────────────────────────────────────────────────────
  children.push(
    new Paragraph({ spacing: { before: 480, after: 120 }, border: { top: thin }, children: [] }),
    new Paragraph({
      spacing: { before: 120, after: 60 },
      children: [new TextRun({ text: 'Report Prepared By', font: 'Arial', size: 20, bold: true, color: BRAND })],
    }),
    new Paragraph({
      spacing: { before: 60, after: 60 },
      children: [new TextRun({ text: 'Signature: _________________________________', font: 'Arial', size: 20, color: '555555' })],
    }),
    new Paragraph({
      spacing: { before: 60, after: 60 },
      children: [new TextRun({ text: 'Date: _____________________________________', font: 'Arial', size: 20, color: '555555' })],
    }),
    new Paragraph({
      spacing: { before: 120, after: 60 },
      children: [new TextRun({ text: 'This report was generated using Biddaro Inspect — AI-powered inspection reporting.', font: 'Arial', size: 18, italics: true, color: '888888' })],
    }),
  );

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Arial', size: 22 } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: DIVIDER, space: 1 } },
            children: [
              new TextRun({ text: 'Biddaro Inspect  |  ', font: 'Arial', size: 18, color: '888888' }),
              new TextRun({ text: report.title, font: 'Arial', size: 18, color: '888888' }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 2, color: DIVIDER, space: 1 } },
            children: [
              new TextRun({ text: 'Page ', font: 'Arial', size: 18, color: '888888' }),
              new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 18, color: '888888' }),
              new TextRun({ text: ' of ', font: 'Arial', size: 18, color: '888888' }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Arial', size: 18, color: '888888' }),
              new TextRun({ text: '  |  biddaro.com/inspect', font: 'Arial', size: 18, color: '888888' }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

export async function exportReportDocx(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const report = await prisma.inspectReport.findFirst({
      where: { id, userId },
      include: { project: { select: { name: true, location: true, clientName: true } } },
    });
    if (!report) { sendNotFound(res, 'Report'); return; }

    const content = report.content as ReportContent;
    const buffer = await buildDocx(report, content, report.project);

    const filename = `${report.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

// ─── PDF Export ───────────────────────────────────────────────────────────────

/**
 * Renders a professional inspection report as PDF using PDFKit.
 * Uses built-in Helvetica (no external font files required).
 */
function buildPdf(
  report: {
    id: string; title: string; status: string; createdAt: Date;
    sentAt: Date | null; sentTo: string | null;
  },
  content: ReportContent,
  project: { name: string; location: string | null; clientName: string | null },
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const BRAND   = '#1E3A5F';
    const ACCENT  = '#2E86C1';
    const DIVIDER = '#BDC3C7';
    const LIGHT   = '#F4F6F8';
    const BODY    = '#2C3E50';

    function sevFg(sev?: string) {
      if (sev === 'critical') return '#C0392B';
      if (sev === 'warning')  return '#D68910';
      return '#1A7A4A';
    }
    function sevBg(sev?: string) {
      if (sev === 'critical') return '#FDEDEC';
      if (sev === 'warning')  return '#FEF9E7';
      return '#EAFAF1';
    }
    function sevLabel(sev?: string) {
      if (sev === 'critical') return 'CRITICAL';
      if (sev === 'warning')  return 'WARNING';
      return 'SATISFACTORY';
    }

    // A4: 595.28 x 841.89 pt, margins: left/right=50, top=70, bottom=60
    const LEFT = 50, RIGHT = 545, WIDTH = RIGHT - LEFT;
    const TOP_MARGIN = 70, BOTTOM_MARGIN = 60;

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: TOP_MARGIN, bottom: BOTTOM_MARGIN, left: LEFT, right: 595 - RIGHT },
      autoFirstPage: true,
      bufferPages: true,
      info: {
        Title: report.title || `${project.name} Inspection Report`,
        Author: 'Biddaro Inspect',
        Creator: 'Biddaro Platform',
      },
    });

    // ── Collect output ─────────────────────────────────────────────────────
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const dateStr = new Date(report.createdAt).toLocaleDateString('en-IN', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    // ── Helper: draw page header/footer for all pages ─────────────────────
    function addPageDecorations() {
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        const pageNum = range.start + i + 1;

        // Header rule
        doc.save()
          .moveTo(LEFT, 50).lineTo(RIGHT, 50)
          .strokeColor(DIVIDER).lineWidth(0.5).stroke()
          .font('Helvetica').fontSize(7).fillColor('#999999')
          .text(project.name, LEFT, 36, { width: WIDTH / 2 })
          .text('BIDDARO INSPECT', LEFT + WIDTH / 2, 36, { width: WIDTH / 2, align: 'right' })
        // Footer rule
          .moveTo(LEFT, 790).lineTo(RIGHT, 790)
          .strokeColor(DIVIDER).lineWidth(0.5).stroke()
          .text('Biddaro Inspect — Confidential', LEFT, 796, { width: WIDTH / 2 })
          .text(`Page ${pageNum} of ${range.count}`, LEFT + WIDTH / 2, 796, { width: WIDTH / 2, align: 'right' })
          .restore();
      }
    }

    // ── COVER BLOCK ────────────────────────────────────────────────────────
    // Brand accent top bar
    doc.rect(LEFT - 50, 0, 595, 6).fill(BRAND);

    // Brand name + subtitle
    doc.font('Helvetica-Bold').fontSize(22).fillColor(BRAND)
      .text('BIDDARO INSPECT', LEFT, 24, { width: WIDTH });
    doc.font('Helvetica').fontSize(10).fillColor('#666666')
      .text('AI-Powered Construction Inspection Report', LEFT, 52);

    // Date + status — right-aligned
    doc.font('Helvetica').fontSize(9).fillColor('#888888')
      .text(dateStr, LEFT, 24, { width: WIDTH, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ACCENT)
      .text(`Status: ${(report.status ?? 'draft').toUpperCase()}`, LEFT, 38, { width: WIDTH, align: 'right' });

    // Divider
    doc.moveTo(LEFT, 76).lineTo(RIGHT, 76).strokeColor(DIVIDER).lineWidth(1).stroke();

    // Report title
    doc.font('Helvetica-Bold').fontSize(18).fillColor(BRAND)
      .text(report.title || `${project.name} — Inspection Report`, LEFT, 88, { width: WIDTH });

    let y = doc.y + 14;

    // ── Metadata band ──────────────────────────────────────────────────────
    doc.rect(LEFT, y, WIDTH, 52).fill(LIGHT);
    const colW = WIDTH / 3;
    const labels  = ['Project', 'Location', 'Client'];
    const values  = [project.name, project.location || '—', project.clientName || '—'];
    for (let i = 0; i < 3; i++) {
      const x = LEFT + i * colW + 8;
      doc.font('Helvetica').fontSize(7).fillColor('#888888').text(labels[i], x, y + 8);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#1A1A1A').text(values[i], x, y + 22, { width: colW - 16, lineBreak: false, ellipsis: true });
    }
    y += 60;

    // ── Summary badge ──────────────────────────────────────────────────────
    const { sections, summary } = content;
    if (summary) {
      const statusStr  = summary.overallStatus ?? 'Satisfactory';
      const statusFg   = statusStr.toLowerCase().includes('critical') ? '#C0392B'
        : statusStr.toLowerCase().includes('warning') ? '#D68910'
        : '#1A7A4A';

      doc.rect(LEFT, y, WIDTH, 44).fill('#EAF4FB');
      doc.font('Helvetica-Bold').fontSize(11).fillColor(statusFg)
        .text(`Overall Status: ${statusStr}`, LEFT + 10, y + 10);

      // Mini counters — right side
      const stats = [
        { label: 'Critical', val: summary.criticalCount, col: '#C0392B' },
        { label: 'Warning',  val: summary.warningCount,  col: '#D68910' },
        { label: 'Total',    val: summary.totalFindings, col: BRAND },
      ];
      let sx = RIGHT - 3 * 68;
      for (const s of stats) {
        doc.font('Helvetica-Bold').fontSize(14).fillColor(s.col)
          .text(String(s.val), sx, y + 6, { width: 60, align: 'center' });
        doc.font('Helvetica').fontSize(7).fillColor('#666666')
          .text(s.label, sx, y + 28, { width: 60, align: 'center' });
        sx += 68;
      }
      y += 56;
    }

    // ── Sections ───────────────────────────────────────────────────────────
    for (const section of sections) {
      const fg = sevFg(section.severity);
      const bg = sevBg(section.severity);

      // Check if we need a new page (leaving room for at least heading + content)
      if (y > 700) {
        doc.addPage();
        y = TOP_MARGIN;
      }

      // Section heading band
      doc.rect(LEFT, y, WIDTH, 30).fill(LIGHT);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(BRAND)
        .text(section.title, LEFT + 8, y + 9);

      // Severity badge — right side
      const badge  = sevLabel(section.severity);
      const badgeW = 80;
      doc.rect(RIGHT - badgeW - 4, y + 4, badgeW, 22).fill(bg);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(fg)
        .text(badge, RIGHT - badgeW - 4, y + 11, { width: badgeW, align: 'center' });

      y += 38;

      // Content paragraphs
      if (section.content) {
        const paras = section.content.split('\n\n').filter(Boolean);
        for (const para of paras) {
          if (y > 750) { doc.addPage(); y = TOP_MARGIN; }
          doc.font('Helvetica').fontSize(10).fillColor(BODY)
            .text(para, LEFT, y, { width: WIDTH, lineGap: 2 });
          y = doc.y + 8;
        }
      }

      // Findings numbered list
      if (section.findings && section.findings.length > 0) {
        if (y > 730) { doc.addPage(); y = TOP_MARGIN; }
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#444444')
          .text('Key Findings', LEFT, y);
        y = doc.y + 4;

        for (let fi = 0; fi < section.findings.length; fi++) {
          if (y > 750) { doc.addPage(); y = TOP_MARGIN; }
          // Number bullet
          doc.rect(LEFT, y, 18, 18).fill(fg);
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF')
            .text(String(fi + 1), LEFT, y + 4, { width: 18, align: 'center' });
          // Finding text
          doc.font('Helvetica').fontSize(10).fillColor(BODY)
            .text(section.findings[fi], LEFT + 24, y + 2, { width: WIDTH - 24, lineGap: 2 });
          y = doc.y + 6;
        }
      }

      // Section divider
      if (y < 780) {
        y += 8;
        doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(DIVIDER).lineWidth(0.5).stroke();
        y += 16;
      }
    }

    // ── Sign-off ───────────────────────────────────────────────────────────
    if (y > 720) { doc.addPage(); y = TOP_MARGIN; }
    y += 20;
    doc.moveTo(LEFT, y).lineTo(LEFT + 160, y).strokeColor('#444444').lineWidth(0.5).stroke();
    y += 6;
    doc.font('Helvetica').fontSize(9).fillColor('#888888')
      .text('Authorised Signatory', LEFT, y);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND)
      .text('Biddaro Inspect', LEFT, y + 14);
    doc.font('Helvetica').fontSize(8).fillColor('#888888')
      .text(`Generated: ${dateStr}`, RIGHT - 180, y, { width: 180, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(ACCENT)
      .text('Powered by Biddaro Inspect AI', RIGHT - 180, y + 14, { width: 180, align: 'right' });

    // ── Flush with page decorations ────────────────────────────────────────
    doc.flushPages();
    addPageDecorations();
    doc.end();
  });
}

export async function exportReportPdf(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const report = await prisma.inspectReport.findFirst({
      where: { id, userId },
      include: { project: { select: { name: true, location: true, clientName: true } } },
    });
    if (!report) { sendNotFound(res, 'Report'); return; }

    const content = report.content as ReportContent;
    const buffer  = await buildPdf(report, content, report.project);

    const filename = `${report.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
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

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getInspectAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;

    // Fetch all reports with their content and project name
    const allReports = await prisma.inspectReport.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, title: true, status: true, createdAt: true,
        content: true,
        project: { select: { name: true, location: true } },
      },
    });

    // Fetch all tasks
    const allTasks = await prisma.inspectTask.findMany({
      where: { userId },
      select: { id: true, status: true, severity: true, createdAt: true, dueDate: true },
    });

    // Fetch captures for type breakdown
    const allCaptures = await prisma.inspectCapture.findMany({
      where: { project: { userId } },
      select: { type: true, severity: true, createdAt: true },
    });

    // ── Severity distribution across all findings ─────────────────────────
    let criticalCount = 0, warningCount = 0, normalCount = 0;
    for (const report of allReports) {
      const c = report.content as ReportContent | null;
      if (!c?.summary) continue;
      criticalCount += c.summary.criticalCount ?? 0;
      warningCount  += c.summary.warningCount  ?? 0;
      normalCount   += c.summary.normalCount   ?? 0;
    }

    // ── Reports over time (last 6 months, grouped by month) ───────────────
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const monthMap: Record<string, { reports: number; critical: number; warning: number }> = {};
    for (let i = 0; i < 6; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - (5 - i));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthMap[key] = { reports: 0, critical: 0, warning: 0 };
    }

    for (const r of allReports) {
      const d = new Date(r.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthMap[key]) continue;
      monthMap[key].reports++;
      const c = r.content as ReportContent | null;
      if (c?.summary) {
        monthMap[key].critical += c.summary.criticalCount ?? 0;
        monthMap[key].warning  += c.summary.warningCount  ?? 0;
      }
    }

    const reportsOverTime = Object.entries(monthMap).map(([month, vals]) => ({
      month,
      label: new Date(month + '-01').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
      ...vals,
    }));

    // ── Report status breakdown ────────────────────────────────────────────
    const statusCounts: Record<string, number> = { draft: 0, review: 0, approved: 0, sent: 0 };
    for (const r of allReports) {
      statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    }
    const reportsByStatus = Object.entries(statusCounts).map(([status, count]) => ({ status, count }));

    // ── Top projects by findings count ────────────────────────────────────
    const projectFindings: Record<string, { name: string; critical: number; warning: number; normal: number; reports: number }> = {};
    for (const r of allReports) {
      const pid = r.project.name;
      if (!projectFindings[pid]) {
        projectFindings[pid] = { name: pid, critical: 0, warning: 0, normal: 0, reports: 0 };
      }
      projectFindings[pid].reports++;
      const c = r.content as ReportContent | null;
      if (c?.summary) {
        projectFindings[pid].critical += c.summary.criticalCount ?? 0;
        projectFindings[pid].warning  += c.summary.warningCount  ?? 0;
        projectFindings[pid].normal   += c.summary.normalCount   ?? 0;
      }
    }
    const topProjects = Object.values(projectFindings)
      .sort((a, b) => (b.critical + b.warning) - (a.critical + a.warning))
      .slice(0, 8);

    // ── Capture type breakdown ─────────────────────────────────────────────
    const captureTypes: Record<string, number> = {};
    for (const c of allCaptures) {
      captureTypes[c.type] = (captureTypes[c.type] ?? 0) + 1;
    }
    const capturesByType = Object.entries(captureTypes).map(([type, count]) => ({ type, count }));

    // ── Task metrics ───────────────────────────────────────────────────────
    const tasksByStatus: Record<string, number> = { open: 0, in_progress: 0, done: 0 };
    const tasksBySeverity: Record<string, number> = { normal: 0, warning: 0, critical: 0 };
    let overdueTasks = 0;
    const now = new Date();
    for (const t of allTasks) {
      tasksByStatus[t.status]   = (tasksByStatus[t.status]   ?? 0) + 1;
      tasksBySeverity[t.severity] = (tasksBySeverity[t.severity] ?? 0) + 1;
      if (t.dueDate && new Date(t.dueDate) < now && t.status !== 'done') overdueTasks++;
    }

    // ── Overall health score (0–100) ──────────────────────────────────────
    // Formula: 100 - (critical*10 + warning*3) / max(1, total findings) * 10
    // Clamped to [0, 100]
    const totalFindings = criticalCount + warningCount + normalCount;
    const penaltyRaw = totalFindings > 0
      ? ((criticalCount * 10 + warningCount * 3) / totalFindings) * 10
      : 0;
    const healthScore = Math.max(0, Math.min(100, Math.round(100 - penaltyRaw)));

    sendSuccess(res, {
      overview: {
        totalReports: allReports.length,
        totalFindings,
        criticalCount,
        warningCount,
        normalCount,
        healthScore,
        overdueTasks,
        openTasks: tasksByStatus.open ?? 0,
        totalTasks: allTasks.length,
      },
      reportsOverTime,
      reportsByStatus,
      topProjects,
      capturesByType,
      tasksByStatus: Object.entries(tasksByStatus).map(([status, count]) => ({ status, count })),
      tasksBySeverity: Object.entries(tasksBySeverity).map(([severity, count]) => ({ severity, count })),
    });
  } catch (err: any) {
    sendError(res, err.message);
  }
}
