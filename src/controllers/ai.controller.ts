import { Request, Response } from 'express';
import OpenAI from 'openai';
import { sendSuccess, sendError } from '../utils/response';

// ─── System prompt — construction domain expert ────────────────────────────
const SYSTEM_PROMPT = `You are Biddaro AI, a friendly and knowledgeable construction assistant. You help homeowners, property managers, and contractors with all things construction-related.

You can help with:
- Project cost estimation and budget planning
- Material selection, quantities, and sourcing
- Construction best practices and techniques
- Building codes, permits, and inspections (general guidance)
- Hiring the right contractor — what to look for, red flags to avoid
- Understanding construction timelines and schedules
- Home renovation, remodeling, and additions
- Safety guidelines on construction sites
- Maintenance and repair advice
- Understanding bids, contracts, and payments
- Analyzing construction photos and site images

Rules:
- Be concise, friendly, and practical. Use markdown formatting (headers, lists, bold) for clarity.
- When estimating costs, always provide realistic price ranges (e.g. "$5,000–$15,000 depending on materials and region").
- Always recommend consulting a licensed professional for complex structural, electrical, plumbing, or permit work.
- If an image is attached, describe what you see and provide relevant construction advice based on it.
- Do NOT answer questions unrelated to construction, home improvement, or the Biddaro platform.
- If asked about Biddaro, explain it's a marketplace connecting homeowners with verified contractors for bids, contracts, and secure escrow payments.`;

// ─── Content types (multimodal) ────────────────────────────────────────────
type TextPart = { type: 'text'; text: string };
type ImagePart = { type: 'image_url'; image_url: { url: string; detail?: string } };
type ContentPart = TextPart | ImagePart;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

// ─── POST /api/v1/ai/chat ──────────────────────────────────────────────────
export const chat = async (req: Request, res: Response): Promise<void> => {
  try {
    const { messages } = req.body as { messages: ChatMessage[] };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      sendError(res, 'messages array is required', 400);
      return;
    }

    // Validate each message shape
    for (const msg of messages) {
      if (!msg.role || !['user', 'assistant'].includes(msg.role)) {
        sendError(res, 'Each message must have role (user|assistant)', 400);
        return;
      }
      if (msg.content === undefined || msg.content === null) {
        sendError(res, 'Each message must have content', 400);
        return;
      }
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      sendError(res, 'AI service is not configured. Please add OPENAI_API_KEY to the server environment.', 503);
      return;
    }

    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        // Keep last 12 messages for context window efficiency
        ...(messages.slice(-12) as any),
      ],
      max_tokens: 1500,
      temperature: 0.7,
    });

    const reply =
      completion.choices[0]?.message?.content?.trim() ||
      'Sorry, I was unable to generate a response. Please try again.';

    sendSuccess(res, { reply }, 'Response generated');
  } catch (err: unknown) {
    console.error('AI chat error:', err);

    const anyErr = err as Record<string, unknown>;
    if (anyErr?.status === 429 || anyErr?.code === 'insufficient_quota') {
      sendError(res, 'AI service is temporarily at capacity. Please try again in a moment.', 503);
      return;
    }
    if (anyErr?.status === 401) {
      sendError(res, 'AI service authentication failed. Please check the API key.', 503);
      return;
    }

    sendError(res, 'Failed to get AI response. Please try again.', 500);
  }
};
