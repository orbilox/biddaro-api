import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getNotifications, markNotificationRead, markAllRead, getUnreadCount,
  getVapidPublicKey, subscribePush, unsubscribePush,
} from '../controllers/notifications.controller';

const router = Router();

router.get('/', authenticate, getNotifications);
router.get('/unread-count', authenticate, getUnreadCount);
router.get('/vapid-public-key', authenticate, getVapidPublicKey);
router.post('/subscribe-push', authenticate, subscribePush);
router.post('/unsubscribe-push', authenticate, unsubscribePush);
router.post('/read-all', authenticate, markAllRead);
router.post('/:id/read', authenticate, markNotificationRead);

export default router;
