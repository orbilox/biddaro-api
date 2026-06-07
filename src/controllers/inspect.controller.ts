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

import { Request, Response } from 'express';
import { ZipArchive } from 'archiver';
import OpenAI from 'openai';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, Table, TableRow, TableCell, WidthType, ShadingType,
  Footer, PageNumber, Header, LevelFormat, ImageRun,
} from 'docx';
import PDFDocument from 'pdfkit';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { prisma } from '../config/database';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden } from '../utils/response';
import {
  sendInspectionReportEmail,
  sendInspectShareLinkEmail,
  sendInspectSignatureNotificationEmail,
  sendScheduleReminderEmail,
} from '../utils/email';
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

/** Clone a project (structure only — copies name, location, client, template; no captures or reports). */
export async function cloneProject(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const source = await prisma.inspectProject.findFirst({
      where: { id, userId },
      select: { name: true, location: true, clientName: true, clientEmail: true, description: true, templateId: true },
    });
    if (!source) { sendNotFound(res, 'Project'); return; }

    const cloned = await prisma.inspectProject.create({
      data: {
        userId,
        name:        `${source.name} (Copy)`,
        location:    source.location,
        clientName:  source.clientName,
        clientEmail: source.clientEmail,
        description: source.description,
        templateId:  source.templateId,
        status:      'active',
      },
    });
    sendCreated(res, cloned);
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

    const { type, content, imageUrl, gpsLat, gpsLng, annotation, section, severity, tags } = req.body;
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

    const safeTags: string[] = Array.isArray(tags)
      ? tags.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 10)
      : [];

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
        tags: safeTags,
      },
    });
    sendCreated(res, capture);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function getCapture(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: projectId, cid } = req.params;
    const project = await getOwnedProject(projectId, userId);
    if (!project) { sendNotFound(res, 'Project'); return; }
    const capture = await prisma.inspectCapture.findFirst({ where: { id: cid, projectId } });
    if (!capture) { sendNotFound(res, 'Capture'); return; }
    sendSuccess(res, capture);
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

    const { content, annotation, section, severity, tags } = req.body;
    const updateData: Record<string, unknown> = { content, annotation, section, severity };
    if (Array.isArray(tags)) {
      updateData.tags = tags.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 10);
    }
    const capture = await prisma.inspectCapture.update({
      where: { id: cid },
      data: updateData,
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

// Supported languages for multi-lingual report generation
const SUPPORTED_LANGUAGES: Record<string, string> = {
  en:  'English',
  ar:  'Arabic (العربية)',
  hi:  'Hindi (हिन्दी)',
  fr:  'French (Français)',
  es:  'Spanish (Español)',
  zh:  'Chinese Simplified (中文)',
  de:  'German (Deutsch)',
  ur:  'Urdu (اردو)',
  ta:  'Tamil (தமிழ்)',
  te:  'Telugu (తెలుగు)',
  ml:  'Malayalam (മലയാളം)',
  bn:  'Bengali (বাংলা)',
  pt:  'Portuguese (Português)',
  ja:  'Japanese (日本語)',
};

export async function listLanguages(_req: AuthenticatedRequest, res: Response): Promise<void> {
  sendSuccess(res, Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => ({ code, name })));
}

export async function generateReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: projectId } = req.params;
    const language = (req.body?.language as string) || 'en';
    const langName = SUPPORTED_LANGUAGES[language] ?? 'English';
    const overrideTemplateId = (req.body?.templateId as string | undefined) || null;

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

    // If a template override was provided, look it up and use it instead of the project default
    let effectiveTemplate = project.template;
    if (overrideTemplateId) {
      const tmpl = await prisma.inspectTemplate.findFirst({ where: { id: overrideTemplateId, userId } });
      if (tmpl) effectiveTemplate = tmpl;
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

    // Template variable resolver — replaces {{variable}} tokens with project data
    const now = new Date();
    const templateVars: Record<string, string> = {
      project_name:    project.name,
      client_name:     project.clientName ?? 'Client',
      location:        project.location ?? '',
      date:            now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
      year:            String(now.getFullYear()),
      month:           now.toLocaleDateString('en-IN', { month: 'long' }),
      inspector:       '',  // filled from settings if needed
    };
    function resolveVars(text: string): string {
      return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => templateVars[key] ?? `{{${key}}}`);
    }

    // Get template structure
    const templateStructure = effectiveTemplate?.structure as { sections?: Array<{ id: string; title: string; description: string }> } | null;
    const rawSections = templateStructure?.sections ?? [
      { id: 'executive-summary', title: 'Executive Summary', description: 'Overview of findings' },
      { id: 'site-observations', title: 'Site Observations', description: 'Detailed on-site observations' },
      { id: 'defects-findings', title: 'Defects & Findings', description: 'Issues identified' },
      { id: 'recommendations', title: 'Recommendations', description: 'Required actions' },
      { id: 'conclusion', title: 'Conclusion', description: 'Summary and sign-off' },
    ];
    // Apply template variable substitution to section titles and descriptions
    const sections = rawSections.map(s => ({
      ...s,
      title:       resolveVars(s.title),
      description: resolveVars(s.description ?? ''),
    }));

    const systemPrompt = `You are a professional inspection report writer for construction and engineering projects.
You write clear, precise, technical inspection reports based on field observations.
Your writing is formal, factual, and professional — matching the style used by licensed building inspectors and engineers.
Structure your report according to the sections provided. For each section, write 2-4 paragraphs.
Reference specific observations from the field capture data.
Highlight defects and safety issues clearly with severity levels.
For each section, provide specific recommended actions — practical, actionable steps the contractor or owner should take to rectify issues found. Be specific (e.g., "Re-grout tile joints in the bathroom with epoxy grout" not just "Fix tiles").
${language !== 'en' ? `IMPORTANT: Write the entire report content in ${langName}. All section titles, findings, recommendations, and prose MUST be written in ${langName}. Only the JSON keys (id, severity, etc.) stay in English.` : ''}
Return the report as a JSON object with this exact structure:
{
  "title": "Inspection Report — [Project Name] — [Date]",
  "language": "${language}",
  "sections": [
    {
      "id": "section-id",
      "title": "Section Title",
      "content": "Full prose content for this section. Multiple paragraphs separated by \\n\\n.",
      "findings": ["Finding 1 — specific observation", "Finding 2 — specific observation"],
      "recommendedActions": ["Action 1 — specific remediation step", "Action 2 — specific remediation step"],
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

// List ALL reports for a user across all projects (for /inspect/reports listing page)
export async function listAllReports(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { page, limit, skip } = getPagination(req as any);
    const { status } = req.query;

    const where: Record<string, unknown> = { userId };
    if (status) where.status = status;

    const [reports, total] = await Promise.all([
      prisma.inspectReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id:        true,
          title:     true,
          status:    true,
          createdAt: true,
          updatedAt: true,
          sentAt:    true,
          sentTo:    true,
          project:   { select: { id: true, name: true, location: true, clientName: true } },
        },
      }),
      prisma.inspectReport.count({ where }),
    ]);

    sendSuccess(res, { reports, total, page, limit });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

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
    const { title, status, content, rawMarkdown, coverImage } = req.body;

    // If only coverImage is being updated (no full content replacement), merge it in
    let resolvedContent = content;
    if (coverImage !== undefined && !content) {
      resolvedContent = { ...(report.content as object), coverImage: coverImage || null };
    } else if (content && coverImage !== undefined) {
      // Content supplied along with explicit coverImage — embed it
      resolvedContent = { ...content, coverImage: coverImage || null };
    }

    // Auto-snapshot a new version whenever content changes
    if (resolvedContent && resolvedContent !== report.content) {
      const latestVersion = await prisma.inspectReportVersion.findFirst({
        where: { reportId: id },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const nextVersion = (latestVersion?.versionNumber ?? 0) + 1;
      // Only keep last 20 versions to avoid bloat
      const versionCount = await prisma.inspectReportVersion.count({ where: { reportId: id } });
      if (versionCount >= 20) {
        const oldest = await prisma.inspectReportVersion.findFirst({
          where: { reportId: id },
          orderBy: { versionNumber: 'asc' },
          select: { id: true },
        });
        if (oldest) await prisma.inspectReportVersion.delete({ where: { id: oldest.id } });
      }
      await prisma.inspectReportVersion.create({
        data: {
          reportId: id,
          userId,
          versionNumber: nextVersion,
          content: report.content as object, // snapshot of CURRENT content before overwrite
        },
      });
    }

    const updated = await prisma.inspectReport.update({
      where: { id },
      data: { title, status, content: resolvedContent, rawMarkdown },
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

export async function listVersions(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const report = await getOwnedReport(id, userId);
    if (!report) { sendNotFound(res, 'Report'); return; }

    const versions = await prisma.inspectReportVersion.findMany({
      where: { reportId: id },
      orderBy: { versionNumber: 'desc' },
      include: { user: { select: { firstName: true, lastName: true } } },
    });

    sendSuccess(res, { versions });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function restoreVersion(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id, vid } = req.params;
    const report = await getOwnedReport(id, userId);
    if (!report) { sendNotFound(res, 'Report'); return; }

    const version = await prisma.inspectReportVersion.findFirst({ where: { id: vid, reportId: id } });
    if (!version) { sendNotFound(res, 'Version'); return; }

    // Save current content as a new version before restoring
    const latestVersion = await prisma.inspectReportVersion.findFirst({
      where: { reportId: id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    await prisma.inspectReportVersion.create({
      data: {
        reportId: id,
        userId,
        versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
        content: report.content as object,
      },
    });

    // Restore
    const restored = await prisma.inspectReport.update({
      where: { id },
      data: { content: version.content as object },
    });

    sendSuccess(res, { report: restored, restoredFrom: version.versionNumber });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function sendReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { sentTo, clientName } = req.body;
    if (!sentTo) { sendError(res, 'sentTo email is required', 400); return; }

    // Load full report + project + user (inspector) for the email
    const fullReport = await prisma.inspectReport.findFirst({
      where: { id, userId },
      include: {
        project: { select: { name: true, location: true, clientName: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    });
    if (!fullReport) { sendNotFound(res, 'Report'); return; }

    const updated = await prisma.inspectReport.update({
      where: { id },
      data: { status: 'sent', sentAt: new Date(), sentTo },
    });

    // Parse content for summary metrics
    const content = fullReport.content as {
      sections?: Array<{ severity?: string; findings?: string[] }>;
      summary?: { totalFindings?: number; criticalCount?: number; warningCount?: number; overallStatus?: string };
    };
    const sections = content?.sections ?? [];
    const totalFindings = content?.summary?.totalFindings ?? sections.reduce((n, s) => n + (s.findings?.length ?? 0), 0);
    const criticalCount = content?.summary?.criticalCount ?? sections.filter(s => s.severity === 'critical').length;
    const warningCount  = content?.summary?.warningCount  ?? sections.filter(s => s.severity === 'warning').length;
    const overallStatus = content?.summary?.overallStatus;

    // Build public portal URL if sharing is enabled
    const frontendUrl = process.env.FRONTEND_URL ?? 'https://biddaro.com';
    const publicPortalUrl = fullReport.publicEnabled && fullReport.publicToken
      ? `${frontendUrl}/inspect-share/${fullReport.publicToken}`
      : undefined;

    // Send email in background — don't block the response
    const inspectorName = `${fullReport.user.firstName} ${fullReport.user.lastName}`;
    (async () => {
      try {
        // Generate PDF to attach (best-effort — if it fails, send without attachment)
        let pdfBuffer: Buffer | null = null;
        try {
          const settings = await prisma.inspectSettings.findUnique({ where: { userId } });
          const logoBuffer = await fetchLogoBuffer(settings?.logoUrl);
          pdfBuffer = await buildPdf(
            fullReport,
            fullReport.content as ReportContent,
            fullReport.project,
            settings,
            [],      // no embedded photos for email to keep size small
            logoBuffer,
          );
        } catch (pdfErr: any) {
          console.warn('[sendReport] PDF generation failed, sending without attachment:', pdfErr.message);
        }

        await sendInspectionReportEmail({
          clientEmail: sentTo,
          clientName: clientName ?? sentTo.split('@')[0],
          inspectorName,
          reportTitle: fullReport.title,
          projectName: fullReport.project.name,
          projectLocation: fullReport.project.location ?? undefined,
          totalFindings,
          criticalCount,
          warningCount,
          overallStatus,
          publicPortalUrl,
          reportDate: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
          pdfBuffer,
        });
      } catch (err: any) {
        console.error('[sendReport] email error:', err.message);
      }
    })();

    sendSuccess(res, updated);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT PORTAL — Shareable public link for approved/sent reports
// ═══════════════════════════════════════════════════════════════════════════════

export async function shareReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    // Load full report + project for email notification
    const report = await prisma.inspectReport.findFirst({
      where: { id, userId },
      include: {
        project: { select: { name: true, location: true, clientName: true, clientEmail: true } },
        user:    { select: { firstName: true, lastName: true, email: true } },
      },
    });
    if (!report) { sendNotFound(res, 'Report'); return; }

    // Generate a stable public token if not already set
    const publicToken = report.publicToken ?? `${id}-${Date.now().toString(36)}`;
    const expiryInput = req.body?.expiry as string | undefined;
    const publicExpiry = expiryInput ? new Date(expiryInput) : null;
    const updated = await prisma.inspectReport.update({
      where: { id },
      data: { publicToken, publicEnabled: true, ...(publicExpiry !== undefined ? { publicExpiry } : {}) },
      select: { id: true, publicToken: true, publicEnabled: true, publicExpiry: true, publicViewCount: true },
    });
    sendSuccess(res, updated);

    // Fire-and-forget: email client the share link if clientEmail is set
    // Only send if this is the first time sharing (token was just generated)
    if (!report.publicToken && report.project.clientEmail) {
      const frontendUrl = process.env.FRONTEND_URL || 'https://biddaro.com';
      const publicPortalUrl = `${frontendUrl}/inspect-share/${publicToken}`;
      const inspectorName = report.user
        ? `${report.user.firstName} ${report.user.lastName}`.trim()
        : 'Your Inspector';
      sendInspectShareLinkEmail({
        clientEmail:    report.project.clientEmail,
        clientName:     report.project.clientName ?? 'Client',
        inspectorName,
        reportTitle:    report.title,
        projectName:    report.project.name,
        projectLocation: report.project.location ?? undefined,
        publicPortalUrl,
      }).catch(err => console.error('[shareReport] email error:', err.message));
    }
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function unshareReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const report = await getOwnedReport(id, userId);
    if (!report) { sendNotFound(res, 'Report'); return; }

    const updated = await prisma.inspectReport.update({
      where: { id },
      data: { publicEnabled: false },
      select: { id: true, publicToken: true, publicEnabled: true },
    });
    sendSuccess(res, updated);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

// Public endpoint — no auth required
export async function getPublicReport(req: Request, res: Response): Promise<void> {
  try {
    const { token } = req.params;
    const report = await prisma.inspectReport.findFirst({
      where: { publicToken: token, publicEnabled: true },
      select: {
        id:                 true,
        title:              true,
        status:             true,
        content:            true,
        rawMarkdown:        true,
        createdAt:          true,
        clientSignature:    true,
        clientSignedByName: true,
        clientSignedAt:     true,
        publicExpiry:       true,
        publicViewCount:    true,
        project:            { select: { name: true, location: true, clientName: true } },
      },
    });
    if (!report) { sendNotFound(res, 'Report'); return; }

    // Check expiry
    if (report.publicExpiry && new Date(report.publicExpiry) < new Date()) {
      sendError(res, 'This report link has expired', 410); return;
    }

    // Increment view count (fire-and-forget)
    prisma.inspectReport.update({
      where: { id: report.id },
      data: { publicViewCount: { increment: 1 } },
    }).catch(() => {});

    sendSuccess(res, report);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function signPublicReport(req: Request, res: Response): Promise<void> {
  try {
    const { token } = req.params;
    const { signerName, signatureData } = req.body;

    if (!signerName?.trim()) { sendError(res, 'Signer name is required', 400); return; }
    if (!signatureData)       { sendError(res, 'Signature data is required', 400); return; }

    const report = await prisma.inspectReport.findFirst({
      where: { publicToken: token, publicEnabled: true },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    if (!report) { sendNotFound(res, 'Report'); return; }
    if (report.clientSignedAt) { sendError(res, 'Report has already been signed', 409); return; }

    const now = new Date();
    const updated = await prisma.inspectReport.update({
      where: { id: report.id },
      data: {
        clientSignature:    signatureData,
        clientSignedByName: signerName.trim(),
        clientSignedAt:     now,
        status:             report.status === 'draft' ? 'approved' : report.status,
      },
    });

    sendSuccess(res, {
      signed: true,
      signedAt: updated.clientSignedAt,
      signerName: updated.clientSignedByName,
    });

    // Fire-and-forget: notify inspector that client signed
    if (report.user?.email) {
      const frontendUrl = process.env.FRONTEND_URL || 'https://biddaro.com';
      const reportUrl = `${frontendUrl}/dashboard/inspect/reports/${report.id}`;
      const inspectorName = `${report.user.firstName} ${report.user.lastName}`.trim();

      // Load project name for the email
      prisma.inspectReport.findUnique({
        where: { id: report.id },
        select: { project: { select: { name: true } } },
      }).then(full => {
        sendInspectSignatureNotificationEmail({
          inspectorEmail:     report.user!.email,
          inspectorName,
          clientSignedByName: signerName.trim(),
          reportTitle:        report.title,
          projectName:        full?.project?.name ?? 'your project',
          signedAt:           now,
          reportUrl,
        }).catch(err => console.error('[signPublicReport] notify email error:', err.message));
      }).catch(() => { /* non-critical */ });
    }
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

/** Cross-report task list for the current user — used by the tasks management page. */
export async function listAllTasks(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const status  = req.query.status  as string | undefined;  // open|in_progress|done
    const severity = req.query.severity as string | undefined;
    const projectId = req.query.projectId as string | undefined;

    const tasks = await prisma.inspectTask.findMany({
      where: {
        userId,
        ...(status    ? { status }    : {}),
        ...(severity  ? { severity }  : {}),
        ...(projectId ? { projectId } : {}),
      },
      include: {
        report:  { select: { id: true, title: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: [
        { dueDate: 'asc' },
        { createdAt: 'asc' },
      ],
      take: 200,
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
// INSPECTION COMPARISON — Delta analysis between two reports
// ═══════════════════════════════════════════════════════════════════════════════

interface ComparisonFinding {
  area: string;         // section/area where the change is
  description: string;  // what changed
  previousStatus?: string;
  currentStatus?: string;
}

interface ComparisonResult {
  overallProgress: string;          // e.g. "75% rectification achieved"
  progressScore: number;            // 0-100
  resolvedIssues: ComparisonFinding[];
  newIssues: ComparisonFinding[];
  outstandingIssues: ComparisonFinding[];
  summary: string;                  // narrative paragraph
}

export async function compareReports(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { reportIdA, reportIdB } = req.body;

    if (!reportIdA || !reportIdB) {
      sendError(res, 'reportIdA and reportIdB are required', 400);
      return;
    }
    if (reportIdA === reportIdB) {
      sendError(res, 'Cannot compare a report with itself', 400);
      return;
    }

    // Load both reports (must belong to user)
    const [reportA, reportB] = await Promise.all([
      prisma.inspectReport.findFirst({
        where: { id: reportIdA, userId },
        select: { id: true, title: true, createdAt: true, content: true, project: { select: { name: true } } },
      }),
      prisma.inspectReport.findFirst({
        where: { id: reportIdB, userId },
        select: { id: true, title: true, createdAt: true, content: true, project: { select: { name: true } } },
      }),
    ]);

    if (!reportA) { sendNotFound(res, 'Report A'); return; }
    if (!reportB) { sendNotFound(res, 'Report B'); return; }

    // Serialize reports for AI
    function serializeReport(r: typeof reportA) {
      const content = r!.content as {
        sections?: Array<{ title: string; content: string; findings?: string[]; severity?: string }>;
        summary?: { totalFindings: number; criticalCount: number; warningCount: number };
      };
      const sections = content?.sections ?? [];
      return sections.map(s =>
        `SECTION: ${s.title} [${s.severity?.toUpperCase() ?? 'NORMAL'}]\n${s.content}\n` +
        (s.findings?.length ? `Findings:\n${s.findings.map(f => `- ${f}`).join('\n')}` : '')
      ).join('\n\n');
    }

    const systemPrompt = `You are a construction inspection analyst. Your task is to compare two inspection reports of the same or related site and produce a structured delta analysis.

REPORT A (Earlier / Baseline): "${reportA.title}" — ${new Date(reportA.createdAt).toLocaleDateString()}
PROJECT A: ${reportA.project.name}

REPORT B (Later / Current): "${reportB.title}" — ${new Date(reportB.createdAt).toLocaleDateString()}
PROJECT B: ${reportB.project.name}

INSTRUCTIONS:
1. Compare the two reports section by section and finding by finding
2. Identify issues that were present in Report A but are RESOLVED in Report B
3. Identify NEW issues that appeared in Report B but not in Report A
4. Identify issues that are STILL OUTSTANDING in both reports
5. Calculate an overall rectification progress score (0-100)
6. Write a professional summary paragraph

Return a JSON object with this EXACT structure:
{
  "overallProgress": "X% rectification achieved",
  "progressScore": 75,
  "summary": "Professional narrative summary of the comparison in 3-4 sentences.",
  "resolvedIssues": [
    { "area": "Section/area name", "description": "What was resolved", "previousStatus": "Was critical defect", "currentStatus": "Now rectified" }
  ],
  "newIssues": [
    { "area": "Section/area name", "description": "New issue found in current inspection" }
  ],
  "outstandingIssues": [
    { "area": "Section/area name", "description": "Still unresolved from baseline", "previousStatus": "Status in first report" }
  ]
}`;

    const userPrompt = `REPORT A (BASELINE):\n${serializeReport(reportA)}\n\n---\n\nREPORT B (CURRENT):\n${serializeReport(reportB)}`;

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
    const result = JSON.parse(raw) as ComparisonResult;

    sendSuccess(res, {
      reportA: { id: reportA.id, title: reportA.title, projectName: reportA.project.name, createdAt: reportA.createdAt },
      reportB: { id: reportB.id, title: reportB.title, projectName: reportB.project.name, createdAt: reportB.createdAt },
      comparison: result,
    });
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
  recommendedActions?: string[];
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

interface InspectorSettings {
  companyName?: string | null;
  inspectorName?: string | null;
  licenseNo?: string | null;
  phone?: string | null;
  address?: string | null;
  logoUrl?: string | null;
  footerNote?: string | null;
}

function buildDocx(
  report: {
    id: string; title: string; status: string; createdAt: Date;
    sentAt: Date | null; sentTo: string | null;
    user?: { firstName: string; lastName: string };
    clientSignedByName?: string | null;
    clientSignedAt?: Date | null;
  },
  content: ReportContent,
  project: { name: string; location: string | null; clientName: string | null },
  settings?: InspectorSettings | null,
  logoBuffer?: Buffer | null,
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
  // Company logo (if available)
  if (logoBuffer && logoBuffer.length > 0) {
    const imgType: 'png' | 'jpg' = logoBuffer[0] === 0x89 ? 'png' : 'jpg';
    children.push(
      new Paragraph({
        spacing: { before: 0, after: 160 },
        children: [
          new ImageRun({
            type: imgType,
            data: logoBuffer,
            transformation: { width: 140, height: 46 },
            altText: { title: 'Company Logo', description: 'Company Logo', name: 'logo' },
          }),
        ],
      }),
    );
  }

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
  const inspectorDisplayName = settings?.inspectorName
    ?? (report.user ? `${report.user.firstName} ${report.user.lastName}` : 'Inspector');

  const metaRows = [
    ['Project', project.name],
    ['Location', project.location ?? '—'],
    ['Client', project.clientName ?? '—'],
    ['Date', new Date(report.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })],
    ['Report Status', report.status.toUpperCase()],
    ['Inspector', inspectorDisplayName],
  ];
  if (settings?.companyName) metaRows.push(['Company', settings.companyName]);
  if (settings?.licenseNo)   metaRows.push(['License No.', settings.licenseNo]);
  if (settings?.phone)       metaRows.push(['Contact', settings.phone]);
  if (settings?.address)     metaRows.push(['Address', settings.address]);
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

    // Recommended actions
    if (section.recommendedActions && section.recommendedActions.length > 0) {
      children.push(new Paragraph({
        spacing: { before: 160, after: 60 },
        children: [new TextRun({ text: 'Recommended Actions', font: 'Arial', size: 22, bold: true, color: '1D6F42' })],
      }));
      section.recommendedActions.forEach((action) => {
        children.push(new Paragraph({
          spacing: { before: 60, after: 60 },
          indent: { left: 360, hanging: 360 },
          children: [
            new TextRun({ text: '→  ', font: 'Arial', size: 22, bold: true, color: '1D6F42' }),
            new TextRun({ text: action, font: 'Arial', size: 22, color: '2C2C2C' }),
          ],
        }));
      });
    }
  });

  // ── Sign-off ─────────────────────────────────────────────────────────────────
  const signoffLines: Paragraph[] = [
    new Paragraph({ spacing: { before: 480, after: 120 }, border: { top: thin }, children: [] }),
    new Paragraph({
      spacing: { before: 120, after: 60 },
      children: [new TextRun({ text: 'Report Prepared By', font: 'Arial', size: 20, bold: true, color: BRAND })],
    }),
    new Paragraph({
      spacing: { before: 60, after: 60 },
      children: [new TextRun({ text: `Inspector: ${inspectorDisplayName}`, font: 'Arial', size: 20, color: '333333' })],
    }),
  ];
  if (settings?.companyName) {
    signoffLines.push(new Paragraph({
      spacing: { before: 40, after: 60 },
      children: [new TextRun({ text: `Company: ${settings.companyName}`, font: 'Arial', size: 20, color: '333333' })],
    }));
  }
  if (settings?.licenseNo) {
    signoffLines.push(new Paragraph({
      spacing: { before: 40, after: 60 },
      children: [new TextRun({ text: `License No.: ${settings.licenseNo}`, font: 'Arial', size: 20, color: '333333' })],
    }));
  }
  signoffLines.push(
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
      children: [new TextRun({
        text: settings?.footerNote ?? 'This report was generated using Biddaro Inspect — AI-powered inspection reporting.',
        font: 'Arial', size: 18, italics: true, color: '888888',
      })],
    }),
  );
  children.push(...signoffLines);

  // Client Acknowledgement / Digital Signature block
  if (report.clientSignedAt && report.clientSignedByName) {
    const signDateStr = new Date(report.clientSignedAt).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    children.push(
      new Paragraph({ spacing: { before: 480, after: 0 }, children: [] }),
      new Paragraph({
        spacing: { before: 0, after: 160 },
        border: { top: { style: BorderStyle.SINGLE, size: 2, color: DIVIDER, space: 4 } },
        children: [new TextRun({ text: 'Client Acknowledgement', font: 'Arial', size: 24, bold: true, color: BRAND })],
      }),
      new Paragraph({
        spacing: { before: 60, after: 60 },
        children: [
          new TextRun({ text: 'Digitally signed by: ', font: 'Arial', size: 20, bold: true }),
          new TextRun({ text: report.clientSignedByName, font: 'Arial', size: 20, color: BRAND }),
        ],
      }),
      new Paragraph({
        spacing: { before: 0, after: 60 },
        children: [
          new TextRun({ text: 'Date signed: ', font: 'Arial', size: 20, bold: true }),
          new TextRun({ text: signDateStr, font: 'Arial', size: 20 }),
        ],
      }),
      new Paragraph({
        spacing: { before: 60, after: 0 },
        children: [new TextRun({
          text: 'By signing above, the client acknowledges receipt of this inspection report and confirms the findings have been reviewed.',
          font: 'Arial', size: 18, italics: true, color: '888888',
        })],
      }),
    );
  }

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

// ─── Legacy Report Import ─────────────────────────────────────────────────────

/**
 * Accepts a .docx or .pdf file upload, extracts text, and uses GPT-4o to
 * parse it into the standard ReportContent structure, creating a new report.
 */
export async function importReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: projectId } = req.params;

    const project = await getOwnedProject(projectId, userId);
    if (!project) { sendNotFound(res, 'Project'); return; }

    const file = (req as typeof req & { file?: Express.Multer.File }).file;
    if (!file) { sendError(res, 'File is required (multipart/form-data, field: file)', 400); return; }

    const mime = file.mimetype;
    const buf  = file.buffer;

    // ── Extract raw text from the uploaded file ────────────────────────────
    let rawText = '';
    if (mime === 'application/pdf' || file.originalname.endsWith('.pdf')) {
      const uint8 = new Uint8Array(buf);
      const parser = new PDFParse({ data: uint8 });
      const result = await parser.getText();
      rawText = result.text;
    } else if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.originalname.endsWith('.docx')
    ) {
      const result = await mammoth.extractRawText({ buffer: buf });
      rawText = result.value;
    } else {
      sendError(res, 'Only .pdf and .docx files are supported', 400); return;
    }

    if (!rawText.trim()) {
      sendError(res, 'Could not extract text from the uploaded file', 422); return;
    }

    // Truncate to fit context (GPT-4o: 128k tokens, ~500k chars — be safe)
    const textForAI = rawText.length > 40_000 ? rawText.slice(0, 40_000) + '\n… [truncated]' : rawText;

    // ── GPT-4o: parse into structured report ──────────────────────────────
    const aiRes = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are an expert at parsing construction inspection reports.
You will receive raw text from a legacy inspection report (extracted from PDF or Word).
Your job is to parse it into a structured JSON format.

Return a JSON object with this exact shape:
{
  "title": "string — report title extracted from the document",
  "sections": [
    {
      "id": "kebab-case-id",
      "title": "Section Title",
      "content": "Full section text. Multiple paragraphs separated by \\n\\n.",
      "findings": ["Finding 1", "Finding 2"],
      "severity": "normal | warning | critical"
    }
  ],
  "summary": {
    "totalFindings": number,
    "criticalCount": number,
    "warningCount": number,
    "normalCount": number,
    "overallStatus": "Satisfactory | Requires Attention | Critical Issues Found"
  }
}

Rules:
- Extract ALL sections from the document (executive summary, site observations, defects, recommendations, etc.)
- Classify each section severity based on the language used (critical defects → critical, minor issues → warning, no issues → normal)
- Extract individual findings as concise bullet-point strings
- Count findings accurately for the summary
- Keep the original professional language`,
        },
        {
          role: 'user',
          content: `Parse this inspection report document:\n\n${textForAI}`,
        },
      ],
    });

    let parsedContent: ReportContent;
    try {
      parsedContent = JSON.parse(aiRes.choices[0]?.message?.content ?? '{}') as ReportContent;
      if (!parsedContent.sections?.length) throw new Error('Empty sections');
    } catch {
      sendError(res, 'AI could not parse the report structure. Try a cleaner file.', 422); return;
    }

    // Create the report
    const report = await prisma.inspectReport.create({
      data: {
        projectId,
        userId,
        title: parsedContent.title || `Imported Report — ${new Date().toLocaleDateString('en-IN')}`,
        status: 'draft',
        content: parsedContent as object,
        rawMarkdown: textForAI,
      },
    });

    // Add an audit note
    await prisma.inspectReviewNote.create({
      data: {
        reportId: report.id,
        userId,
        type: 'status_change',
        content: `Report imported from ${file.originalname} (${file.size} bytes) via Legacy Import. ${parsedContent.sections?.length ?? 0} sections detected.`,
        toStatus: 'draft',
        authorName: 'Biddaro Inspect AI',
      },
    });

    sendCreated(res, report);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function exportReportDocx(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const [report, settings] = await Promise.all([
      prisma.inspectReport.findFirst({
        where: { id, userId },
        include: {
          project: { select: { name: true, location: true, clientName: true } },
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.inspectSettings.findUnique({ where: { userId } }),
    ]);
    if (!report) { sendNotFound(res, 'Report'); return; }

    const content = report.content as ReportContent;
    const logoBuffer = await fetchLogoBuffer(settings?.logoUrl);
    const buffer = await buildDocx(report, content, report.project, settings, logoBuffer);

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
interface EmbeddedPhoto {
  section: string | null;
  caption: string | null;
  buffer: Buffer;
}

function buildPdf(
  report: {
    id: string; title: string; status: string; createdAt: Date;
    sentAt: Date | null; sentTo: string | null;
    user?: { firstName: string; lastName: string };
    clientSignedByName?: string | null;
    clientSignedAt?: Date | null;
  },
  content: ReportContent,
  project: { name: string; location: string | null; clientName: string | null },
  settings?: InspectorSettings | null,
  photos?: EmbeddedPhoto[],
  logoBuffer?: Buffer | null,
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
          .text(settings?.companyName || 'BIDDARO INSPECT', LEFT + WIDTH / 2, 36, { width: WIDTH / 2, align: 'right' })
        // Footer rule
          .moveTo(LEFT, 790).lineTo(RIGHT, 790)
          .strokeColor(DIVIDER).lineWidth(0.5).stroke()
          .text('Biddaro Inspect — Confidential', LEFT, 796, { width: WIDTH / 2 })
          .text(`Page ${pageNum} of ${range.count}`, LEFT + WIDTH / 2, 796, { width: WIDTH / 2, align: 'right' })
          .restore();

        // Watermark — diagonal DRAFT stamp on draft reports
        if (report.status === 'draft') {
          const CX = 595 / 2;  // page center x
          const CY = 842 / 2;  // page center y
          doc.save();
          doc.translate(CX, CY);
          doc.rotate(-45);
          doc.font('Helvetica-Bold').fontSize(90)
            .fillOpacity(0.06).fillColor('#1E3A5F')
            .text('DRAFT', 0, 0, { align: 'center', lineBreak: false });
          doc.restore();
          doc.fillOpacity(1); // reset opacity
        }
      }
    }

    // ── COVER BLOCK ────────────────────────────────────────────────────────
    // Brand accent top bar
    doc.rect(LEFT - 50, 0, 595, 6).fill(BRAND);

    // Logo or brand name
    const companyName = settings?.companyName || 'BIDDARO INSPECT';
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, LEFT, 12, { fit: [120, 40] });
      } catch {
        // fallback to text if image is corrupt
        doc.font('Helvetica-Bold').fontSize(18).fillColor(BRAND)
          .text(companyName, LEFT, 16, { width: 200 });
      }
    } else {
      doc.font('Helvetica-Bold').fontSize(22).fillColor(BRAND)
        .text('BIDDARO INSPECT', LEFT, 24, { width: WIDTH });
    }
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

    // ── Cover hero photo ───────────────────────────────────────────────────
    // Use the first embedded photo as a visual banner on the cover
    if (photos && photos.length > 0) {
      const hero = photos[0];
      const HERO_H = 160;
      if (y + HERO_H + 20 <= 750) {
        try {
          doc.save();
          // Clip to rounded-rect banner
          doc.roundedRect(LEFT, y, WIDTH, HERO_H, 6).clip();
          doc.image(hero.buffer, LEFT, y, { width: WIDTH, height: HERO_H, cover: [WIDTH, HERO_H] });
          doc.restore();
          // Gradient overlay for caption readability
          if (hero.caption || hero.section) {
            doc.save();
            doc.rect(LEFT, y + HERO_H - 36, WIDTH, 36)
              .fillOpacity(0.55).fill('#000000');
            doc.fillOpacity(1);
            const captionText = hero.caption ?? hero.section ?? '';
            doc.font('Helvetica').fontSize(8).fillColor('#FFFFFF')
              .text(captionText, LEFT + 8, y + HERO_H - 24, { width: WIDTH - 16, lineBreak: false, ellipsis: true });
            doc.restore();
          }
          y += HERO_H + 14;
        } catch {
          // skip hero if image fails
        }
      }
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

      // Recommended actions
      if (section.recommendedActions && section.recommendedActions.length > 0) {
        if (y > 730) { doc.addPage(); y = TOP_MARGIN; }
        y += 6;
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1D6F42')
          .text('Recommended Actions', LEFT, y);
        y = doc.y + 4;

        for (const action of section.recommendedActions) {
          if (y > 750) { doc.addPage(); y = TOP_MARGIN; }
          // Arrow bullet
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#1D6F42')
            .text('→', LEFT, y, { width: 18, align: 'center' });
          // Action text
          doc.font('Helvetica').fontSize(10).fillColor(BODY)
            .text(action, LEFT + 22, y, { width: WIDTH - 22, lineGap: 2 });
          y = doc.y + 5;
        }
      }

      // ── Embedded photos for this section ─────────────────────────────────
      if (photos && photos.length > 0) {
        const sectionPhotos = photos.filter(p =>
          p.section?.toLowerCase().trim() === section.title.toLowerCase().trim()
        );
        if (sectionPhotos.length > 0) {
          y += 10;
          doc.font('Helvetica-Bold').fontSize(9).fillColor('#888888')
            .text(`Photos (${sectionPhotos.length})`, LEFT, y);
          y += 14;
          // Lay photos in a 2-column grid
          const PHOTO_W = (WIDTH - 12) / 2;
          const PHOTO_H = 130;
          for (let pi = 0; pi < sectionPhotos.length; pi += 2) {
            if (y + PHOTO_H + 40 > 780) { doc.addPage(); y = TOP_MARGIN; }
            const col1 = sectionPhotos[pi];
            const col2 = sectionPhotos[pi + 1];
            // Draw photos
            try {
              doc.image(col1.buffer, LEFT, y, { width: PHOTO_W, height: PHOTO_H, fit: [PHOTO_W, PHOTO_H] });
            } catch { /* skip unrenderable image */ }
            if (col2) {
              try {
                doc.image(col2.buffer, LEFT + PHOTO_W + 12, y, { width: PHOTO_W, height: PHOTO_H, fit: [PHOTO_W, PHOTO_H] });
              } catch { /* skip */ }
            }
            y += PHOTO_H + 6;
            // Captions
            if (col1.caption) {
              doc.font('Helvetica').fontSize(7).fillColor('#888888')
                .text(col1.caption.slice(0, 120), LEFT, y, { width: PHOTO_W, lineGap: 1 });
            }
            if (col2?.caption) {
              doc.font('Helvetica').fontSize(7).fillColor('#888888')
                .text(col2.caption.slice(0, 120), LEFT + PHOTO_W + 12, y, { width: PHOTO_W, lineGap: 1 });
            }
            y = doc.y + 14;
          }
        }
      }

      // Section divider
      if (y < 780) {
        y += 8;
        doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(DIVIDER).lineWidth(0.5).stroke();
        y += 16;
      }
    }

    // ── Photos with no section (appendix) ─────────────────────────────────
    if (photos && photos.length > 0) {
      const unsectionedPhotos = photos.filter(p => !p.section);
      if (unsectionedPhotos.length > 0) {
        doc.addPage(); y = TOP_MARGIN;
        doc.font('Helvetica-Bold').fontSize(14).fillColor(BRAND)
          .text('Photo Appendix', LEFT, y);
        y += 24;
        const PHOTO_W = (WIDTH - 12) / 2;
        const PHOTO_H = 150;
        for (let pi = 0; pi < unsectionedPhotos.length; pi += 2) {
          if (y + PHOTO_H + 40 > 780) { doc.addPage(); y = TOP_MARGIN; }
          const col1 = unsectionedPhotos[pi];
          const col2 = unsectionedPhotos[pi + 1];
          try { doc.image(col1.buffer, LEFT, y, { width: PHOTO_W, height: PHOTO_H, fit: [PHOTO_W, PHOTO_H] }); } catch { /* skip */ }
          if (col2) {
            try { doc.image(col2.buffer, LEFT + PHOTO_W + 12, y, { width: PHOTO_W, height: PHOTO_H, fit: [PHOTO_W, PHOTO_H] }); } catch { /* skip */ }
          }
          y += PHOTO_H + 6;
          if (col1.caption) doc.font('Helvetica').fontSize(7).fillColor('#888888').text(col1.caption.slice(0, 120), LEFT, y, { width: PHOTO_W, lineGap: 1 });
          if (col2?.caption) doc.font('Helvetica').fontSize(7).fillColor('#888888').text(col2.caption.slice(0, 120), LEFT + PHOTO_W + 12, y, { width: PHOTO_W, lineGap: 1 });
          y = doc.y + 14;
        }
      }
    }

    // ── Client Acknowledgement (when signed) ───────────────────────────────
    if (report.clientSignedAt && report.clientSignedByName) {
      if (y > 660) { doc.addPage(); y = TOP_MARGIN; }
      y += 24;
      doc.rect(LEFT, y, WIDTH, 1).fillColor(DIVIDER).fill();
      y += 12;
      doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND)
        .text('Client Acknowledgement', LEFT, y);
      y += 20;
      doc.moveTo(LEFT, y).lineTo(LEFT + 160, y).strokeColor('#444444').lineWidth(0.5).stroke();
      y += 6;
      doc.font('Helvetica').fontSize(9).fillColor('#888888')
        .text('Client Signature', LEFT, y);
      y += 14;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND)
        .text(report.clientSignedByName, LEFT, y);
      y += 14;
      const signDateStr = report.clientSignedAt.toLocaleDateString('en-GB', {
        day: '2-digit', month: 'long', year: 'numeric',
      });
      doc.font('Helvetica').fontSize(9).fillColor('#555555')
        .text(`Date signed: ${signDateStr}`, LEFT, y);
      y += 14;
      doc.font('Helvetica').fontSize(7.5).fillColor('#AAAAAA')
        .text('This document has been digitally acknowledged by the client via the Biddaro Inspect secure client portal.', LEFT, y, { width: WIDTH });
      y += 30;
    }

    // ── Sign-off ───────────────────────────────────────────────────────────
    if (y > 720) { doc.addPage(); y = TOP_MARGIN; }
    y += 20;
    doc.moveTo(LEFT, y).lineTo(LEFT + 160, y).strokeColor('#444444').lineWidth(0.5).stroke();
    y += 6;
    doc.font('Helvetica').fontSize(9).fillColor('#888888')
      .text('Authorised Signatory', LEFT, y);

    // Inspector display name (settings > user name > 'Biddaro Inspect')
    const pdfInspectorName = settings?.inspectorName
      || (report.user ? `${report.user.firstName} ${report.user.lastName}`.trim() : null)
      || 'Biddaro Inspect';
    const pdfCompany = settings?.companyName || 'Biddaro Inspect';
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND)
      .text(pdfInspectorName, LEFT, y + 14);
    if (settings?.companyName) {
      doc.font('Helvetica').fontSize(8).fillColor('#555555')
        .text(pdfCompany, LEFT, y + 28);
    }
    if (settings?.licenseNo) {
      doc.font('Helvetica').fontSize(8).fillColor('#888888')
        .text(`Lic. No: ${settings.licenseNo}`, LEFT, y + (settings.companyName ? 40 : 28));
    }
    if (settings?.footerNote) {
      const fnY = y + (settings.companyName ? (settings.licenseNo ? 54 : 42) : (settings.licenseNo ? 42 : 28));
      doc.font('Helvetica').fontSize(7.5).fillColor('#AAAAAA')
        .text(settings.footerNote, LEFT, fnY, { width: WIDTH / 2 });
    }
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

/** Fetch a logo from a URL and return its Buffer (best-effort, returns null on failure). */
async function fetchLogoBuffer(logoUrl: string | null | undefined): Promise<Buffer | null> {
  if (!logoUrl) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(logoUrl, { signal: controller.signal });
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

export async function exportReportPdf(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const includePhotos = req.query.photos !== '0'; // default: include photos

    const [report, settings] = await Promise.all([
      prisma.inspectReport.findFirst({
        where: { id, userId },
        include: {
          project: { select: { id: true, name: true, location: true, clientName: true } },
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.inspectSettings.findUnique({ where: { userId } }),
    ]);
    if (!report) { sendNotFound(res, 'Report'); return; }

    // Fetch company logo (best-effort — fall back to text if unavailable)
    const logoBuffer = await fetchLogoBuffer(settings?.logoUrl);

    // Load photo captures and download buffers (best-effort, non-blocking failures)
    let embeddedPhotos: EmbeddedPhoto[] = [];
    if (includePhotos) {
      const captures = await prisma.inspectCapture.findMany({
        where: { projectId: report.project.id, type: 'photo' },
        select: { imageUrl: true, content: true, section: true },
        orderBy: { createdAt: 'asc' },
        take: 20, // cap at 20 photos to keep PDF size reasonable
      });

      const photoResults = await Promise.allSettled(
        captures
          .filter(c => c.imageUrl)
          .map(async (c): Promise<EmbeddedPhoto> => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            try {
              const res = await fetch(c.imageUrl!, { signal: controller.signal });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const ab = await res.arrayBuffer();
              return { section: c.section, caption: c.content, buffer: Buffer.from(ab) };
            } finally {
              clearTimeout(timeout);
            }
          })
      );

      embeddedPhotos = photoResults
        .filter((r): r is PromiseFulfilledResult<EmbeddedPhoto> => r.status === 'fulfilled')
        .map(r => r.value);
    }

    // If a dedicated cover image URL is set, prepend it so it appears as the hero photo
    const content = report.content as ReportContent & { coverImage?: string };
    if (content.coverImage) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(content.coverImage, { signal: ctrl.signal });
        clearTimeout(to);
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          embeddedPhotos = [{ section: null, caption: null, buffer: buf }, ...embeddedPhotos];
        }
      } catch { /* cover image unavailable — ignore */ }
    }

    const buffer  = await buildPdf(report, content, report.project, settings, embeddedPhotos.length > 0 ? embeddedPhotos : undefined, logoBuffer);

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
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalProjects,
      activeProjects,
      totalReports,
      draftReports,
      totalCaptures,
      openTasks,
      criticalTasks,
      upcomingSchedulesCount,
    ] = await Promise.all([
      prisma.inspectProject.count({ where: { userId } }),
      prisma.inspectProject.count({ where: { userId, status: 'active' } }),
      prisma.inspectReport.count({ where: { userId } }),
      prisma.inspectReport.count({ where: { userId, status: 'draft' } }),
      prisma.inspectCapture.count({ where: { project: { userId } } }),
      prisma.inspectTask.count({ where: { userId, status: { in: ['open', 'in_progress'] } } }),
      prisma.inspectTask.count({ where: { userId, severity: 'critical', status: { not: 'done' } } }),
      prisma.inspectSchedule.count({
        where: { userId, status: 'pending', scheduledAt: { gte: now, lte: in7Days } },
      }),
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
      stats: {
        totalProjects, activeProjects, totalReports, draftReports, totalCaptures,
        openTasks, criticalTasks, upcomingSchedulesCount,
      },
      recentProjects,
      recentReports,
    });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLOOR PLANS
// ═══════════════════════════════════════════════════════════════════════════════

type FloorPin = {
  id: string;
  x: number;   // 0–1 relative to image width
  y: number;   // 0–1 relative to image height
  title: string;
  severity: string;  // normal|warning|critical
  notes: string;
};

export async function listFloorPlans(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: projectId } = req.params;
    const project = await getOwnedProject(projectId, userId);
    if (!project) { sendNotFound(res, 'Project'); return; }
    const plans = await prisma.inspectFloorPlan.findMany({
      where: { projectId, userId },
      orderBy: { createdAt: 'asc' },
    });
    sendSuccess(res, plans);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function createFloorPlan(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: projectId } = req.params;
    const project = await getOwnedProject(projectId, userId);
    if (!project) { sendNotFound(res, 'Project'); return; }
    const { name, imageUrl } = req.body;
    if (!name?.trim() || !imageUrl?.trim()) {
      sendError(res, 'name and imageUrl are required', 400); return;
    }
    const plan = await prisma.inspectFloorPlan.create({
      data: { projectId, userId, name: name.trim(), imageUrl: imageUrl.trim(), pins: [] },
    });
    sendCreated(res, plan);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function updateFloorPlan(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { fid } = req.params;
    const plan = await prisma.inspectFloorPlan.findFirst({ where: { id: fid, userId } });
    if (!plan) { sendNotFound(res, 'Floor plan'); return; }
    const { name, pins } = req.body;
    const updated = await prisma.inspectFloorPlan.update({
      where: { id: fid },
      data: {
        ...(name ? { name: name.trim() } : {}),
        ...(pins !== undefined ? { pins: pins as FloorPin[] } : {}),
      },
    });
    sendSuccess(res, updated);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function deleteFloorPlan(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { fid } = req.params;
    const plan = await prisma.inspectFloorPlan.findFirst({ where: { id: fid, userId } });
    if (!plan) { sendNotFound(res, 'Floor plan'); return; }
    await prisma.inspectFloorPlan.delete({ where: { id: fid } });
    sendSuccess(res, { deleted: true });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REVIEW NOTES (audit trail)
// ═══════════════════════════════════════════════════════════════════════════════

export async function listReviewNotes(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: reportId } = req.params;
    const report = await getOwnedReport(reportId, userId);
    if (!report) { sendNotFound(res, 'Report'); return; }
    const notes = await prisma.inspectReviewNote.findMany({
      where: { reportId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { firstName: true, lastName: true, profileImage: true } },
      },
    });
    sendSuccess(res, notes);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function addReviewNote(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id: reportId } = req.params;

    const report = await prisma.inspectReport.findFirst({
      where: { id: reportId, userId },
      include: { project: { select: { name: true } } },
    });
    if (!report) { sendNotFound(res, 'Report'); return; }

    const { type = 'comment', content, toStatus } = req.body;
    if (!content?.trim()) { sendError(res, 'content is required', 400); return; }

    // If this is a status transition, validate and apply it
    const STATUS_TRANSITIONS: Record<string, string[]> = {
      draft:    ['review'],
      review:   ['approved', 'draft'],
      approved: ['sent', 'review'],
      sent:     [],
    };

    let fromStatus: string | undefined;
    if (type === 'status_change' && toStatus) {
      const allowed = STATUS_TRANSITIONS[report.status] ?? [];
      if (!allowed.includes(toStatus)) {
        sendError(res, `Cannot transition from '${report.status}' to '${toStatus}'`, 400); return;
      }
      fromStatus = report.status;
      await prisma.inspectReport.update({ where: { id: reportId }, data: { status: toStatus } });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const authorName = user ? `${user.firstName} ${user.lastName}` : 'Unknown';

    const note = await prisma.inspectReviewNote.create({
      data: {
        reportId, userId,
        type,
        content: content.trim(),
        fromStatus,
        toStatus: type === 'status_change' ? toStatus : undefined,
        authorName,
      },
      include: {
        user: { select: { firstName: true, lastName: true, profileImage: true } },
      },
    });
    sendCreated(res, note);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function deleteReviewNote(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { nid } = req.params;
    const note = await prisma.inspectReviewNote.findFirst({ where: { id: nid, userId } });
    if (!note) { sendNotFound(res, 'Review note'); return; }
    await prisma.inspectReviewNote.delete({ where: { id: nid } });
    sendSuccess(res, { deleted: true });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INSPECTOR SETTINGS (company name, logo, license number for export branding)
// ═══════════════════════════════════════════════════════════════════════════════

export async function getInspectSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const settings = await prisma.inspectSettings.findUnique({ where: { userId } });
    sendSuccess(res, settings ?? {});
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function upsertInspectSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { companyName, inspectorName, licenseNo, phone, address, logoUrl, footerNote, brandColor, headerBg } = req.body;

    const settings = await prisma.inspectSettings.upsert({
      where: { userId },
      update: { companyName, inspectorName, licenseNo, phone, address, logoUrl, footerNote, brandColor, headerBg },
      create: { userId, companyName, inspectorName, licenseNo, phone, address, logoUrl, footerNote, brandColor, headerBg },
    });
    sendSuccess(res, settings);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

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

// ═══════════════════════════════════════════════════════════════════════════════
// AI DEFECT TREND SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /inspect/analytics/trend
 * Collects portfolio analytics and asks GPT-4o-mini to produce a structured
 * trend narrative covering:
 *   - Overall portfolio health trajectory
 *   - Most prevalent defect types / recurring themes
 *   - Projects requiring attention
 *   - Month-over-month change
 *   - 2–3 actionable recommendations
 *
 * Returns { summary: string, generatedAt: string }
 */
export async function generateTrendSummary(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;

    // Gather the same data as getInspectAnalytics
    const [allReports, allTasks, allCaptures] = await Promise.all([
      prisma.inspectReport.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, title: true, status: true, createdAt: true, content: true,
          project: { select: { name: true, location: true } },
        },
      }),
      prisma.inspectTask.findMany({
        where: { userId },
        select: { id: true, status: true, severity: true, dueDate: true },
      }),
      prisma.inspectCapture.findMany({
        where: { project: { userId } },
        select: { type: true, severity: true, section: true, content: true, tags: true },
        take: 200, // limit for prompt size
      }),
    ]);

    if (allReports.length === 0) {
      sendError(res, 'No reports available to analyse', 400); return;
    }

    // Aggregate stats
    let criticalCount = 0, warningCount = 0, normalCount = 0;
    const projectFindings: Record<string, { critical: number; warning: number }> = {};
    for (const r of allReports) {
      const c = r.content as ReportContent | null;
      if (!c?.summary) continue;
      criticalCount += c.summary.criticalCount ?? 0;
      warningCount  += c.summary.warningCount  ?? 0;
      normalCount   += c.summary.normalCount   ?? 0;
      const name = r.project.name;
      if (!projectFindings[name]) projectFindings[name] = { critical: 0, warning: 0 };
      projectFindings[name].critical += c.summary.criticalCount ?? 0;
      projectFindings[name].warning  += c.summary.warningCount  ?? 0;
    }

    const statusCounts: Record<string, number> = {};
    for (const r of allReports) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;

    const now = new Date();
    let overdueTasks = 0;
    for (const t of allTasks) {
      if (t.dueDate && new Date(t.dueDate) < now && t.status !== 'done') overdueTasks++;
    }

    const topProblematic = Object.entries(projectFindings)
      .sort((a, b) => (b[1].critical + b[1].warning) - (a[1].critical + a[1].warning))
      .slice(0, 5)
      .map(([name, s]) => `${name}: ${s.critical} critical, ${s.warning} warnings`);

    // Monthly trend (last 3 months)
    const monthTrend: Record<string, { reports: number; critical: number }> = {};
    for (let i = 2; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthTrend[key] = { reports: 0, critical: 0 };
    }
    for (const r of allReports) {
      const d = new Date(r.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthTrend[key]) continue;
      monthTrend[key].reports++;
      const c = r.content as ReportContent | null;
      if (c?.summary) monthTrend[key].critical += c.summary.criticalCount ?? 0;
    }

    // Collect common tags and section names to understand defect categories
    const tagFreq: Record<string, number> = {};
    const sectionFreq: Record<string, number> = {};
    for (const c of allCaptures) {
      for (const t of (c.tags ?? [])) tagFreq[t] = (tagFreq[t] ?? 0) + 1;
      if (c.section) sectionFreq[c.section] = (sectionFreq[c.section] ?? 0) + 1;
    }
    const topTags     = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${t}(${n})`);
    const topSections = Object.entries(sectionFreq).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s, n]) => `${s}(${n})`);

    const totalFindings = criticalCount + warningCount + normalCount;
    const healthScore   = totalFindings > 0
      ? Math.max(0, Math.min(100, Math.round(100 - ((criticalCount * 10 + warningCount * 3) / totalFindings) * 10)))
      : 100;

    const prompt = `You are an expert construction inspector and portfolio analyst. Based on the following metrics from an inspection management platform, write a concise but insightful trend summary report for the inspector.

=== PORTFOLIO METRICS ===
Total reports: ${allReports.length}
Reports by status: ${JSON.stringify(statusCounts)}
Total findings: ${totalFindings} (critical: ${criticalCount}, warnings: ${warningCount}, normal: ${normalCount})
Portfolio health score: ${healthScore}/100
Total tasks: ${allTasks.length}, overdue: ${overdueTasks}
Total field captures: ${allCaptures.length}

=== MONTHLY TREND (last 3 months) ===
${Object.entries(monthTrend).map(([m, v]) => `${m}: ${v.reports} reports, ${v.critical} critical findings`).join('\n')}

=== TOP PROJECTS BY SEVERITY ===
${topProblematic.join('\n') || 'N/A'}

=== MOST TAGGED TRADE AREAS ===
${topTags.join(', ') || 'No tags yet'}

=== TOP AFFECTED SECTIONS ===
${topSections.join(', ') || 'No section data'}

=== INSTRUCTIONS ===
Write a 4-6 paragraph professional trend summary. Use clear headings (prefix each with ##). Cover:
1. ## Portfolio Overview — overall health, volume, trajectory
2. ## Key Defect Trends — most common issues, trades, recurring themes
3. ## Projects Requiring Attention — top problematic projects
4. ## Month-on-Month Trend — improving, stable, or worsening
5. ## Recommendations — 2-3 specific, actionable steps for the inspector

Keep it concise but data-driven. Speak directly to the inspector (use "your portfolio", "you should"). Do not use bullet points for main paragraphs — use flowing prose. End with a brief encouragement or motivational sentence.`;

    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 800,
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }],
    });

    const summary = aiResponse.choices[0]?.message?.content?.trim() ?? 'Summary unavailable.';

    sendSuccess(res, { summary, generatedAt: new Date().toISOString() });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INSPECTION SCHEDULING
// ═══════════════════════════════════════════════════════════════════════════════

export async function listSchedules(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { projectId } = req.params;

    // Verify project ownership
    const project = await prisma.inspectProject.findFirst({ where: { id: projectId, userId } });
    if (!project) { sendNotFound(res, 'Project'); return; }

    const schedules = await prisma.inspectSchedule.findMany({
      where: { projectId, userId },
      orderBy: { scheduledAt: 'asc' },
    });

    sendSuccess(res, { schedules });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function createSchedule(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { projectId } = req.params;
    const { scheduledAt, title, notes, notifyEmail, recurrence } = req.body;

    if (!scheduledAt || !title) { sendError(res, 'scheduledAt and title are required', 400); return; }

    const project = await prisma.inspectProject.findFirst({ where: { id: projectId, userId } });
    if (!project) { sendNotFound(res, 'Project'); return; }

    const schedule = await prisma.inspectSchedule.create({
      data: {
        projectId,
        userId,
        scheduledAt: new Date(scheduledAt),
        title,
        notes: notes ?? null,
        notifyEmail: notifyEmail ?? null,
        recurrence: recurrence ?? 'none',
        status: 'pending',
      },
    });

    sendCreated(res, schedule);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function updateSchedule(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { sid } = req.params;
    const { scheduledAt, title, notes, notifyEmail, recurrence, status } = req.body;

    const existing = await prisma.inspectSchedule.findFirst({ where: { id: sid, userId } });
    if (!existing) { sendNotFound(res, 'Schedule'); return; }

    const updated = await prisma.inspectSchedule.update({
      where: { id: sid },
      data: {
        ...(scheduledAt ? { scheduledAt: new Date(scheduledAt) } : {}),
        ...(title       ? { title }        : {}),
        ...(notes !== undefined  ? { notes }  : {}),
        ...(notifyEmail !== undefined ? { notifyEmail } : {}),
        ...(recurrence  ? { recurrence }   : {}),
        ...(status      ? {
            status,
            completedAt: status === 'completed' ? new Date() : null,
          } : {}),
      },
    });

    sendSuccess(res, { schedule: updated });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function deleteSchedule(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { sid } = req.params;

    const existing = await prisma.inspectSchedule.findFirst({ where: { id: sid, userId } });
    if (!existing) { sendNotFound(res, 'Schedule'); return; }

    await prisma.inspectSchedule.delete({ where: { id: sid } });
    sendSuccess(res, { deleted: true });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

export async function listUpcomingSchedules(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const now = new Date();

    const schedules = await prisma.inspectSchedule.findMany({
      where: {
        userId,
        status: 'pending',
        scheduledAt: { gte: now },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 10,
      include: {
        project: { select: { id: true, name: true, location: true } },
      },
    });

    sendSuccess(res, { schedules });

    // Fire-and-forget: check if any upcoming schedules need reminder emails
    processScheduleReminders(userId).catch(() => { /* silent */ });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

/**
 * POST /inspect/schedules/reminders
 * Manually trigger reminder processing (useful for cron job).
 * Also called fire-and-forget from listUpcomingSchedules on each dashboard load.
 */
export async function triggerScheduleReminders(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const sent = await processScheduleReminders(userId);
    sendSuccess(res, { sent });
  } catch (err: any) {
    sendError(res, err.message);
  }
}

/**
 * Finds schedules due within the next 24–48 hours that haven't received a reminder,
 * sends reminder emails, and marks each as reminded.
 * Returns the count of reminders sent.
 */
async function processScheduleReminders(userId: string): Promise<number> {
  const now       = new Date();
  const in24h     = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in48h     = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  // Find pending schedules in the 24–48h window with a notifyEmail set,
  // and where a reminder hasn't been sent yet (or was sent > 23h ago to avoid
  // accidental duplicates from frequent dashboard checks)
  const schedules = await prisma.inspectSchedule.findMany({
    where: {
      userId,
      status: 'pending',
      notifyEmail: { not: null },
      scheduledAt: { gte: in24h, lte: in48h },
      OR: [
        { reminderSentAt: null },
        { reminderSentAt: { lt: new Date(now.getTime() - 23 * 60 * 60 * 1000) } },
      ],
    },
    include: {
      project: { select: { name: true, location: true } },
      user:    { select: { firstName: true, lastName: true } },
    },
  });

  let sent = 0;
  const frontendUrl = process.env.FRONTEND_URL || 'https://biddaro.com';

  for (const s of schedules) {
    try {
      const inspectorName = s.user
        ? `${s.user.firstName} ${s.user.lastName}`.trim()
        : 'Inspector';

      await sendScheduleReminderEmail({
        toEmail:         s.notifyEmail!,
        toName:          inspectorName,
        scheduleTitle:   s.title,
        projectName:     s.project.name,
        projectLocation: s.project.location,
        scheduledAt:     s.scheduledAt,
        notes:           s.notes,
        dashboardUrl:    `${frontendUrl}/inspect/projects`,
      });

      await prisma.inspectSchedule.update({
        where: { id: s.id },
        data:  { reminderSentAt: now },
      });

      sent++;
    } catch {
      // don't abort other schedules on individual failure
    }
  }

  return sent;
}

// ─── Inspection Completion Certificate ───────────────────────────────────────

/**
 * Generates a single-page A4-landscape styled PDF "Certificate of Inspection Completion"
 * for an approved or sent report. Suitable for printing and framing.
 */
export async function exportCertificate(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const [report, settings] = await Promise.all([
      prisma.inspectReport.findFirst({
        where: { id, userId },
        include: {
          project: { select: { name: true, location: true, clientName: true } },
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.inspectSettings.findUnique({ where: { userId } }),
    ]);
    if (!report) { sendNotFound(res, 'Report'); return; }

    const content = report.content as ReportContent;
    const summary = content?.summary;

    const BRAND  = '#1E3A5F';
    const ACCENT = '#2E86C1';
    const GOLD   = '#B7860B';
    const LIGHT  = '#F4F8FC';

    const inspectorName = settings?.inspectorName
      || (report.user ? `${report.user.firstName} ${report.user.lastName}`.trim() : 'Inspector')
      || 'Inspector';
    const companyName = settings?.companyName || 'Biddaro Inspect';
    const certDate = (report.sentAt || report.updatedAt || report.createdAt)
      .toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const issueDate = new Date().toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    const certNo = `CERT-${report.id.slice(-8).toUpperCase()}`;
    const overallStatus = summary?.overallStatus ?? 'reviewed';
    const statusLabel = overallStatus === 'pass' ? 'PASSED INSPECTION'
                      : overallStatus === 'fail' ? 'INSPECTION COMPLETE — ISSUES NOTED'
                      : 'INSPECTION COMPLETE';

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      const doc = new PDFDocument({
        size: 'A4', layout: 'landscape',
        margins: { top: 40, bottom: 40, left: 60, right: 60 },
        bufferPages: true,
        info: { Title: `Certificate of Inspection — ${report.title}` },
      });
      doc.on('data', (d: Uint8Array) => chunks.push(d));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width;
      const H = doc.page.height;
      const CX = W / 2;

      // Border decoration
      doc.rect(20, 20, W - 40, H - 40).strokeColor(BRAND).lineWidth(3).stroke();
      doc.rect(28, 28, W - 56, H - 56).strokeColor(GOLD).lineWidth(1).stroke();
      function corner(x: number, y: number, sx: number, sy: number) {
        doc.moveTo(x, y).lineTo(x + sx * 30, y).strokeColor(GOLD).lineWidth(2).stroke();
        doc.moveTo(x, y).lineTo(x, y + sy * 30).strokeColor(GOLD).lineWidth(2).stroke();
      }
      corner(28, 28, 1, 1); corner(W - 28, 28, -1, 1);
      corner(28, H - 28, 1, -1); corner(W - 28, H - 28, -1, -1);

      // Header banner
      doc.rect(28, 28, W - 56, 70).fillColor(BRAND).fill();
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF')
        .text('BIDDARO INSPECT', CX - 250, 43, { width: 500, align: 'center' });
      doc.font('Helvetica').fontSize(8).fillColor('#AACCEE')
        .text('AI-POWERED CONSTRUCTION INSPECTION', CX - 250, 60, { width: 500, align: 'center' });

      // Title
      doc.font('Helvetica-Bold').fontSize(26).fillColor(BRAND)
        .text('Certificate of Inspection', CX - 300, 118, { width: 600, align: 'center' });
      doc.font('Helvetica').fontSize(13).fillColor(GOLD)
        .text('COMPLETION & REVIEW', CX - 300, 150, { width: 600, align: 'center' });
      doc.moveTo(60, 175).lineTo(W - 60, 175).strokeColor(GOLD).lineWidth(0.75).stroke();

      // Body
      doc.font('Helvetica').fontSize(10).fillColor('#555555')
        .text('This is to certify that a professional inspection has been completed for', CX - 300, 190, { width: 600, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(16).fillColor(BRAND)
        .text(report.project.name, CX - 340, 208, { width: 680, align: 'center' });
      if (report.project.location) {
        doc.font('Helvetica').fontSize(10).fillColor('#666666')
          .text(report.project.location, CX - 300, 232, { width: 600, align: 'center' });
      }
      doc.font('Helvetica').fontSize(9.5).fillColor('#666666')
        .text(`Report: ${report.title}`, CX - 280, 250, { width: 560, align: 'center' });

      // Status badge
      const statusColor = overallStatus === 'pass' ? '#1A7A4A' : overallStatus === 'fail' ? '#B32424' : BRAND;
      const statusBg    = overallStatus === 'pass' ? '#E8F5ED' : overallStatus === 'fail' ? '#FDECEA' : LIGHT;
      const bW = 260; const bX = CX - bW / 2;
      doc.rect(bX, 270, bW, 28).fillColor(statusBg).fill();
      doc.rect(bX, 270, bW, 28).strokeColor(statusColor).lineWidth(1).stroke();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(statusColor)
        .text(statusLabel, bX, 281, { width: bW, align: 'center' });

      // Stats
      if (summary) {
        const stats = [
          { label: 'Total Findings', value: String(summary.totalFindings) },
          { label: 'Critical Issues', value: String(summary.criticalCount) },
          { label: 'Warnings',        value: String(summary.warningCount) },
        ];
        const slotW = 140; const totalW = stats.length * slotW + (stats.length - 1) * 20;
        let sx = CX - totalW / 2;
        for (const stat of stats) {
          doc.rect(sx, 310, slotW, 38).fillColor(LIGHT).fill();
          doc.font('Helvetica-Bold').fontSize(18).fillColor(BRAND).text(stat.value, sx, 316, { width: slotW, align: 'center' });
          doc.font('Helvetica').fontSize(8).fillColor('#888888').text(stat.label, sx, 333, { width: slotW, align: 'center' });
          sx += slotW + 20;
        }
      }
      doc.font('Helvetica').fontSize(9).fillColor('#666666')
        .text(`Client: ${report.project.clientName ?? 'N/A'}   ·   Inspection Date: ${certDate}   ·   Certificate No: ${certNo}`,
          CX - 300, 362, { width: 600, align: 'center' });

      // Signatures
      const sigY = 390;
      doc.moveTo(80, sigY).lineTo(300, sigY).strokeColor('#444444').lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND).text(inspectorName, 80, sigY + 5, { width: 220, align: 'center' });
      doc.font('Helvetica').fontSize(8).fillColor('#888888').text('Authorised Inspector', 80, sigY + 17, { width: 220, align: 'center' });
      if (settings?.licenseNo) {
        doc.font('Helvetica').fontSize(7.5).fillColor('#888888').text(`Lic. No: ${settings.licenseNo}`, 80, sigY + 29, { width: 220, align: 'center' });
      }
      if (report.clientSignedByName && report.clientSignedAt) {
        doc.moveTo(W - 300, sigY).lineTo(W - 80, sigY).strokeColor('#444444').lineWidth(0.5).stroke();
        doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND).text(report.clientSignedByName, W - 300, sigY + 5, { width: 220, align: 'center' });
        doc.font('Helvetica').fontSize(8).fillColor('#888888').text('Client Acknowledgement', W - 300, sigY + 17, { width: 220, align: 'center' });
        const csd = report.clientSignedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        doc.font('Helvetica').fontSize(7.5).fillColor('#888888').text(`Signed: ${csd}`, W - 300, sigY + 29, { width: 220, align: 'center' });
      }
      doc.font('Helvetica').fontSize(8).fillColor(ACCENT).text(companyName, CX - 200, sigY + 5, { width: 400, align: 'center' });

      // Footer
      doc.font('Helvetica').fontSize(7.5).fillColor('#AAAAAA')
        .text(`Issued: ${issueDate}   ·   ${certNo}   ·   Powered by Biddaro Inspect AI`, CX - 300, H - 52, { width: 600, align: 'center' });
      if (settings?.footerNote) {
        doc.font('Helvetica').fontSize(7).fillColor('#BBBBBB').text(settings.footerNote, CX - 250, H - 40, { width: 500, align: 'center' });
      }
      doc.end();
    });

    const filename = `certificate-${report.id.slice(-8)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err: any) {
    sendError(res, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BULK REPORT ZIP EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /inspect/reports/bulk-export
 * Body: { reportIds: string[], includePhotos?: boolean }
 *
 * Generates a PDF for each requested report (owned by the caller, max 20)
 * and streams back a single ZIP archive named "biddaro-reports-<date>.zip".
 */
export async function bulkExportReports(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { reportIds, includePhotos = false } = req.body as {
      reportIds: string[];
      includePhotos?: boolean;
    };

    if (!Array.isArray(reportIds) || reportIds.length === 0) {
      sendError(res, 'reportIds must be a non-empty array'); return;
    }
    // Cap at 20 to prevent unbounded processing
    const safeIds = reportIds.slice(0, 20);

    // Load inspector settings + logo once
    const settings   = await prisma.inspectSettings.findUnique({ where: { userId } });
    const logoBuffer = await fetchLogoBuffer(settings?.logoUrl);

    // Load all requested reports (ownership-checked in one query)
    const reports = await prisma.inspectReport.findMany({
      where: { id: { in: safeIds }, userId },
      include: {
        project: { select: { id: true, name: true, location: true, clientName: true } },
        user:    { select: { firstName: true, lastName: true } },
      },
    });

    if (reports.length === 0) {
      sendNotFound(res, 'Reports'); return;
    }

    // Generate PDFs in parallel (best-effort — skip individual failures)
    const pdfResults = await Promise.allSettled(
      reports.map(async (report) => {
        let embeddedPhotos: EmbeddedPhoto[] = [];

        if (includePhotos) {
          const captures = await prisma.inspectCapture.findMany({
            where: { projectId: report.project.id, type: 'photo' },
            select: { imageUrl: true, content: true, section: true },
            orderBy: { createdAt: 'asc' },
            take: 10, // fewer per report in bulk mode
          });

          const photoResults = await Promise.allSettled(
            captures.filter(c => c.imageUrl).map(async (c): Promise<EmbeddedPhoto> => {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 6000);
              try {
                const fetched = await fetch(c.imageUrl!, { signal: controller.signal });
                if (!fetched.ok) throw new Error(`HTTP ${fetched.status}`);
                const ab = await fetched.arrayBuffer();
                return { section: c.section, caption: c.content, buffer: Buffer.from(ab) };
              } finally {
                clearTimeout(timeout);
              }
            })
          );

          embeddedPhotos = photoResults
            .filter((r): r is PromiseFulfilledResult<EmbeddedPhoto> => r.status === 'fulfilled')
            .map(r => r.value);
        }

        const content = report.content as ReportContent;
        const buffer  = await buildPdf(report, content, report.project, settings, embeddedPhotos.length > 0 ? embeddedPhotos : undefined, logoBuffer);

        const safeName        = report.title.replace(/[^a-z0-9]/gi, '-').toLowerCase();
        const projectSafeName = report.project.name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
        return { buffer, filename: `${projectSafeName}__${safeName}.pdf` };
      })
    );

    // Collect successful PDFs only
    const pdfs = pdfResults
      .filter((r): r is PromiseFulfilledResult<{ buffer: Buffer; filename: string }> => r.status === 'fulfilled')
      .map(r => r.value);

    if (pdfs.length === 0) {
      sendError(res, 'Failed to generate any PDFs'); return;
    }

    // Build ZIP in memory using archiver
    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
      const archive  = new ZipArchive({ zlib: { level: 6 } });
      const chunks: Buffer[] = [];

      archive.on('data',  (chunk: Buffer) => chunks.push(chunk));
      archive.on('end',   ()              => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);

      for (const pdf of pdfs) {
        archive.append(pdf.buffer, { name: pdf.filename });
      }

      archive.finalize();
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    const zipName = `biddaro-reports-${dateStr}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.setHeader('X-Report-Count', String(pdfs.length));
    res.send(zipBuffer);
  } catch (err: any) {
    sendError(res, err.message);
  }
}
