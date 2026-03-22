import pool from "../database/db.js"

export default class OrderRepository {
  async create(order, client) {
    const res = await client.query(
      `INSERT INTO orders (customer_id, user_id, total, profit, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [order.customer_id, order.user_id, order.total, order.profit, order.status]
    );
    return res.rows[0];
  }

  async getById(id) {
    const res = await pool.query("SELECT * FROM orders WHERE id=$1", [id]);
    return res.rows[0];
  }

  async getAll({ from, to }) {
    let query = "SELECT * FROM orders WHERE 1=1";
    let params = [];

    if (from) {
      params.push(from);
      query += ` AND created_at >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      query += ` AND created_at <= $${params.length}`;
    }

    const res = await pool.query(query, params);
    return res.rows;
  }
}