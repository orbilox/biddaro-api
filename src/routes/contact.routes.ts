import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { submitContact } from '../controllers/contact.controller';

const router = Router();

router.post('/', validate([
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('subject').trim().notEmpty().withMessage('Subject is required'),
  body('message').trim().isLength({ min: 10 }).withMessage('Message must be at least 10 characters'),
]), submitContact);

export default router;
