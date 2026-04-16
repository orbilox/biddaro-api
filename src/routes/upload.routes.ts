import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../middleware/auth';
import { sendSuccess, sendError } from '../utils/response';
import type { AuthenticatedRequest } from '../types';

// ─── S3 Client ────────────────────────────────────────────────────────────────
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET || 'biddaro-uploads';

// ─── Multer (memory storage — files go to S3, not disk) ──────────────────────
const memoryStorage = multer.memoryStorage();

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_DOC_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/zip',
];
const ALLOWED_ALL_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOC_TYPES];

const imageFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only JPEG, PNG, GIF and WebP images are allowed'));
};

const anyFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (ALLOWED_ALL_TYPES.includes(file.mimetype)) cb(null, true);
  else cb(new Error('File type not allowed'));
};

const uploadImages = multer({ storage: memoryStorage, fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadAny   = multer({ storage: memoryStorage, fileFilter: anyFilter,   limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Helper: upload buffer to S3 ─────────────────────────────────────────────
async function uploadToS3(file: Express.Multer.File, folder: string = 'uploads'): Promise<string> {
  const ext = path.extname(file.originalname).toLowerCase();
  const key = `${folder}/${uuidv4()}${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  return `https://${BUCKET}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${key}`;
}

// ─── Router ───────────────────────────────────────────────────────────────────
const router = Router();

/**
 * POST /api/v1/upload/images
 * Upload up to 10 images. Field name: "files"
 */
router.post('/images', authenticate, uploadImages.array('files', 10), async (req: AuthenticatedRequest, res: Response) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) { sendError(res, 'No images uploaded', 400); return; }

  try {
    const urls = await Promise.all(files.map(async (f) => ({
      url: await uploadToS3(f, 'images'),
      originalName: f.originalname,
      size: f.size,
      mimeType: f.mimetype,
    })));
    sendSuccess(res, { files: urls }, `${files.length} image(s) uploaded`);
  } catch (err: any) {
    sendError(res, `Upload failed: ${err.message}`, 500);
  }
});

/**
 * POST /api/v1/upload/documents
 * Upload up to 5 documents. Field name: "files"
 */
router.post('/documents', authenticate, uploadAny.array('files', 5), async (req: AuthenticatedRequest, res: Response) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) { sendError(res, 'No documents uploaded', 400); return; }

  try {
    const uploaded = await Promise.all(files.map(async (f) => ({
      url: await uploadToS3(f, 'documents'),
      originalName: f.originalname,
      size: f.size,
      mimeType: f.mimetype,
    })));
    sendSuccess(res, { files: uploaded }, `${files.length} document(s) uploaded`);
  } catch (err: any) {
    sendError(res, `Upload failed: ${err.message}`, 500);
  }
});

/**
 * POST /api/v1/upload/single
 * Upload a single file (any type). Field name: "file"
 */
router.post('/single', authenticate, uploadAny.single('file'), async (req: AuthenticatedRequest, res: Response) => {
  const file = req.file;
  if (!file) { sendError(res, 'No file uploaded', 400); return; }

  try {
    const folder = ALLOWED_IMAGE_TYPES.includes(file.mimetype) ? 'images' : 'documents';
    const url = await uploadToS3(file, folder);
    sendSuccess(res, {
      url,
      originalName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    }, 'File uploaded');
  } catch (err: any) {
    sendError(res, `Upload failed: ${err.message}`, 500);
  }
});

export default router;
