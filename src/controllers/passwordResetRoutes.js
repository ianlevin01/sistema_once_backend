import { Router } from 'express';
import PasswordResetService from '../services/passwordResetService.js';

const router = Router();
const svc = new PasswordResetService();

/**
 * POST /api/shop/password-reset/request
 * Request password reset email
 *
 * Body: { email }
 * Returns: { success, message }
 */
router.post('/request', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const result = await svc.requestPasswordReset(email);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Error in password reset request:', err);
    return res.status(500).json({ message: 'Error processing request' });
  }
});

/**
 * POST /api/shop/password-reset/confirm
 * Confirm password reset with token
 *
 * Body: { token, password }
 * Returns: { success, message }
 */
router.post('/confirm', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !token.trim()) {
      return res.status(400).json({ message: 'Invalid reset link' });
    }

    if (!password || !password.trim()) {
      return res.status(400).json({ message: 'Password is required' });
    }

    const result = await svc.confirmPasswordReset(token, password);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Error in password reset confirm:', err);

    // Return user-friendly error messages
    if (err.message.includes('expired') || err.message.includes('invalid') || err.message.includes('not found')) {
      return res.status(400).json({ message: err.message });
    }

    return res.status(500).json({ message: 'Error processing reset' });
  }
});

export default router;
