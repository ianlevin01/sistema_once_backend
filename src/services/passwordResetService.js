import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import PasswordResetRepository from '../repositories/passwordResetRepository.js';
import { sendPasswordResetEmail } from './emailService.js';

const repo = new PasswordResetRepository();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const RESET_TOKEN_EXPIRY = '15m'; // 15 minutes
const SALT_ROUNDS = 10;

// Rate limiter: store { email: { count: N, resetTime: timestamp } }
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_ATTEMPTS = 3;

export default class PasswordResetService {
  /**
   * Request password reset for an email
   * Validates email exists, rate limits, generates token, sends email
   */
  async requestPasswordReset(email) {
    const normalizedEmail = email.toLowerCase().trim();

    // Check rate limit
    const now = Date.now();
    const limitData = rateLimitStore.get(normalizedEmail);
    if (limitData && now - limitData.resetTime < RATE_LIMIT_WINDOW) {
      if (limitData.count >= RATE_LIMIT_MAX_ATTEMPTS) {
        // Return generic message for security (don't reveal rate limit)
        return { success: true, message: 'Email sent if account exists' };
      }
      limitData.count++;
    } else {
      rateLimitStore.set(normalizedEmail, { count: 1, resetTime: now });
    }

    // Check if email exists in shop_users
    const user = await repo.getUserByEmail(normalizedEmail);
    if (!user) {
      // Return generic message for security (don't reveal if email exists)
      return { success: true, message: 'Email sent if account exists' };
    }

    // Generate JWT reset token (15 min expiry)
    const resetToken = jwt.sign(
      { email: normalizedEmail, purpose: 'password-reset' },
      JWT_SECRET,
      { expiresIn: RESET_TOKEN_EXPIRY }
    );

    // Build reset link
    const baseUrl = process.env.BASE_URL || 'https://paginaonce.com';
    const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;
    console.log('🔐 Reset password DEBUG:');
    console.log('  baseUrl:', baseUrl);
    console.log('  resetToken:', resetToken);
    console.log('  resetLink:', resetLink);

    // Send email
    try {
      await sendPasswordResetEmail({
        to: normalizedEmail,
        customerName: user.name,
        resetLink,
      });
    } catch (err) {
      console.error('Error sending reset email:', err);
      throw new Error('Error sending reset email');
    }

    return { success: true, message: 'Email sent if account exists' };
  }

  /**
   * Verify and process password reset
   * Validates token, updates password
   */
  async confirmPasswordReset(token, newPassword) {
    // Validate password length
    if (!newPassword || newPassword.trim().length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new Error('Reset link has expired');
      }
      throw new Error('Invalid reset link');
    }

    // Verify purpose
    if (decoded.purpose !== 'password-reset') {
      throw new Error('Invalid reset link');
    }

    const email = decoded.email;

    // Check if email still exists
    const user = await repo.getUserByEmail(email);
    if (!user) {
      throw new Error('User not found');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password in database
    await repo.updatePassword(email, passwordHash);

    return { success: true, message: 'Password updated successfully' };
  }

  /**
   * Clean up old rate limit entries (call periodically)
   */
  cleanupRateLimits() {
    const now = Date.now();
    for (const [email, data] of rateLimitStore.entries()) {
      if (now - data.resetTime > RATE_LIMIT_WINDOW) {
        rateLimitStore.delete(email);
      }
    }
  }
}
