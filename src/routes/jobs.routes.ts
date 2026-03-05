import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate, requireRole, optionalAuth } from '../middleware/auth';
import {
  listJobs, getJob, createJob, updateJob, deleteJob, getMyJobs, estimateJobCost,
} from '../controllers/jobs.controller';
import {
  createBid, getJobBids,
} from '../controllers/bids.controller';

const router = Router();

router.get('/', optionalAuth, listJobs);
router.get('/my', authenticate, getMyJobs);

router.post('/', authenticate, requireRole('job_poster'), validate([
  body('title').trim().isLength({ min: 5, max: 200 }).withMessage('Title must be 5-200 characters'),
  body('description').trim().isLength({ min: 20 }).withMessage('Description must be at least 20 characters'),
  body('category').notEmpty().withMessage('Category is required'),
  body('budget').isFloat({ min: 0 }).withMessage('Budget must be a positive number'),
  body('location').notEmpty().withMessage('Location is required'),
]), createJob);

router.post('/estimate', authenticate, estimateJobCost);

router.get('/:id', optionalAuth, getJob);
router.put('/:id', authenticate, requireRole('job_poster'), updateJob);
router.delete('/:id', authenticate, requireRole('job_poster'), deleteJob);

// Bids sub-resource
router.get('/:jobId/bids', authenticate, getJobBids);
router.post('/:jobId/bids', authenticate, requireRole('contractor'), validate([
  body('amount').isFloat({ min: 1 }).withMessage('Bid amount must be at least $1'),
  body('proposal').trim().isLength({ min: 20 }).withMessage('Proposal must be at least 20 characters'),
]), createBid);

export default router;
