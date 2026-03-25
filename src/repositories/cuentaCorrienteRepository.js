import pool from "../database/db.js";

export default class CuentaCorrienteRepository {

  // ── Obtener o crear cuenta corriente de un cliente ─────────
  async getOrCreate(customerId, client) {
    const db = client || pool;

    // Buscar existente
    const existing = await db.query(
      `SELECT * FROM cuentas_corrientes WHERE customer_id = $1`,
      [customerId]
    );
    if (existing.rows[0]) return existing.rows[0];

    // Crear nueva
    const res = await db.query(
      `INSERT INTO cuentas_corrientes (customer_id, saldo)
       VALUES ($1, 0)
       RETURNING *`,
      [customerId]
    );
    return res.rows[0];
  }

  // ── Obtener cuenta con movimientos ─────────────────────────
  async getByCustomer(customerId) {
    const cuenta = await pool.query(
      `SELECT cc.*, c.name AS customer_name, c.document, c.email, c.phone
       FROM cuentas_corrientes cc
       JOIN customers c ON c.id = cc.customer_id
       WHERE cc.customer_id = $1`,
      [customerId]
    );
    if (!cuenta.rows[0]) return null;

    const movimientos = await pool.query(
      `SELECT m.*, o.tipo AS order_tipo, o.created_at AS order_fecha
       FROM cc_movimientos m
       LEFT JOIN orders o ON o.id = m.order_id
       WHERE m.cuenta_corriente_id = $1
       ORDER BY m.created_at DESC`,
      [cuenta.rows[0].id]
    );

    return {
      ...cuenta.rows[0],
      movimientos: movimientos.rows,
    };
  }

  // ── Listar todas las cuentas ────────────────────────────────
  async getAll() {
    const res = await pool.query(`
      SELECT
        cc.*,
        c.name     AS customer_name,
        c.document AS customer_document,
        c.email    AS customer_email,
        c.phone    AS customer_phone
      FROM cuentas_corrientes cc
      JOIN customers c ON c.id = cc.customer_id
      ORDER BY c.name ASC
    `);
    return res.rows;
  }

  // ── Agregar movimiento y actualizar saldo ───────────────────
  async addMovimiento({ cuentaId, tipo, concepto, monto, orderId }, client) {
    const db = client || pool;

    // Insertar movimiento
    await db.query(
      `INSERT INTO cc_movimientos (cuenta_corriente_id, tipo, concepto, monto, order_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [cuentaId, tipo, concepto, monto, orderId || null]
    );

    // Actualizar saldo: débito suma, pago resta
    const delta = tipo === "debito" ? monto : -monto;
    const res = await db.query(
      `UPDATE cuentas_corrientes
       SET saldo = saldo + $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [delta, cuentaId]
    );
    return res.rows[0];
  }

  // ── Registrar pago ──────────────────────────────────────────
  async registrarPago(customerId, { monto, concepto }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const cuenta = await this.getOrCreate(customerId, client);

      if (monto > cuenta.saldo) {
        throw new Error(`El pago ($${monto}) supera el saldo ($${cuenta.saldo})`);
      }

      const updated = await this.addMovimiento({
        cuentaId: cuenta.id,
        tipo:     "pago",
        concepto: concepto || "Pago",
        monto,
        orderId:  null,
      }, client);

      await client.query("COMMIT");
      return updated;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
