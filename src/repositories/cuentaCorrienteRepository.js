import pool from "../database/db.js";

// ─────────────────────────────────────────────────────────────
// Helpers de conversión
// ─────────────────────────────────────────────────────────────

/**
 * Lee la cotización del dólar desde price_config.
 * Siempre toma la última fila.
 */
async function getCotizacion(client) {
  const db = client || pool;
  const res = await db.query(
    `SELECT cotizacion_dolar FROM price_config ORDER BY updated_at DESC LIMIT 1`
  );
  return Number(res.rows[0]?.cotizacion_dolar ?? 1000);
}

/**
 * Convierte un monto desde divisa origen a divisa destino.
 * @param {number} monto          - monto en divisa origen
 * @param {string} divisaOrigen   - 'ARS' | 'USD'
 * @param {string} divisaDestino  - 'ARS' | 'USD'
 * @param {number} cotizacion     - precio del dólar en ARS
 * @returns {number}              - monto convertido
 */
function convertir(monto, divisaOrigen, divisaDestino, cotizacion) {
  if (divisaOrigen === divisaDestino) return monto;
  if (divisaOrigen === "ARS" && divisaDestino === "USD") return monto / cotizacion;
  if (divisaOrigen === "USD" && divisaDestino === "ARS") return monto * cotizacion;
  return monto;
}

// ─────────────────────────────────────────────────────────────

export default class CuentaCorrienteRepository {

  // ── Obtener cuenta corriente (sin auto-crear) ─────────────
  async getOrCreate(customerId, client) {
    const db = client || pool;
    const existing = await db.query(
      `SELECT cc.*, c.divisa AS customer_divisa
       FROM cuentas_corrientes cc
       JOIN customers c ON c.id = cc.customer_id
       WHERE cc.customer_id = $1`,
      [customerId]
    );
    return existing.rows[0] || null;
  }

  // ── Abrir cuenta corriente explícitamente ─────────────────
  async createCC(customerId, client) {
    const db = client || pool;
    const existing = await db.query(
      `SELECT * FROM cuentas_corrientes WHERE customer_id = $1`, [customerId]
    );
    if (existing.rows[0]) return existing.rows[0];

    const custRes = await db.query(
      `SELECT divisa FROM customers WHERE id = $1`, [customerId]
    );
    if (!custRes.rows[0]) throw new Error("Cliente no encontrado");
    const divisa = custRes.rows[0]?.divisa ?? "ARS";

    const res = await db.query(
      `INSERT INTO cuentas_corrientes (customer_id, saldo, divisa)
       VALUES ($1, 0, $2) RETURNING *`,
      [customerId, divisa]
    );
    return res.rows[0];
  }

  // ── Obtener cuenta con movimientos de un cliente ───────────
  async getByCustomer(customerId) {
    const cuenta = await pool.query(
      `SELECT cc.*, c.name AS customer_name, c.document, c.email, c.phone, c.divisa AS customer_divisa
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

  // ── Listar todas las cuentas con saldos y fechas ──────────
  async getAll() {
    const res = await pool.query(`
      SELECT
        cc.id,
        cc.customer_id,
        cc.saldo,
        cc.divisa,
        cc.created_at,
        cc.updated_at,
        c.name     AS customer_name,
        c.document AS customer_document,
        c.email    AS customer_email,
        c.phone    AS customer_phone,
        (
          SELECT MAX(m.created_at) FROM cc_movimientos m
          WHERE m.cuenta_corriente_id = cc.id AND m.tipo = 'debito'
        ) AS ultimo_debito,
        (
          SELECT MAX(m.created_at) FROM cc_movimientos m
          WHERE m.cuenta_corriente_id = cc.id AND m.tipo = 'pago'
        ) AS ultimo_pago
      FROM cuentas_corrientes cc
      JOIN customers c ON c.id = cc.customer_id
      ORDER BY c.name ASC
    `);
    return res.rows;
  }

  // ── Agregar movimiento y actualizar saldo ──────────────────
  // monto: ya convertido a la divisa de la cuenta
  // montoOriginal + divisaCobro + cotizacion: para auditoría
  async addMovimiento({
    cuentaId,
    tipo,
    concepto,
    monto,
    orderId,
    metodo_pago,
    divisa_cuenta,
    divisa_cobro,
    monto_original,
    cotizacion_usada,
  }, client) {
    const db = client || pool;

    await db.query(
      `INSERT INTO cc_movimientos
         (cuenta_corriente_id, tipo, concepto, monto, order_id, metodo_pago,
          divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        cuentaId,
        tipo,
        concepto,
        monto,
        orderId   || null,
        metodo_pago || null,
        divisa_cuenta  || "ARS",
        divisa_cobro   || divisa_cuenta || "ARS",
        monto_original ?? monto,
        cotizacion_usada ?? null,
      ]
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

  // ── Débito por comprobante (desde ComprobanteService) ──────
  // Convierte el total del comprobante (siempre en ARS) a la divisa de la cuenta
  async debitarPorComprobante(customerId, { total, orderId, concepto }, client) {
    const db = client || pool;

    const cotizacion = await getCotizacion(db);
    const cuenta     = await this.getOrCreate(customerId, db);
    if (!cuenta) return null; // cliente web: sin CC
    const divisa     = cuenta.divisa ?? "ARS";

    const montoEnCuenta = convertir(total, "ARS", divisa, cotizacion);

    return this.addMovimiento({
      cuentaId:        cuenta.id,
      tipo:            "debito",
      concepto:        concepto || `Comprobante — ${orderId?.slice(0, 8)}`,
      monto:           montoEnCuenta,
      orderId,
      divisa_cuenta:   divisa,
      divisa_cobro:    "ARS",           // el comprobante siempre se genera en ARS
      monto_original:  total,
      cotizacion_usada: divisa === "USD" ? cotizacion : null,
    }, db);
  }

  // ── Registrar pago manual (legacy) ─────────────────────────
  async registrarPago(customerId, { monto, concepto }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cuenta = await this.getOrCreate(customerId, client);
      if (!cuenta) throw new Error("Este cliente no tiene cuenta corriente");
      const updated = await this.addMovimiento({
        cuentaId:      cuenta.id,
        tipo:          "pago",
        concepto:      concepto || "Pago",
        monto,
        divisa_cuenta: cuenta.divisa ?? "ARS",
        divisa_cobro:  cuenta.divisa ?? "ARS",
        monto_original: monto,
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

  // ── Agregar saldo a favor (crédito manual, legacy) ─────────
  async agregarSaldo(customerId, { monto, concepto }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cuenta = await this.getOrCreate(customerId, client);
      const updated = await this.addMovimiento({
        cuentaId:      cuenta.id,
        tipo:          "pago",
        concepto:      concepto || "Saldo a favor",
        monto,
        divisa_cuenta: cuenta.divisa ?? "ARS",
        divisa_cobro:  cuenta.divisa ?? "ARS",
        monto_original: monto,
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

  // ── Registrar cobranza (CC + cash_movements) ───────────────
  // monto        = lo que el cliente pagó, en divisa_cobro
  // divisa_cobro = en qué moneda trajo la plata ('ARS' | 'USD')
  // La cuenta se acredita en su propia divisa (con conversión si hace falta)
  async registrarCobranza(customerId, { monto, concepto, metodo_pago, divisa_cobro, cotizacion_manual }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const cotizacion = cotizacion_manual != null ? cotizacion_manual : await getCotizacion(client);

      const custRes = await client.query(
        `SELECT name FROM customers WHERE id = $1`, [customerId]
      );
      const customerName = custRes.rows[0]?.name || "";

      const cuenta  = await this.getOrCreate(customerId, client);
      if (!cuenta) throw new Error("Este cliente no tiene cuenta corriente");
      const divisa  = cuenta.divisa ?? "ARS";
      const divisaCobro = divisa_cobro ?? divisa;

      // Convertir el monto cobrado a la divisa de la cuenta
      const montoEnCuenta = convertir(monto, divisaCobro, divisa, cotizacion);

      // Movimiento en CC
      await client.query(
        `INSERT INTO cc_movimientos
           (cuenta_corriente_id, tipo, concepto, monto, metodo_pago,
            divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada)
         VALUES ($1,'pago',$2,$3,$4,$5,$6,$7,$8)`,
        [
          cuenta.id,
          concepto || "Cobranza",
          montoEnCuenta,
          metodo_pago,
          divisa,
          divisaCobro,
          monto,
          divisaCobro !== divisa ? cotizacion : null,
        ]
      );

      // Actualizar saldo
      await client.query(
        `UPDATE cuentas_corrientes
         SET saldo = saldo - $1, updated_at = NOW()
         WHERE id = $2`,
        [montoEnCuenta, cuenta.id]
      );

      // cash_movements: registrar en la divisa real que entró a caja
      // amount en ARS siempre (para que la caja sume en una sola moneda)
      const montoARS = convertir(monto, divisaCobro, "ARS", cotizacion);
      await client.query(
        `INSERT INTO cash_movements (type, source, amount, reference_id)
         VALUES ('ingreso', $1, $2, $3)`,
        [metodo_pago, montoARS, cuenta.id]
      );

      await client.query("COMMIT");

      const updated = await pool.query(
        `SELECT * FROM cuentas_corrientes WHERE id = $1`, [cuenta.id]
      );
      return updated.rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Obtener cobranzas por rango de fecha ───────────────────
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
        m.divisa_cuenta,
        m.divisa_cobro,
        m.monto_original,
        m.cotizacion_usada,
        c.name  AS customer_name,
        c.id    AS customer_id,
        o.tipo  AS order_tipo
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
