import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../middleware/auth';
import { sendSuccess, sendError } from '../utils/response';
import type { AuthenticatedRequest } from '../types';

// ─── Ensure uploads folder exists ─────────────────────────────────────────────
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ─── Multer storage ───────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_DOC_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
const ALLOWED_ALL_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOC_TYPES];

const imageFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only JPEG, PNG, GIF and WebP images are allowed'));
};

const anyFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (ALLOWED_ALL_TYPES.includes(file.mimetype)) cb(null, true);
  else cb(new Error('File type not allowed. Supported: images, PDF, Word documents'));
};

const uploadImages = multer({ storage, fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadAny = multer({ storage, fileFilter: anyFilter, limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Helper: build public URL ─────────────────────────────────────────────────
function fileUrl(filename: string): string {
  const base = process.env.API_URL || 'http://localhost:5000';
  return `${base}/uploads/${filename}`;
}

// ─── Router ───────────────────────────────────────────────────────────────────
const router = Router();

/**
 * POST /api/v1/upload/images
 * Upload up to 10 images at once.
 * Field name: "files"
 */
router.post('/images', authenticate, uploadImages.array('files', 10), (req: AuthenticatedRequest, res: Response) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    sendError(res, 'No images uploaded', 400);
    return;
  }
  const urls = files.map((f) => ({
    url: fileUrl(f.filename),
    originalName: f.originalname,
    size: f.size,
    mimeType: f.mimetype,
  }));
  sendSuccess(res, { files: urls }, `${files.length} image(s) uploaded`);
});

/**
 * POST /api/v1/upload/documents
 * Upload up to 5 documents (PDF/Word/txt) at once.
 * Field name: "files"
 */
router.post('/documents', authenticate, uploadAny.array('files', 5), (req: AuthenticatedRequest, res: Response) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    sendError(res, 'No documents uploaded', 400);
    return;
  }
  const uploaded = files.map((f) => ({
    url: fileUrl(f.filename),
    originalName: f.originalname,
    size: f.size,
    mimeType: f.mimetype,
  }));
  sendSuccess(res, { files: uploaded }, `${files.length} document(s) uploaded`);
});

/**
 * POST /api/v1/upload/single
 * Upload a single file (image or document).
 * Field name: "file"
 */
router.post('/single', authenticate, uploadAny.single('file'), (req: AuthenticatedRequest, res: Response) => {
  const file = req.file;
  if (!file) {
    sendError(res, 'No file uploaded', 400);
    return;
  }
  sendSuccess(res, {
    url: fileUrl(file.filename),
    originalName: file.originalname,
    size: file.size,
    mimeType: file.mimetype,
  }, 'File uploaded');
});

export default router;
