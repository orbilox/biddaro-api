import OpenAI from 'openai';
import { uploadBufferToS3, isS3Configured } from './s3';

// ─── Rotating content themes for Biddaro's social presence ───────────────────
// Construction marketplace serving India, UAE, and Singapore.
export const SOCIAL_TOPICS = [
  'A money-saving tip for homeowners planning a renovation',
  'Why getting multiple bids saves you money on construction projects',
  'How to spot a trustworthy contractor (red flags to avoid)',
  'A quick guide to construction loan eligibility',
  'Benefits of using escrow payments for construction work',
  'Seasonal home maintenance checklist for property owners',
  'How verified contractors build trust with clients',
  'Smart budgeting tips for your next building project',
  'The value of detailed project documentation and contracts',
  'How small contractors can win more jobs online',
  'Common mistakes people make when hiring builders',
  'Why digital inspections are the future of construction',
];

/** Deterministic topic for a given index (used by the calendar planner). */
export function topicForIndex(i: number): string {
  return SOCIAL_TOPICS[((i % SOCIAL_TOPICS.length) + SOCIAL_TOPICS.length) % SOCIAL_TOPICS.length];
}

function pickTopic(): string {
  // Rotate by day-of-year so each day gets a different, deterministic theme.
  const day = Math.floor(Date.now() / 86_400_000);
  return SOCIAL_TOPICS[day % SOCIAL_TOPICS.length];
}

export interface GeneratedPost {
  topic:       string;
  caption:     string;
  hashtags:    string;
  imagePrompt: string;
  imageUrl:    string | null;
  platform:    string;
}

interface CaptionResult {
  caption:     string;
  hashtags:    string;
  imagePrompt: string;
}

// ─── Step 1: OpenAI (ChatGPT) writes the caption + image prompt ───────────────
async function generateCaption(topic: string): Promise<CaptionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  const openai = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const completion = await openai.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are the social media manager for Biddaro, a construction marketplace that connects ' +
          'homeowners and businesses with verified contractors, and also offers construction loans ' +
          'and digital site inspections. Biddaro operates in India, the UAE, and Singapore. ' +
          'Write engaging, professional yet friendly social media content. Respond ONLY with a JSON ' +
          'object with exactly these keys: "caption" (a 2-4 sentence post, may use 1-2 emojis, no hashtags inside), ' +
          '"hashtags" (5-8 relevant hashtags as a single space-separated string, each starting with #), ' +
          '"imagePrompt" (a vivid, detailed prompt for an AI image generator describing a photorealistic, ' +
          'professional image that fits this post — no text or logos in the image).',
      },
      {
        role: 'user',
        content: `Create a social media post about: ${topic}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  let parsed: Partial<CaptionResult>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  return {
    caption:     parsed.caption     || `Tip from Biddaro: ${topic}.`,
    hashtags:    parsed.hashtags    || '#Biddaro #Construction #Contractors #HomeImprovement',
    imagePrompt: parsed.imagePrompt || `Professional photorealistic image: ${topic}, construction theme, bright and clean`,
  };
}

// ─── Step 2: Gemini turns the image prompt into an actual image ───────────────
async function generateImage(imagePrompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;          // image is optional — caption-only post is fine
  if (!isS3Configured()) return null; // nowhere to store the result

  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: imagePrompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini image generation failed (${res.status}): ${await res.text()}`);
  }

  const data: any = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p: any) => p?.inlineData?.data);
  if (!imgPart) return null;

  const base64   = imgPart.inlineData.data as string;
  const mimeType = (imgPart.inlineData.mimeType as string) || 'image/png';
  const ext      = mimeType.split('/')[1] || 'png';
  const buffer   = Buffer.from(base64, 'base64');

  return uploadBufferToS3(buffer, mimeType, ext, 'social');
}

// ─── Orchestrator ────────────────────────────────────────────────────────────
export async function generateSocialPost(customTopic?: string): Promise<GeneratedPost> {
  const topic = customTopic?.trim() || pickTopic();

  const { caption, hashtags, imagePrompt } = await generateCaption(topic);

  // Image is best-effort: never let an image failure block the caption.
  let imageUrl: string | null = null;
  try {
    imageUrl = await generateImage(imagePrompt);
  } catch (err) {
    console.error('[socialGen] image generation failed:', (err as Error).message);
  }

  return { topic, caption, hashtags, imagePrompt, imageUrl, platform: 'instagram' };
}
