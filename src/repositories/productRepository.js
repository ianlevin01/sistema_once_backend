import pool from "../database/db.js"

export default class ProductRepository {
  async search(name) {
    const res = await pool.query(
      "SELECT * FROM products WHERE name ILIKE $1",
      [`%${name || ""}%`]
    );
    return res.rows;
  }

  async getById(id) {
    const res = await pool.query(
      "SELECT * FROM products WHERE id=$1",
      [id]
    );
    return res.rows[0];
  }

  async create(p) {
    const res = await pool.query(
      `INSERT INTO products (name, code, description, category_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [p.name, p.code, p.description, p.category_id]
    );
    return res.rows[0];
  }

  async update(id, p) {
    const res = await pool.query(
      `UPDATE products SET name=$1, description=$2 WHERE id=$3 RETURNING *`,
      [p.name, p.description, id]
    );
    return res.rows[0];
  }

  async delete(id) {
    await pool.query("DELETE FROM products WHERE id=$1", [id]);
  }
}