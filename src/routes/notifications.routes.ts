import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getNotifications, markNotificationRead, markAllRead, getUnreadCount,
} from '../controllers/notifications.controller';

const router = Router();

router.get('/', authenticate, getNotifications);
router.get('/unread-count', authenticate, getUnreadCount);
router.post('/read-all', authenticate, markAllRead);
router.post('/:id/read', authenticate, markNotificationRead);

export default router;
