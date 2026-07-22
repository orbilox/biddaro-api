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
import siteManagerRoutes from './siteManager.routes';
import connectsRoutes from './connects.routes';
import inspectRoutes from './inspect.routes';
import safetyRoutes from './safety.routes';
import socialPostsRoutes from './socialPosts.routes';
import whatsappRoutes from './whatsapp.routes';
import contractorSitesRoutes from './contractorSites.routes';

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
      '/api/v1/connects',
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
router.use('/site-manager', siteManagerRoutes);
router.use('/connects', connectsRoutes);
router.use('/inspect', inspectRoutes);
router.use('/safety', safetyRoutes);
router.use('/social-posts', socialPostsRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/sites', contractorSitesRoutes);

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

/** Create/reset a pre-verified test user (contractor) — protected by SETUP_SECRET.
 *  Used for the Inspect app test login + Google Play reviewer credentials. */
router.post('/setup/create-test-user', async (req: Request, res: Response) => {
  try {
    const { email, password, secret, firstName, lastName } = req.body;
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
      update: { passwordHash, isVerified: true, isActive: true },
      create: {
        email,
        passwordHash,
        firstName: firstName || 'Inspect',
        lastName:  lastName  || 'Tester',
        role: 'contractor',
        isVerified: true,
        isActive: true,
        location: 'Ludhiana, Punjab',
      },
    });
    await prisma.wallet.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, balance: 0, pendingBalance: 0, totalEarned: 0 },
    });
    return res.json({ success: true, message: `Test user ready: ${user.email}` });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/** Seed a polished demo contractor + Pro Biddaro Site (idempotent) — protected by SETUP_SECRET */
router.post('/setup/seed-demo-site', async (req: Request, res: Response) => {
  try {
    const { secret } = req.body;
    const validSecret = process.env.SETUP_SECRET || 'biddaro_setup_2024';
    if (secret !== validSecret) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const demoEmail = 'demo.contractor@biddaro.com';
    const portfolio = [
      {
        title: '3BHK Villa — Model Town',
        description: 'Complete turnkey construction of a 2,400 sq ft modern villa, delivered in 11 months.',
        category: 'New Construction', year: 2025,
        imageUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80',
        location: 'Ludhiana',
      },
      {
        title: 'Full Home Renovation',
        description: 'Structural repairs, new flooring, modular kitchen and complete repainting of a 20-year-old home.',
        category: 'Renovation', year: 2025,
        imageUrl: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&q=80',
        location: 'Ludhiana',
      },
      {
        title: 'Commercial Shop Complex',
        description: '6-unit shop complex with basement parking — RCC frame structure completed on schedule.',
        category: 'Commercial', year: 2024,
        imageUrl: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=800&q=80',
        location: 'Jalandhar',
      },
      {
        title: 'Luxury Bathroom Remodel',
        description: 'Premium fittings, Italian tiles and waterproofing for two full bathrooms.',
        category: 'Interiors', year: 2024,
        imageUrl: 'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?w=800&q=80',
        location: 'Ludhiana',
      },
    ];

    const passwordHash = await bcrypt.hash(`demo_${Date.now()}_${Math.random().toString(36).slice(2)}`, 12);
    const user = await prisma.user.upsert({
      where: { email: demoEmail },
      update: {},
      create: {
        email: demoEmail,
        passwordHash,
        firstName: 'Rajesh',
        lastName: 'Sharma',
        role: 'contractor',
        isVerified: true,
        isActive: true,
        location: 'Ludhiana, Punjab',
        yearsExperience: 15,
        bio: 'Second-generation civil contractor leading a 25-member team. We handle everything from foundation to finishing — on time, on budget, with weekly progress photos for every client.',
        skills: JSON.stringify(['House Construction', 'Renovation', 'Interiors', 'Tiling', 'Waterproofing', 'Painting']),
        portfolio: JSON.stringify(portfolio),
      },
    });

    const site = await prisma.contractorSite.upsert({
      where: { userId: user.id },
      update: { isPro: true, enabled: true },
      create: {
        userId: user.id,
        slug: 'sharma-constructions',
        headline: 'Building Dream Homes Since 2009',
        about:
          'Sharma Constructions is a full-service construction company based in Ludhiana. From new homes and commercial buildings to renovations and interiors, we manage the complete project — materials, labour, and quality checks — so you don\'t have to. Every project gets a dedicated site supervisor and weekly photo updates.',
        services: JSON.stringify(['House Construction', 'Renovation', 'Modular Interiors', 'Tiling & Flooring', 'Waterproofing', 'Commercial Projects']),
        isPro: true,
        proExpiresAt: new Date('2099-01-01'),
      },
    });

    return res.json({ success: true, message: 'Demo site ready', data: { slug: site.slug, url: `https://www.biddaro.com/c/${site.slug}` } });
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
