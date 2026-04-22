import pool from "../database/db.js"

export default class CashRepository {
  async create(mov) {
    const res = await pool.query(
      `INSERT INTO cash_movements (type, source, amount, divisa, warehouse_id, negocio_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [mov.type, mov.source, mov.amount, mov.divisa || "ARS", mov.warehouse_id || null, mov.negocio_id]
    );
    return res.rows[0];
  }

  async getAll({ from, to, warehouseId, negocioId } = {}) {
    let query = "SELECT * FROM cash_movements WHERE 1=1";
    const params = [];
    if (negocioId)   { params.push(negocioId);             query += ` AND negocio_id = $${params.length}`; }
    if (from)        { params.push(`${from} 00:00:00`);    query += ` AND created_at >= $${params.length}`; }
    if (to)          { params.push(`${to} 23:59:59`);      query += ` AND created_at <= $${params.length}`; }
    if (warehouseId) { params.push(warehouseId);            query += ` AND warehouse_id = $${params.length}`; }
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
