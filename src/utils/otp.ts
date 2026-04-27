import crypto from 'crypto';

/**
 * Generates a cryptographically secure 6-digit OTP.
 * Range: 100000–999999 (always exactly 6 digits)
 */
export function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}
