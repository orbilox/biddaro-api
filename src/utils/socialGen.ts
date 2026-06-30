import OpenAI from 'openai';
import { uploadBufferToS3, isS3Configured } from './s3';
import { renderTemplateGraphic, type GraphicContent } from './socialGraphic';

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
  imageError?: string;   // why the image failed (for admin diagnostics)
  platform:    string;
}

interface CaptionResult {
  caption:  string;
  hashtags: string;
  graphic:  GraphicContent;   // structured content for the branded template
}

// For the AI-image fallback providers (gpt-image-1 / gemini) only.
function buildBrandedImagePrompt(g: GraphicContent): string {
  return [
    `Design a bold, modern, scroll-stopping Instagram post graphic for "Biddaro", a construction marketplace brand.`,
    `Prominent large headline, perfectly legible: "${g.headline}". Subheading: "${g.subheadline}".`,
    `Show benefit chips: ${g.features.join(', ')}. A call-to-action button: "${g.cta}".`,
    `Place the brand wordmark "Biddaro" cleanly in a corner.`,
    `Style: premium flat marketing poster, white background, vibrant construction orange (#EA580C) and deep navy, rounded pill buttons, strong typographic hierarchy — clean graphic design, not a photo.`,
    `Crisp correctly-spelled text, tasteful margins.`,
  ].join(' ');
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
          'Write engaging, professional yet friendly content, and structured content for a branded ' +
          'poster graphic. Respond ONLY with a JSON object with exactly these keys: ' +
          '"caption" (a 2-4 sentence post, may use 1-2 emojis, no hashtags inside), ' +
          '"hashtags" (5-8 relevant hashtags as one space-separated string, each starting with #), ' +
          '"headline" (a punchy 2-5 word headline for the poster, e.g. "Build Smarter, Bid Better"; a Hinglish phrase is great when natural), ' +
          '"subheadline" (one short supporting line, max ~6 words), ' +
          '"features" (an array of exactly 4 very short benefit labels, each 1-3 words, e.g. ["No Collateral","24hr Approval","8% Rate","Verified Pros"]), ' +
          '"cta" (a punchy 2-4 word call to action, e.g. "Apply Now" or "Abhi Apply Karo"), ' +
          '"badge" (an optional very short highlight chip, e.g. "Up to ₹5 Lakh" or "Free to Post", max 4 words). ' +
          'Keep all poster text concise so it fits cleanly — no long sentences in headline/features/cta/badge.',
      },
      {
        role: 'user',
        content: `Create a social media post about: ${topic}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  const features = Array.isArray(parsed.features)
    ? (parsed.features as unknown[]).map(String).filter(Boolean).slice(0, 4)
    : [];
  while (features.length < 4) features.push(['Verified Pros', 'Fast & Easy', 'Trusted', 'Secure'][features.length]);

  return {
    caption:  (parsed.caption  as string) || `Tip from Biddaro: ${topic}.`,
    hashtags: (parsed.hashtags as string) || '#Biddaro #Construction #Contractors #HomeImprovement',
    graphic: {
      headline:    (parsed.headline    as string) || 'Build with Biddaro',
      subheadline: (parsed.subheadline as string) || topic,
      features,
      cta:         (parsed.cta   as string) || 'Get Started',
      badge:       (parsed.badge as string) || undefined,
    },
  };
}

// ─── Step 2: turn the content into an actual image ───────────────────────────
// IMAGE_PROVIDER chooses the engine. Defaults to 'template' — our branded
// canvas renderer (pixel-perfect text, on-brand, free). 'openai'/'gemini' use
// an AI image model instead (photographic/illustrated, text may be imperfect).
async function generateImage(g: GraphicContent): Promise<string | null> {
  if (!isS3Configured()) return null; // nowhere to store the result

  const provider = (process.env.IMAGE_PROVIDER || 'template').toLowerCase();

  if (provider === 'template') return renderTemplateGraphic(g);

  const prompt = buildBrandedImagePrompt(g);
  return provider === 'gemini'
    ? generateImageGemini(prompt)
    : generateImageOpenAI(prompt);
}

// OpenAI image generation (DALL·E 3 by default — works on any funded account,
// no org verification needed; set OPENAI_IMAGE_MODEL=gpt-image-1 for the newer model).
async function generateImageOpenAI(imagePrompt: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const openai = new OpenAI({ apiKey });
  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

  // Note: the images API no longer accepts `response_format`. dall-e-* returns
  // a temporary URL by default; gpt-image-1 returns base64. Handle both.
  const genParams: Record<string, unknown> = {
    model,
    prompt: imagePrompt,
    size: '1024x1024',
    n: 1,
  };
  // gpt-image-1 supports a quality setting for sharper, more polished output.
  if (model.startsWith('gpt-image')) genParams.quality = process.env.OPENAI_IMAGE_QUALITY || 'high';

  const result = await openai.images.generate(genParams as never) as unknown as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  const img = result.data?.[0];
  let buffer: Buffer;
  if (img?.b64_json) {
    buffer = Buffer.from(img.b64_json, 'base64');
  } else if (img?.url) {
    const r = await fetch(img.url);
    if (!r.ok) throw new Error(`Could not download generated image (${r.status})`);
    buffer = Buffer.from(await r.arrayBuffer());
  } else {
    throw new Error(`OpenAI image API returned no image data (model: ${model})`);
  }
  return uploadBufferToS3(buffer, 'image/png', 'png', 'social');
}

// Gemini image generation (kept for accounts that prefer Gemini billing).
async function generateImageGemini(imagePrompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;          // image is optional — caption-only post is fine

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

  const { caption, hashtags, graphic } = await generateCaption(topic);

  // Image is best-effort: never let an image failure block the caption,
  // but capture the reason so the admin can see why it failed.
  let imageUrl: string | null = null;
  let imageError: string | undefined;
  try {
    imageUrl = await generateImage(graphic);
    if (!imageUrl) imageError = 'Image step produced nothing — check S3 keys (AWS_*) on Railway.';
  } catch (err) {
    imageError = (err as Error).message;
    console.error('[socialGen] image generation failed:', imageError);
  }

  const promptSummary = `${graphic.headline} — ${graphic.subheadline}`;
  return { topic, caption, hashtags, imagePrompt: promptSummary, imageUrl, imageError, platform: 'instagram' };
}
