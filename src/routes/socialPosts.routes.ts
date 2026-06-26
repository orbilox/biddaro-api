import { Router } from 'express';
import { generateSocialPostCron } from '../controllers/socialPosts.controller';

const router = Router();

// Cron-secret protected — triggered daily by the Vercel cron route.
router.post('/generate', generateSocialPostCron);

export default router;
