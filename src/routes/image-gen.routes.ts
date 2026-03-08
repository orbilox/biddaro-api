import { Router, Request } from 'express';
import multer, { FileFilterCallback } from 'multer';
import rateLimit from 'express-rate-limit';
import { generateImage } from '../controllers/image-gen.controller';

const router = Router();

// ─── Multer with memory storage (buffer sent directly to HuggingFace) ─────────
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are accepted'));
    }
  },
});

// ─── Rate limit: 20 requests per 5 minutes per IP ─────────────────────────────
// (image gen takes 30–60 s each, so 20 per 5 min is already very generous)
const imgGenRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5-minute window
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many image generation requests. Please wait a few minutes before trying again.',
  },
});

// POST /api/v1/image-gen/generate — public, no auth required
router.post('/generate', imgGenRateLimit, memUpload.single('image'), generateImage);

export default router;
