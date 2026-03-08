import { Request, Response } from 'express';
import { sendSuccess, sendError } from '../utils/response';

// ─── Stable Horde — free community GPU cluster, no API key required ───────────
// Docs: https://stablehorde.net/api
// Anonymous key gives 6 kudos / image; plenty for a free tool.
const HORDE_API = 'https://stablehorde.net/api/v2';
const ANONYMOUS_KEY = '0000000000'; // public anonymous key

const POLL_INTERVAL_MS = 3_000; // check every 3 s
const TIMEOUT_MS = 120_000;     // 2-minute hard limit

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── POST /api/v1/image-gen/generate ──────────────────────────────────────────
export const generateImage = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = req.file;
    const { prompt } = req.body as { prompt?: string };

    // ── Validation ───────────────────────────────────────────────────────────
    if (!file) {
      sendError(res, 'Please upload an image (JPEG, PNG, or WebP, max 10 MB)', 400);
      return;
    }
    if (!prompt?.trim()) {
      sendError(res, 'Please provide a prompt describing your renovation vision', 400);
      return;
    }
    if (prompt.trim().length > 500) {
      sendError(res, 'Prompt must be 500 characters or less', 400);
      return;
    }

    const apiKey = process.env.STABLE_HORDE_KEY || ANONYMOUS_KEY;

    // ── Build an enriched prompt for construction / renovation imagery ────────
    const positivePrompt =
      `${prompt.trim()}, professional interior photography, photorealistic, ` +
      `high resolution, well-lit, detailed, award winning architecture photo`;
    const negativePrompt =
      'low quality, blurry, distorted, ugly, watermark, text, cartoon, ' +
      'sketch, drawing, bad anatomy, deformed, worst quality';

    // ── Step 1: Submit generation job ─────────────────────────────────────────
    const submitRes = await fetch(`${HORDE_API}/generate/async`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': apiKey,
        'Client-Agent': 'biddaro:1.0:contact@biddaro.com',
      },
      body: JSON.stringify({
        prompt: `${positivePrompt} ### ${negativePrompt}`,
        params: {
          width: 512,
          height: 512,
          steps: 25,
          cfg_scale: 7.5,
          sampler_name: 'k_euler_a',
          n: 1,
        },
        // Prefer high-quality photorealistic models; fall back to default SD
        models: ['Deliberate', 'stable_diffusion'],
        trusted_workers: false,
        slow_workers: true,
        censor_nsfw: true,
        nsfw: false,
        r2: true, // store on Cloudflare R2 (gives us a URL to download from)
      }),
    });

    if (!submitRes.ok) {
      const body = await submitRes.text();
      console.error('Stable Horde submit error:', submitRes.status, body);
      sendError(res, 'Image generation service is temporarily unavailable. Please try again.', 502);
      return;
    }

    const { id: jobId } = (await submitRes.json()) as { id: string };
    if (!jobId) {
      sendError(res, 'Failed to start image generation. Please try again.', 500);
      return;
    }

    // ── Step 2: Poll until done (or timeout) ──────────────────────────────────
    const deadline = Date.now() + TIMEOUT_MS;
    let done = false;
    let faulted = false;

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);

      const checkRes = await fetch(`${HORDE_API}/generate/check/${jobId}`, {
        headers: { 'Client-Agent': 'biddaro:1.0:contact@biddaro.com' },
      });
      if (!checkRes.ok) continue; // transient error — keep polling

      const check = (await checkRes.json()) as {
        done: boolean;
        faulted: boolean;
        queue_position?: number;
        wait_time?: number;
        processing?: number;
      };

      if (check.faulted) { faulted = true; break; }
      if (check.done) { done = true; break; }
    }

    if (faulted) {
      sendError(res, 'Image generation failed on the AI worker. Please try again.', 500);
      return;
    }
    if (!done) {
      sendError(res, 'Image generation timed out. The service may be busy — please try again.', 504);
      return;
    }

    // ── Step 3: Fetch the final image URL ─────────────────────────────────────
    const statusRes = await fetch(`${HORDE_API}/generate/status/${jobId}`, {
      headers: { 'Client-Agent': 'biddaro:1.0:contact@biddaro.com' },
    });
    if (!statusRes.ok) {
      sendError(res, 'Could not retrieve the generated image. Please try again.', 502);
      return;
    }

    const status = (await statusRes.json()) as {
      generations?: Array<{ img: string; censored?: boolean }>;
    };
    const generation = status.generations?.[0];

    if (!generation?.img) {
      sendError(res, 'Generated image was not returned. Please try again.', 500);
      return;
    }
    if (generation.censored) {
      sendError(res, 'Your prompt was flagged by the content filter. Please try a different description.', 400);
      return;
    }

    // ── Step 4: Download image and convert to base64 data URL ─────────────────
    const imgRes = await fetch(generation.img);
    if (!imgRes.ok) {
      sendError(res, 'Failed to download the generated image. Please try again.', 502);
      return;
    }

    const arrayBuffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imgRes.headers.get('content-type') || 'image/webp';

    sendSuccess(
      res,
      { imageUrl: `data:${mimeType};base64,${base64}` },
      'Image generated successfully'
    );
  } catch (err: unknown) {
    console.error('Image generation error:', err);
    sendError(res, 'Failed to generate image. Please try again.', 500);
  }
};
