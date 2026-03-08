import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { chat } from '../controllers/ai.controller';

const router = Router();

// ─── Rate limit: 15 AI requests per minute per IP ─────────────────────────
const aiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please wait a moment before sending another message.',
  },
});

// POST /api/v1/ai/chat — public, no auth required
router.post('/chat', aiRateLimit, chat);

export default router;
