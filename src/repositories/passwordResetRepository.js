import pool from '../database/db.js';

export default class PasswordResetRepository {
  /**
   * Get user by email from shop_users
   */
  async getUserByEmail(email) {
    const res = await pool.query(
      'SELECT id, name, email, password_hash FROM shop_users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email]
    );
    return res.rows[0] || null;
  }

  /**
   * Update password hash for a user by email
   */
  async updatePassword(email, passwordHash) {
    const res = await pool.query(
      'UPDATE shop_users SET password_hash = $1 WHERE LOWER(email) = LOWER($2) RETURNING id',
      [passwordHash, email]
    );
    return res.rows[0];
  }
}
