import pool from "../database/db.js";

export default class ProductVariantsRepository {
  async getByProduct(productId) {
    const res = await pool.query(
      `SELECT * FROM product_variants WHERE product_id = $1 ORDER BY tipo, created_at`,
      [productId]
    );
    return res.rows;
  }

  async create(productId, tipo, fields) {
    const { nombre, hex, alto, ancho, profundidad } = fields;
    const res = await pool.query(
      `INSERT INTO product_variants (product_id, tipo, nombre, hex, alto, ancho, profundidad)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [productId, tipo, nombre ?? null, hex ?? null, alto ?? null, ancho ?? null, profundidad ?? null]
    );
    return res.rows[0];
  }

  async delete(id, productId) {
    const res = await pool.query(
      `DELETE FROM product_variants WHERE id = $1 AND product_id = $2 RETURNING id`,
      [id, productId]
    );
    return res.rowCount > 0;
  }
}
