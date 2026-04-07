import pool from "../database/db.js";

export default class ProveedorRepository {
  async search(query) {
    const res = await pool.query(
      `SELECT id, name, document, phone, email, domicilio, localidad,
              condicion_iva, codigo, contacto
       FROM proveedores
       WHERE name ILIKE $1 OR document ILIKE $1 OR codigo ILIKE $1
       ORDER BY name
       LIMIT 20`,
      [`%${query}%`]
    );
    return res.rows;
  }

  async getAll() {
    const res = await pool.query(
      `SELECT * FROM proveedores ORDER BY name`
    );
    return res.rows;
  }

  async getById(id) {
    const res = await pool.query(
      `SELECT * FROM proveedores WHERE id = $1`,
      [id]
    );
    return res.rows[0] || null;
  }

  async create(data) {
    const res = await pool.query(
      `INSERT INTO proveedores
        (name, type, document, phone, email, domicilio, localidad,
         provincia, codigo_postal, contacto, descuento, dias_plazo,
         transporte, condicion_iva, vendedor, cuenta_pesos, cuenta_dolares, codigo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        data.name, data.type || null, data.document || null,
        data.phone || null, data.email || null, data.domicilio || null,
        data.localidad || null, data.provincia || null, data.codigo_postal || null,
        data.contacto || null, data.descuento || null, data.dias_plazo || null,
        data.transporte || null, data.condicion_iva || null, data.vendedor || null,
        data.cuenta_pesos || null, data.cuenta_dolares || null, data.codigo || null,
      ]
    );
    return res.rows[0];
  }

  async update(id, data) {
    const fields = [];
    const values = [];
    let i = 1;
    const allowed = [
      "name","type","document","phone","email","domicilio","localidad",
      "provincia","codigo_postal","contacto","descuento","dias_plazo",
      "transporte","condicion_iva","vendedor","cuenta_pesos","cuenta_dolares","codigo",
    ];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = $${i++}`);
        values.push(data[key]);
      }
    }
    if (!fields.length) return this.getById(id);
    values.push(id);
    const res = await pool.query(
      `UPDATE proveedores SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    return res.rows[0];
  }

  async delete(id) {
    await pool.query(`DELETE FROM proveedores WHERE id = $1`, [id]);
  }

  // ── Cuenta corriente ─────────────────────────────────────────
  async getCuentaCorriente(proveedorId) {
    const res = await pool.query(
      `SELECT * FROM cuentas_corrientes_prov WHERE proveedor_id = $1`,
      [proveedorId]
    );
    return res.rows[0] || null;
  }

  async getOrCreateCC(proveedorId, client) {
    const db = client || pool;
    const existing = await db.query(
      `SELECT * FROM cuentas_corrientes_prov WHERE proveedor_id = $1`,
      [proveedorId]
    );
    if (existing.rows[0]) return existing.rows[0];
    const created = await db.query(
      `INSERT INTO cuentas_corrientes_prov (proveedor_id) VALUES ($1) RETURNING *`,
      [proveedorId]
    );
    return created.rows[0];
  }

  async getMovimientos(proveedorId) {
    const cc = await this.getCuentaCorriente(proveedorId);
    if (!cc) return [];
    const res = await pool.query(
      `SELECT m.*, o.tipo AS order_tipo
       FROM cc_movimientos_prov m
       LEFT JOIN orders o ON o.id = m.order_id
       WHERE m.cuenta_corriente_id = $1
       ORDER BY m.created_at DESC`,
      [cc.id]
    );
    return res.rows;
  }
}
