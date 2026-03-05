import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import {
  submitReview, getUserReviews, getJobReviews, getMyReviews, deleteReview,
} from '../controllers/reviews.controller';

const router = Router();

router.get('/my', authenticate, getMyReviews);
router.post('/', authenticate, validate([
  body('contractId').notEmpty().withMessage('Contract ID is required'),
  body('revieweeId').notEmpty().withMessage('Reviewee ID is required'),
  body('rating').isFloat({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comment').optional().trim().isLength({ max: 1000 }),
]), submitReview);
router.delete('/:id', authenticate, deleteReview);
router.get('/job/:jobId', getJobReviews);
router.get('/user/:userId', getUserReviews);

export default router;
