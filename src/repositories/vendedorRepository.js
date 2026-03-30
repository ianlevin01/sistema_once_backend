import pool from "../database/db.js";

export default class VendedorRepository {

  async getAll() {
    const res = await pool.query(`
      SELECT
        v.*,
        COUNT(o.id) FILTER (WHERE o.vendedor = v.nombre) AS total_ventas
      FROM vendedores v
      LEFT JOIN orders o ON o.vendedor = v.nombre
      GROUP BY v.id
      ORDER BY v.nombre ASC
    `);
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

  async create({ nombre, email }) {
    const res = await pool.query(
      `INSERT INTO vendedores (nombre, email) VALUES ($1, $2) RETURNING *`,
      [nombre, email || null]
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

  // Para los selects en formularios — solo activos
  async getActivos() {
    const res = await pool.query(
      `SELECT id, nombre FROM vendedores WHERE activo = true ORDER BY nombre ASC`
    );
    return res.rows;
  }
}
