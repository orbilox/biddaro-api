import path from 'path';
import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import { uploadBufferToS3 } from './s3';

// ─── Brand palette ────────────────────────────────────────────────────────────
const ORANGE    = '#EA580C';
const ORANGE_DK = '#C2410C';
const DARK       = '#1F2937';
const GRAY       = '#6B7280';
const PILL_BG    = '#F3F4F6';
const PILL_TEXT  = '#374151';
const WHITE      = '#FFFFFF';

// ─── Register Poppins (bundled via @expo-google-fonts/poppins) ────────────────
let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  try {
    const dir = path.dirname(require.resolve('@expo-google-fonts/poppins/package.json'));
    GlobalFonts.registerFromPath(path.join(dir, '700Bold',    'Poppins_700Bold.ttf'),     'PoppinsBold');
    GlobalFonts.registerFromPath(path.join(dir, '600SemiBold','Poppins_600SemiBold.ttf'), 'PoppinsSemi');
    GlobalFonts.registerFromPath(path.join(dir, '500Medium',  'Poppins_500Medium.ttf'),   'PoppinsMedium');
    GlobalFonts.registerFromPath(path.join(dir, '400Regular', 'Poppins_400Regular.ttf'),  'PoppinsRegular');
  } catch (err) {
    console.error('[socialGraphic] font registration failed:', (err as Error).message);
  }
  fontsReady = true;
}

export interface GraphicContent {
  headline:    string;    // 2-5 words, big
  subheadline: string;    // one short line
  features:    string[];  // up to 4 short benefit labels
  cta:         string;    // 2-4 words
  badge?:      string;    // optional highlight (e.g. "₹5 Lakh")
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────
function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y,     x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x,     y + h, rr);
  ctx.arcTo(x,     y + h, x,     y,     rr);
  ctx.arcTo(x,     y,     x + w, y,     rr);
  ctx.closePath();
}

/** Break text into lines that fit maxWidth using the current ctx.font. */
function wrapLines(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Shrink font until the single line fits maxWidth. Returns the px size used. */
function fitFontSize(ctx: SKRSContext2D, text: string, family: string, start: number, min: number, maxWidth: number): number {
  let size = start;
  while (size > min) {
    ctx.font = `${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

// ─── Render the post graphic to a PNG buffer ──────────────────────────────────
export function renderGraphicBuffer(g: GraphicContent): Buffer {
  ensureFonts();

  const W = 1080, H = 1350, PAD = 90;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, W, H);

  // Subtle brand accent corner shapes
  ctx.fillStyle = '#FFF1E9';
  ctx.beginPath(); ctx.arc(W - 40, 120, 130, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(70, H - 260, 90, 0, Math.PI * 2); ctx.fill();

  // Brand wordmark (top-left)
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ORANGE;
  ctx.font = '40px PoppinsBold';
  ctx.fillText('Biddaro', PAD, PAD + 24);

  // ── Headline (up to 2 lines; second line orange for flair) ──────────────────
  const maxText = W - PAD * 2;
  let hSize = 104;
  ctx.font = `${hSize}px PoppinsBold`;
  let hLines = wrapLines(ctx, g.headline, maxText);
  while (hLines.length > 2 && hSize > 64) {
    hSize -= 6;
    ctx.font = `${hSize}px PoppinsBold`;
    hLines = wrapLines(ctx, g.headline, maxText);
  }
  let y = PAD + 150;
  const lineH = hSize * 1.08;
  hLines.forEach((line, i) => {
    ctx.fillStyle = i === hLines.length - 1 && hLines.length > 1 ? ORANGE : DARK;
    ctx.font = `${hSize}px PoppinsBold`;
    ctx.fillText(line, PAD, y);
    y += lineH;
  });

  // ── Subheadline ─────────────────────────────────────────────────────────────
  y += 18;
  const subSize = fitFontSize(ctx, g.subheadline, 'PoppinsMedium', 46, 30, maxText);
  ctx.font = `${subSize}px PoppinsMedium`;
  ctx.fillStyle = GRAY;
  ctx.fillText(g.subheadline, PAD, y);
  y += 60;

  // ── Badge (optional) — orange rounded chip ──────────────────────────────────
  if (g.badge) {
    ctx.font = '46px PoppinsBold';
    const bw = ctx.measureText(g.badge).width + 80;
    const bh = 96;
    roundRect(ctx, PAD, y, bw, bh, 24);
    ctx.fillStyle = ORANGE; ctx.fill();
    ctx.fillStyle = WHITE;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(g.badge, PAD + bw / 2, y + bh / 2 + 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    y += bh + 50;
  } else {
    y += 20;
  }

  // ── Feature pills (2-column grid) ───────────────────────────────────────────
  const feats = g.features.slice(0, 4);
  const gap = 30;
  const pillW = (maxText - gap) / 2;
  const pillH = 110;
  feats.forEach((f, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const px = PAD + col * (pillW + gap);
    const py = y + row * (pillH + gap);
    roundRect(ctx, px, py, pillW, pillH, 28);
    ctx.fillStyle = PILL_BG; ctx.fill();
    const fSize = fitFontSize(ctx, f, 'PoppinsSemi', 38, 22, pillW - 50);
    ctx.font = `${fSize}px PoppinsSemi`;
    ctx.fillStyle = PILL_TEXT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(f, px + pillW / 2, py + pillH / 2 + 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  });
  const rows = Math.ceil(feats.length / 2);
  y += rows * (pillH + gap) + 40;

  // ── CTA button ──────────────────────────────────────────────────────────────
  const ctaH = 130;
  const ctaW = maxText;
  const ctaX = PAD;
  const ctaY = H - PAD - 120 - ctaH;
  roundRect(ctx, ctaX, ctaY + 6, ctaW, ctaH, 36); // shadow
  ctx.fillStyle = ORANGE_DK; ctx.fill();
  roundRect(ctx, ctaX, ctaY, ctaW, ctaH, 36);
  ctx.fillStyle = ORANGE; ctx.fill();
  // Text (leave room on the right for a drawn arrow)
  const ctaSize = fitFontSize(ctx, g.cta, 'PoppinsBold', 56, 32, ctaW - 260);
  ctx.font = `${ctaSize}px PoppinsBold`;
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const ctaTextW = ctx.measureText(g.cta).width;
  const ctaCx = ctaX + ctaW / 2 - 40;
  ctx.fillText(g.cta, ctaCx, ctaY + ctaH / 2 + 2);
  // Arrow drawn as vector (Poppins has no → glyph)
  const ay = ctaY + ctaH / 2;
  const ax = ctaCx + ctaTextW / 2 + 44;
  ctx.strokeStyle = WHITE; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(ax - 24, ay); ctx.lineTo(ax + 28, ay); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ax + 8, ay - 20); ctx.lineTo(ax + 30, ay); ctx.lineTo(ax + 8, ay + 20); ctx.stroke();

  // ── Footer ──────────────────────────────────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.fillStyle = DARK;
  ctx.font = '34px PoppinsBold';
  ctx.fillText('biddaro.com', W / 2, H - PAD + 6);
  ctx.fillStyle = GRAY;
  ctx.font = '26px PoppinsRegular';
  ctx.fillText('Secured by Razorpay', W / 2, H - PAD + 48);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  return canvas.toBuffer('image/png');
}

// ─── Render + upload to S3, return URL ────────────────────────────────────────
export async function renderTemplateGraphic(g: GraphicContent): Promise<string | null> {
  const buffer = renderGraphicBuffer(g);
  return uploadBufferToS3(buffer, 'image/png', 'png', 'social');
}
