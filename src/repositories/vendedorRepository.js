import pool from "../database/db.js";

export default class VendedorRepository {

  async getAll(negocioId) {
    const res = await pool.query(`
      SELECT
        v.*,
        COUNT(o.id) FILTER (WHERE o.vendedor = v.nombre) AS total_ventas
      FROM vendedores v
      LEFT JOIN orders o ON o.vendedor = v.nombre
      WHERE v.negocio_id = $1
      GROUP BY v.id
      ORDER BY v.nombre ASC
    `, [negocioId]);
    return res.rows;
  }

  async getById(id) {
    const res = await pool.query(
      `SELECT v.*,
        COUNT(o.id) FILTER (WHERE o.vendedor = v.nombre) AS total_ventas
       FROM vendedores v
       LEFT JOIN orders o ON o.vendedor = v.nombre
       WHERE v.id = $1
       GROUP BY v.id`,
      [id]
    );
    return res.rows[0];
  }

  async create({ nombre, email, negocio_id }) {
    const res = await pool.query(
      `INSERT INTO vendedores (nombre, email, negocio_id) VALUES ($1, $2, $3) RETURNING *`,
      [nombre, email || null, negocio_id]
    );
    return res.rows[0];
  }

  async update(id, { nombre, email, activo }) {
    const res = await pool.query(
      `UPDATE vendedores SET nombre = $1, email = $2, activo = $3 WHERE id = $4 RETURNING *`,
      [nombre, email || null, activo ?? true, id]
    );
    return res.rows[0];
  }

  async delete(id) {
    await pool.query(`DELETE FROM vendedores WHERE id = $1`, [id]);
  }

  async getActivos(negocioId) {
    const res = await pool.query(
      `SELECT id, nombre FROM vendedores WHERE activo = true AND negocio_id = $1 ORDER BY nombre ASC`,
      [negocioId]
    );
    return res.rows;
  }
}
