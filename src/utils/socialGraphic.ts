import path from 'path';
import { createCanvas, GlobalFonts, type SKRSContext2D as Ctx } from '@napi-rs/canvas';
import { uploadBufferToS3 } from './s3';

// ─── Brand palette ────────────────────────────────────────────────────────────
const ORANGE     = '#EA580C';
const ORANGE_DK  = '#C2410C';
const ORANGE_LT  = '#FFF1E9';
const DARK        = '#1F2937';
const GRAY        = '#6B7280';
const PILL_BG     = '#F3F4F6';
const PILL_TEXT   = '#374151';
const WHITE       = '#FFFFFF';

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
  headline:    string;
  subheadline: string;
  features:    string[];
  cta:         string;
  badge?:      string;
}

const W = 1080, H = 1350, PAD = 90;

// ─── Low-level helpers ────────────────────────────────────────────────────────
function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y,     x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x,     y + h, rr);
  ctx.arcTo(x,     y + h, x,     y,     rr);
  ctx.arcTo(x,     y,     x + w, y,     rr);
  ctx.closePath();
}

function wrapLines(ctx: Ctx, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function fitFont(ctx: Ctx, text: string, family: string, start: number, min: number, maxWidth: number): number {
  let size = start;
  while (size > min) {
    ctx.font = `${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function arrow(ctx: Ctx, ax: number, ay: number, color: string) {
  ctx.strokeStyle = color; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(ax - 24, ay); ctx.lineTo(ax + 28, ay); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ax + 8, ay - 20); ctx.lineTo(ax + 30, ay); ctx.lineTo(ax + 8, ay + 20); ctx.stroke();
}

/** CTA button with drawn arrow. Centered text. */
function ctaButton(ctx: Ctx, x: number, y: number, w: number, h: number, text: string, fill: string, shadow: string, fg: string) {
  roundRect(ctx, x, y + 6, w, h, 34); ctx.fillStyle = shadow; ctx.fill();
  roundRect(ctx, x, y, w, h, 34);     ctx.fillStyle = fill;   ctx.fill();
  const size = fitFont(ctx, text, 'PoppinsBold', 54, 30, w - 240);
  ctx.font = `${size}px PoppinsBold`;
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  const cx = x + w / 2 - 40;
  ctx.fillText(text, cx, y + h / 2 + 2);
  arrow(ctx, cx + tw / 2 + 44, y + h / 2, fg);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function pill(ctx: Ctx, x: number, y: number, w: number, h: number, text: string, bg: string, fg: string) {
  roundRect(ctx, x, y, w, h, 26); ctx.fillStyle = bg; ctx.fill();
  const size = fitFont(ctx, text, 'PoppinsSemi', 36, 20, w - 50);
  ctx.font = `${size}px PoppinsSemi`;
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

/** 2-column pill grid. Returns the y after the grid. */
function pillsGrid(ctx: Ctx, x: number, y: number, totalW: number, items: string[], bg: string, fg: string): number {
  const gap = 28, pillW = (totalW - gap) / 2, pillH = 104;
  items.slice(0, 4).forEach((f, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    pill(ctx, x + col * (pillW + gap), y + row * (pillH + gap), pillW, pillH, f, bg, fg);
  });
  const rows = Math.ceil(Math.min(items.length, 4) / 2);
  return y + rows * (pillH + gap) - gap;
}

function brand(ctx: Ctx, x: number, y: number, align: CanvasTextAlign, color: string) {
  ctx.fillStyle = color; ctx.font = '40px PoppinsBold';
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Biddaro', x, y);
  ctx.textAlign = 'left';
}

function footer(ctx: Ctx, mainColor: string, subColor: string) {
  ctx.textAlign = 'center';
  ctx.fillStyle = mainColor; ctx.font = '32px PoppinsBold';
  ctx.fillText('biddaro.com', W / 2, H - PAD + 4);
  ctx.fillStyle = subColor; ctx.font = '25px PoppinsRegular';
  ctx.fillText('Secured by Razorpay', W / 2, H - PAD + 44);
  ctx.textAlign = 'left';
}

/** Headline, wrapped to <=2 lines, last line optionally accent-colored. Returns endY. */
function headline(ctx: Ctx, text: string, x: number, y: number, maxW: number, align: CanvasTextAlign, base: string, accentLast: string | null): number {
  let size = 100;
  ctx.font = `${size}px PoppinsBold`;
  let lines = wrapLines(ctx, text, maxW);
  while (lines.length > 2 && size > 60) { size -= 6; ctx.font = `${size}px PoppinsBold`; lines = wrapLines(ctx, text, maxW); }
  const lineH = size * 1.06;
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  lines.forEach((ln, i) => {
    ctx.fillStyle = (accentLast && i === lines.length - 1 && lines.length > 1) ? accentLast : base;
    ctx.font = `${size}px PoppinsBold`;
    ctx.fillText(ln, x, y + i * lineH);
  });
  ctx.textAlign = 'left';
  // bottom of the text block (baseline of last line + descender allowance)
  return y + (lines.length - 1) * lineH + size * 0.27;
}

function bg(ctx: Ctx, color: string) { ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); }
function badgeChip(ctx: Ctx, x: number, y: number, text: string, bgc: string, fg: string): number {
  ctx.font = '44px PoppinsBold';
  const bw = ctx.measureText(text).width + 76, bh = 92;
  roundRect(ctx, x, y, bw, bh, 22); ctx.fillStyle = bgc; ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + bw / 2, y + bh / 2 + 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  return y + bh;
}

const CTA_TOP = H - PAD - 130 - 120;   // 1010 — shared bottom CTA anchor

// ─── Layout A — Headline left, pill grid ──────────────────────────────────────
function layoutA(ctx: Ctx, g: GraphicContent) {
  bg(ctx, WHITE);
  ctx.fillStyle = ORANGE_LT;
  ctx.beginPath(); ctx.arc(W - 30, 110, 130, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(60, H - 250, 90, 0, 7); ctx.fill();
  brand(ctx, PAD, PAD + 24, 'left', ORANGE);
  let y = PAD + 180;
  y = headline(ctx, g.headline, PAD, y, W - PAD * 2, 'left', DARK, ORANGE) + 56;
  ctx.font = '44px PoppinsMedium'; ctx.fillStyle = GRAY;
  ctx.fillText(g.subheadline, PAD, y); y += 44;
  if (g.badge) y = badgeChip(ctx, PAD, y, g.badge, ORANGE, WHITE) + 42; else y += 18;
  pillsGrid(ctx, PAD, y, W - PAD * 2, g.features, PILL_BG, PILL_TEXT);
  ctaButton(ctx, PAD, CTA_TOP, W - PAD * 2, 128, g.cta, ORANGE, ORANGE_DK, WHITE);
  footer(ctx, DARK, GRAY);
}

// ─── Layout B — Bold centered ─────────────────────────────────────────────────
function layoutB(ctx: Ctx, g: GraphicContent) {
  bg(ctx, WHITE);
  ctx.fillStyle = ORANGE_LT; ctx.beginPath(); ctx.arc(W / 2, 60, 210, 0, 7); ctx.fill();
  brand(ctx, W / 2, PAD + 30, 'center', ORANGE);
  let y = PAD + 240;
  const bot = headline(ctx, g.headline, W / 2, y, W - PAD * 2, 'center', DARK, ORANGE);
  ctx.fillStyle = ORANGE; roundRect(ctx, W / 2 - 70, bot + 22, 140, 10, 5); ctx.fill();
  y = bot + 86;
  ctx.font = '44px PoppinsMedium'; ctx.fillStyle = GRAY; ctx.textAlign = 'center';
  ctx.fillText(g.subheadline, W / 2, y); ctx.textAlign = 'left'; y += 48;
  if (g.badge) { ctx.font = '44px PoppinsBold'; const bw = ctx.measureText(g.badge).width + 76; badgeChip(ctx, W / 2 - bw / 2, y, g.badge, ORANGE, WHITE); y += 92 + 40; }
  pillsGrid(ctx, PAD, y, W - PAD * 2, g.features, PILL_BG, PILL_TEXT);
  const cw = Math.min(W - PAD * 2, 780);
  ctaButton(ctx, W / 2 - cw / 2, CTA_TOP, cw, 128, g.cta, ORANGE, ORANGE_DK, WHITE);
  footer(ctx, DARK, GRAY);
}

// ─── Layout C — Split: white top, orange bottom ───────────────────────────────
function layoutC(ctx: Ctx, g: GraphicContent) {
  bg(ctx, WHITE);
  const splitY = 700;
  ctx.fillStyle = ORANGE; ctx.fillRect(0, splitY, W, H - splitY);
  brand(ctx, PAD, PAD + 24, 'left', ORANGE);
  let y = PAD + 180;
  y = headline(ctx, g.headline, PAD, y, W - PAD * 2, 'left', DARK, ORANGE) + 52;
  ctx.font = '42px PoppinsMedium'; ctx.fillStyle = GRAY; ctx.fillText(g.subheadline, PAD, y);
  if (g.badge) badgeChip(ctx, PAD, splitY - 128, g.badge, DARK, WHITE);
  // features on orange — translucent white pills, CTA right below
  const pe = pillsGrid(ctx, PAD, splitY + 64, W - PAD * 2, g.features, 'rgba(255,255,255,0.22)', WHITE);
  ctaButton(ctx, PAD, pe + 44, W - PAD * 2, 120, g.cta, WHITE, '#E5E5E5', ORANGE);
  footer(ctx, WHITE, 'rgba(255,255,255,0.85)');
}

// ─── Layout D — Offer card (card height + position fit content) ───────────────
function layoutD(ctx: Ctx, g: GraphicContent) {
  bg(ctx, WHITE);
  brand(ctx, PAD, PAD + 24, 'left', ORANGE);
  let y = PAD + 175;
  y = headline(ctx, g.headline, PAD, y, W - PAD * 2, 'left', DARK, ORANGE) + 50;
  ctx.font = '40px PoppinsMedium'; ctx.fillStyle = GRAY; ctx.fillText(g.subheadline, PAD, y); y += 44;

  const items = g.features.slice(0, 4);
  const rows = Math.ceil(items.length / 2);
  const rowH = 92, badgeH = g.badge ? 96 : 0;
  const cardH = 50 + badgeH + rows * rowH + 36;
  const availTop = y, availBot = CTA_TOP - 50;
  const cardY = availTop + Math.max(0, (availBot - availTop - cardH) / 2);
  const cardX = PAD, cardW = W - PAD * 2;
  roundRect(ctx, cardX, cardY + 8, cardW, cardH, 40); ctx.fillStyle = ORANGE_DK; ctx.fill();
  roundRect(ctx, cardX, cardY, cardW, cardH, 40);     ctx.fillStyle = ORANGE;   ctx.fill();
  let cy = cardY + 46;
  if (g.badge) {
    const bs = fitFont(ctx, g.badge, 'PoppinsBold', 70, 40, cardW - 120);
    ctx.font = `${bs}px PoppinsBold`; ctx.fillStyle = WHITE;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(g.badge, W / 2, cy + bs / 2); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    cy += badgeH;
  }
  const gap = 28, colW = (cardW - 80 - gap) / 2;
  items.forEach((f, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    pill(ctx, cardX + 40 + col * (colW + gap), cy + row * rowH, colW, 76, f, 'rgba(255,255,255,0.18)', WHITE);
  });
  ctaButton(ctx, PAD, CTA_TOP, W - PAD * 2, 128, g.cta, ORANGE, ORANGE_DK, WHITE);
  footer(ctx, DARK, GRAY);
}

const LAYOUTS = [layoutA, layoutB, layoutC, layoutD];

// ─── Render to a PNG buffer (random layout unless one is forced) ──────────────
export function renderGraphicBuffer(g: GraphicContent, layoutIndex?: number): Buffer {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const idx = layoutIndex ?? Math.floor(Math.random() * LAYOUTS.length);
  LAYOUTS[idx % LAYOUTS.length](ctx, g);
  return canvas.toBuffer('image/png');
}

export async function renderTemplateGraphic(g: GraphicContent): Promise<string | null> {
  const buffer = renderGraphicBuffer(g);
  return uploadBufferToS3(buffer, 'image/png', 'png', 'social');
}
