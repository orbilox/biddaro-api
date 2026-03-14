import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { config } from './config';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

const app = express();

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// In development: limiters are registered but instantly skipped — no false
// "Too many requests" errors while you're actively building / testing.
// In production: limits are enforced as configured.

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,           // default 15 min
  max: config.rateLimit.maxRequests,             // default 100  (override via RATE_LIMIT_MAX)
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.isDev,                      // ← bypass entirely in dev
  message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// Stricter limit for auth endpoints (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,                     // 15-minute window
  max: 20,                                       // 20 login/register attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.isDev,                      // ← bypass entirely in dev
  message: { success: false, message: 'Too many auth attempts, please try again in 15 minutes.' },
});
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

// ─── Logging ──────────────────────────────────────────────────────────────────
if (config.isDev) app.use(morgan('dev'));
else app.use(morgan('combined'));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ─── Static file serving (uploaded files) ────────────────────────────────────
// Set Cross-Origin-Resource-Policy: cross-origin so browsers on the frontend
// origin (localhost:3000) can load images/files from this origin (localhost:5000).
// Helmet 7.x defaults to same-origin which would block all cross-origin image loads.
app.use('/uploads', (_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(process.cwd(), 'uploads')));

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api/v1', routes);

// ─── Error handling ───────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
