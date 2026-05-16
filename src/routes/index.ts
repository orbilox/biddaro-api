import { Router, Request, Response } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './users.routes';
import jobRoutes from './jobs.routes';
import bidRoutes from './bids.routes';
import contractRoutes from './contracts.routes';
import messageRoutes from './messages.routes';
import walletRoutes from './wallet.routes';
import disputeRoutes from './disputes.routes';
import reviewRoutes from './reviews.routes';
import notificationRoutes from './notifications.routes';
import uploadRoutes from './upload.routes';
import aiRoutes from './ai.routes';
import imageGenRoutes from './image-gen.routes';
import depositRequestRoutes from './depositRequests.routes';
import bankSettingsRoutes from './bankSettings.routes';
import adminRoutes from './admin.routes';
import premiumRoutes from './premium.routes';
import addonsRoutes from './addons.routes';
import projectTrackingRoutes from './projectTracking.routes';
import pmRoutes from './pm.routes';
import buildPlannerRoutes from './buildPlanner.routes';
import loansRoutes from './loans.routes';
import contactRoutes from './contact.routes';
import paymentsRoutes from './payments.routes';
import referralRoutes from './referral.routes';

const router = Router();

// ─── API root ─────────────────────────────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Biddaro API v1',
    endpoints: [
      '/api/v1/auth',
      '/api/v1/users',
      '/api/v1/jobs',
      '/api/v1/bids',
      '/api/v1/contracts',
      '/api/v1/messages',
      '/api/v1/wallet',
      '/api/v1/disputes',
      '/api/v1/reviews',
      '/api/v1/notifications',
      '/api/v1/upload',
      '/api/v1/ai',
      '/api/v1/image-gen',
      '/api/v1/deposit-requests',
      '/api/v1/bank-settings',
      '/api/v1/admin',
      '/api/v1/premium',
      '/api/v1/addons',
      '/api/v1/project-tracking',
      '/api/v1/pm',
      '/api/v1/referral',
    ],
  });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/jobs', jobRoutes);
router.use('/bids', bidRoutes);
router.use('/contracts', contractRoutes);
router.use('/messages', messageRoutes);
router.use('/wallet', walletRoutes);
router.use('/disputes', disputeRoutes);
router.use('/reviews', reviewRoutes);
router.use('/notifications', notificationRoutes);
router.use('/upload', uploadRoutes);
router.use('/ai', aiRoutes);
router.use('/image-gen', imageGenRoutes);
router.use('/deposit-requests', depositRequestRoutes);
router.use('/bank-settings', bankSettingsRoutes);
router.use('/admin', adminRoutes);
router.use('/premium', premiumRoutes);
router.use('/addons', addonsRoutes);
router.use('/project-tracking', projectTrackingRoutes);
router.use('/pm', pmRoutes);
router.use('/build-planner', buildPlannerRoutes);
router.use('/loans', loansRoutes);
router.use('/contact', contactRoutes);
router.use('/payments', paymentsRoutes);
router.use('/referral', referralRoutes);

// ─── One-time setup endpoints ─────────────────────────────────────────────────
import { prisma } from '../config/database';
import bcrypt from 'bcryptjs';

/** Create or fully reset the super-admin account — protected by SETUP_SECRET */
router.post('/setup/create-admin', async (req: Request, res: Response) => {
  try {
    const { email, password, secret } = req.body;
    const validSecret = process.env.SETUP_SECRET || 'biddaro_setup_2024';
    if (secret !== validSecret) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'email and password required' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash, role: 'admin', isVerified: true, isActive: true },
      create: {
        email,
        passwordHash,
        firstName: 'Super',
        lastName: 'Admin',
        role: 'admin',
        isVerified: true,
        isActive: true,
      },
    });
    // Ensure wallet exists
    await prisma.wallet.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, balance: 0, pendingBalance: 0, totalEarned: 0 },
    });
    return res.json({ success: true, message: `Admin account ready: ${user.email}` });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/setup/make-admin', async (req: Request, res: Response) => {
  try {
    const { email, secret } = req.body;
    const validSecret = process.env.SETUP_SECRET || 'biddaro_setup_2024';
    if (secret !== validSecret) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const user = await prisma.user.update({
      where: { email },
      data: { role: 'admin', isVerified: true },
    });
    return res.json({ success: true, message: `${user.email} is now admin` });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/setup/reset-admin-password', async (req: Request, res: Response) => {
  try {
    const { email, newPassword, secret } = req.body;
    const validSecret = process.env.SETUP_SECRET || 'biddaro_setup_2024';
    if (secret !== validSecret) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const user = await prisma.user.update({
      where: { email },
      data: { passwordHash },
    });
    return res.json({ success: true, message: `Password reset for ${user.email}` });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
