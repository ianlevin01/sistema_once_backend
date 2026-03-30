import pool from "../database/db.js"

export default class CashRepository {
  async create(mov) {
    const res = await pool.query(
      `INSERT INTO cash_movements (type, source, amount)
       VALUES ($1,$2,$3) RETURNING *`,
      [mov.type, mov.source, mov.amount]
    );
    return res.rows[0];
  }

  async getAll({ from, to } = {}) {
    let query = "SELECT * FROM cash_movements WHERE 1=1";
    const params = [];
    if (from) { params.push(`${from} 00:00:00`); query += ` AND created_at >= $${params.length}`; }
    if (to)   { params.push(`${to} 23:59:59`);   query += ` AND created_at <= $${params.length}`; }
    query += " ORDER BY created_at DESC";
    const res = await pool.query(query, params);
    return res.rows;
  }

  async getById(id) {
    const res = await pool.query(
      "SELECT * FROM cash_movements WHERE id=$1",
      [id]
    );
    return res.rows[0];
  }
}