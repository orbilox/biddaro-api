import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import {
  register, login, refreshToken, logout, getMe, changePassword,
  sendOtp, verifyOtp, forgotPassword, resetPassword,
} from '../controllers/auth.controller';

const router = Router();

router.post('/register', validate([
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('role').isIn(['job_poster', 'contractor']).withMessage('Role must be job_poster or contractor'),
  body('phone').optional().isMobilePhone('any').withMessage('Invalid phone number'),
]), register);

router.post('/login', validate([
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
]), login);

router.post('/refresh', validate([
  body('refreshToken').notEmpty().withMessage('Refresh token is required'),
]), refreshToken);

router.post('/send-otp', validate([
  body('email').isEmail().normalizeEmail(),
]), sendOtp);

router.post('/verify-otp', validate([
  body('email').isEmail().normalizeEmail(),
  body('code').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Code must be 6 digits'),
]), verifyOtp);

router.post('/forgot-password', validate([
  body('email').isEmail().normalizeEmail(),
]), forgotPassword);

router.post('/reset-password', validate([
  body('token').notEmpty().withMessage('Reset token is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
]), resetPassword);

router.post('/logout', authenticate, logout);
router.get('/me', authenticate, getMe);

router.put('/change-password', authenticate, validate([
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
]), changePassword);

export default router;
