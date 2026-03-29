import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  getDashboard,
  getContractFeed,
  postUpdate,
  deleteUpdate,
} from '../controllers/projectTracking.controller';

const router = Router();

// Dashboard — all active contracts with latest update
router.get('/', authenticate, getDashboard);

// Single contract feed
router.get('/:contractId', authenticate, getContractFeed);

// Post an update on a contract
router.post('/:contractId/updates', authenticate, validate([
  body('message').trim().isLength({ min: 1, max: 1000 }).withMessage('Message is required (max 1000 chars)'),
  body('progressPercent').optional().isInt({ min: 0, max: 100 }).withMessage('Progress must be 0–100'),
  body('type').optional().isIn(['update', 'note', 'photo', 'milestone']).withMessage('Invalid update type'),
]), postUpdate);

// Delete an update (poster only for their own updates)
router.delete('/:contractId/updates/:updateId', authenticate, deleteUpdate);

export default router;
