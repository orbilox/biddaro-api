import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import {
  getConversations, getMessages, sendMessage, markRead, deleteMessage, getUnreadCount,
} from '../controllers/messages.controller';

const router = Router();

router.get('/', authenticate, getConversations);
router.get('/unread', authenticate, getUnreadCount);
router.get('/:otherUserId', authenticate, getMessages);
router.post('/', authenticate, validate([
  body('receiverId').notEmpty().withMessage('Receiver ID is required'),
  body('content').trim().isLength({ min: 1, max: 2000 }).withMessage('Message must be 1-2000 characters'),
]), sendMessage);
router.post('/:otherUserId/read', authenticate, markRead);
router.delete('/:id', authenticate, deleteMessage);

export default router;
