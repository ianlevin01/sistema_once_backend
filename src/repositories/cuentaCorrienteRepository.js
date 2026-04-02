import pool from "../database/db.js";

// Métodos de pago que se consideran en dólares
const METODOS_USD = ["cheque usd", "transferencia usd", "dólares", "dolares", "usd"];

const currencyFromConcepto = (concepto) =>
  METODOS_USD.some((m) => concepto?.toLowerCase().includes(m)) ? "USD" : "ARS";

export default class CuentaCorrienteRepository {

  // ── Obtener o crear cuenta corriente de un cliente ─────────
  async getOrCreate(customerId, client) {
    const db = client || pool;

    const existing = await db.query(
      `SELECT * FROM cuentas_corrientes WHERE customer_id = $1`,
      [customerId]
    );
    if (existing.rows[0]) return existing.rows[0];

    const res = await db.query(
      `INSERT INTO cuentas_corrientes (customer_id, saldo)
       VALUES ($1, 0)
       RETURNING *`,
      [customerId]
    );
    return res.rows[0];
  }

  // ── Obtener cuenta con movimientos de un cliente ───────────
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

  // ── Listar todas las cuentas con saldos ARS/USD y fechas ───
  async getAll() {
    const cuentas = await pool.query(`
      SELECT
        cc.id,
        cc.customer_id,
        cc.saldo,
        cc.created_at,
        cc.updated_at,
        c.name     AS customer_name,
        c.document AS customer_document,
        c.email    AS customer_email,
        c.phone    AS customer_phone
      FROM cuentas_corrientes cc
      JOIN customers c ON c.id = cc.customer_id
      ORDER BY c.name ASC
    `);

    const result = await Promise.all(
      cuentas.rows.map(async (cc) => {
        const movs = await pool.query(
          `SELECT tipo, monto, concepto, created_at
           FROM cc_movimientos
           WHERE cuenta_corriente_id = $1
           ORDER BY created_at DESC`,
          [cc.id]
        );

        let saldoARS    = 0;
        let saldoUSD    = 0;
        let ultimoDebito = null;
        let ultimoPago   = null;

        for (const m of movs.rows) {
          const currency = currencyFromConcepto(m.concepto);
          const monto    = Number(m.monto);

          if (currency === "USD") {
            saldoUSD += m.tipo === "debito" ? monto : -monto;
          } else {
            saldoARS += m.tipo === "debito" ? monto : -monto;
          }

          if (m.tipo === "debito" && !ultimoDebito) ultimoDebito = m.created_at;
          if (m.tipo === "pago"   && !ultimoPago)   ultimoPago   = m.created_at;
        }

        return {
          ...cc,
          saldo_ars:     saldoARS,
          saldo_usd:     saldoUSD,
          ultimo_debito: ultimoDebito,
          ultimo_pago:   ultimoPago,
        };
      })
    );

    return result;
  }

  // ── Agregar movimiento y actualizar saldo ───────────────────
  async addMovimiento({ cuentaId, tipo, concepto, monto, orderId }, client) {
    const db = client || pool;

    await db.query(
      `INSERT INTO cc_movimientos (cuenta_corriente_id, tipo, concepto, monto, order_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [cuentaId, tipo, concepto, monto, orderId || null]
    );

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

  // ── Registrar pago de deuda ─────────────────────────────────
  async registrarPago(customerId, { monto, concepto }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cuenta = await this.getOrCreate(customerId, client);
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

  // ── Agregar saldo a favor (crédito manual) ──────────────────
  async agregarSaldo(customerId, { monto, concepto }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cuenta = await this.getOrCreate(customerId, client);
      const updated = await this.addMovimiento({
        cuentaId: cuenta.id,
        tipo:     "pago",
        concepto: concepto || "Saldo a favor",
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

  // ── Registrar cobranza (CC + cash_movements) ────────────────
  async registrarCobranza(customerId, { monto, concepto, metodo_pago }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Obtener datos del cliente para guardar el nombre en cash_movements
      const custRes = await client.query(
        `SELECT name FROM customers WHERE id = $1`, [customerId]
      );
      const customerName = custRes.rows[0]?.name || "";

      // 2. Crear o recuperar la cuenta corriente
      const cuenta = await this.getOrCreate(customerId, client);

      // 3. Insertar movimiento en cc_movimientos (con metodo_pago)
      await client.query(
        `INSERT INTO cc_movimientos (cuenta_corriente_id, tipo, concepto, monto, metodo_pago)
         VALUES ($1, 'pago', $2, $3, $4)`,
        [cuenta.id, concepto || "Cobranza", monto, metodo_pago]
      );

      // 4. Actualizar saldo de la cuenta corriente
      const updated = await client.query(
        `UPDATE cuentas_corrientes
         SET saldo = saldo - $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [monto, cuenta.id]
      );

      // 5. Registrar en cash_movements como ingreso
      await client.query(
        `INSERT INTO cash_movements (type, source, amount, reference_id)
         VALUES ('ingreso', $1, $2, $3)`,
        [metodo_pago, monto, cuenta.id]
      );

      await client.query("COMMIT");
      return updated.rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Obtener cobranzas por rango de fecha ────────────────────
  async getCobranzas(from, to) {
    const params = [];
    let where = `WHERE m.tipo = 'pago' AND m.metodo_pago IS NOT NULL`;

    if (from) {
      params.push(from);
      where += ` AND m.created_at::date >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      where += ` AND m.created_at::date <= $${params.length}`;
    }

    const res = await pool.query(`
      SELECT
        m.id,
        m.created_at,
        m.monto,
        m.concepto,
        m.metodo_pago,
        m.order_id,
        c.name    AS customer_name,
        c.id      AS customer_id,
        o.tipo    AS order_tipo
      FROM cc_movimientos m
      JOIN cuentas_corrientes cc ON cc.id = m.cuenta_corriente_id
      JOIN customers c ON c.id = cc.customer_id
      LEFT JOIN orders o ON o.id = m.order_id
      ${where}
      ORDER BY m.created_at DESC
    `, params);

    return res.rows;
  }
}
