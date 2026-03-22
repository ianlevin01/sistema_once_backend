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

  async getAll() {
    const res = await pool.query("SELECT * FROM cash_movements");
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