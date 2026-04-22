import pool from "../database/db.js";

// ─────────────────────────────────────────────────────────────
// Helper: obtiene cotización del dólar desde price_config
// ─────────────────────────────────────────────────────────────
async function getCotizacion(client, negocioId) {
  const db = client || pool;
  const res = await db.query(
    `SELECT cotizacion_dolar FROM price_config WHERE negocio_id = $1 LIMIT 1`,
    [negocioId]
  );
  return Number(res.rows[0]?.cotizacion_dolar ?? 1000);
}

function convertir(monto, divisaOrigen, divisaDestino, cotizacion) {
  if (divisaOrigen === divisaDestino) return monto;
  if (divisaOrigen === "ARS" && divisaDestino === "USD") return monto / cotizacion;
  if (divisaOrigen === "USD" && divisaDestino === "ARS") return monto * cotizacion;
  return monto;
}

// ─────────────────────────────────────────────────────────────

export default class ProveedorRepository {
  async search(query, negocioId) {
    const res = await pool.query(
      `SELECT id, name, document, phone, email, domicilio, localidad,
              condicion_iva, codigo, contacto, divisa
       FROM proveedores
       WHERE (name ILIKE $1 OR document ILIKE $1 OR codigo ILIKE $1)
         AND negocio_id = $2
       ORDER BY name
       LIMIT 20`,
      [`%${query}%`, negocioId]
    );
    return res.rows;
  }

  async getAll(negocioId) {
    const res = await pool.query(
      `SELECT * FROM proveedores WHERE negocio_id = $1 ORDER BY name`,
      [negocioId]
    );
    return res.rows;
  }

  async getById(id) {
    const res = await pool.query(`SELECT * FROM proveedores WHERE id = $1`, [id]);
    return res.rows[0] || null;
  }

  async create(data) {
    const res = await pool.query(
      `INSERT INTO proveedores
        (name, type, document, phone, email, domicilio, localidad,
         provincia, codigo_postal, contacto, descuento, dias_plazo,
         transporte, condicion_iva, vendedor, cuenta_pesos, cuenta_dolares,
         codigo, divisa, negocio_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [
        data.name,            data.type          || null,
        data.document         || null,            data.phone         || null,
        data.email            || null,            data.domicilio     || null,
        data.localidad        || null,            data.provincia     || null,
        data.codigo_postal    || null,            data.contacto      || null,
        data.descuento        || null,            data.dias_plazo    || null,
        data.transporte       || null,            data.condicion_iva || null,
        data.vendedor         || null,            data.cuenta_pesos  || null,
        data.cuenta_dolares   || null,            data.codigo        || null,
        data.divisa           || "ARS",           data.negocio_id,
      ]
    );
    return res.rows[0];
  }

  async update(id, data) {
    const fields = [];
    const values = [];
    let i = 1;
    const allowed = [
      "name", "type", "document", "phone", "email", "domicilio", "localidad",
      "provincia", "codigo_postal", "contacto", "descuento", "dias_plazo",
      "transporte", "condicion_iva", "vendedor", "cuenta_pesos", "cuenta_dolares",
      "codigo", "divisa",
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

    const provRes = await db.query(
      `SELECT divisa FROM proveedores WHERE id = $1`, [proveedorId]
    );
    const divisa = provRes.rows[0]?.divisa ?? "ARS";

    const created = await db.query(
      `INSERT INTO cuentas_corrientes_prov (proveedor_id, divisa)
       VALUES ($1, $2) RETURNING *`,
      [proveedorId, divisa]
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

  // ── Acreditar saldo al proveedor por reposición ───────────────
  async acreditarReposicion(proveedorId, { monto, orderId, negocio_id }, client) {
    const db = client || pool;

    const cotizacion = await getCotizacion(db, negocio_id);
    const cc         = await this.getOrCreateCC(proveedorId, db);
    const divisa     = cc.divisa ?? "ARS";

    const montoEnCuenta = convertir(monto, "ARS", divisa, cotizacion);

    await db.query(
      `UPDATE cuentas_corrientes_prov
       SET saldo = saldo + $1, updated_at = now()
       WHERE id = $2`,
      [montoEnCuenta, cc.id]
    );

    await db.query(
      `INSERT INTO cc_movimientos_prov
         (cuenta_corriente_id, tipo, concepto, monto, order_id,
          divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada)
       VALUES ($1, 'pago', $2, $3, $4, $5, $6, $7, $8)`,
      [
        cc.id,
        `Reposición — ${orderId.slice(0, 8)}`,
        montoEnCuenta,
        orderId,
        divisa,
        "ARS",
        monto,
        divisa === "USD" ? cotizacion : null,
      ]
    );

    return cc;
  }

  // ── Registrar pago al proveedor (le pagamos lo que le debemos) ─
  async registrarPago(proveedorId, { monto, concepto, metodo_pago, divisa_cobro, cotizacion_manual, negocio_id, warehouse_id }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const cotizacion  = cotizacion_manual != null ? cotizacion_manual : await getCotizacion(client, negocio_id);
      const cc          = await this.getOrCreateCC(proveedorId, client);
      const divisa      = cc.divisa ?? "ARS";
      const divisaCobro = divisa_cobro ?? divisa;

      const montoEnCuenta = convertir(monto, divisaCobro, divisa, cotizacion);

      if (cc.saldo < montoEnCuenta) {
        throw new Error("El monto supera el saldo a favor del proveedor");
      }

      await client.query(
        `UPDATE cuentas_corrientes_prov
         SET saldo = saldo - $1, updated_at = now()
         WHERE id = $2`,
        [montoEnCuenta, cc.id]
      );

      await client.query(
        `INSERT INTO cc_movimientos_prov
           (cuenta_corriente_id, tipo, concepto, monto, metodo_pago,
            divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada)
         VALUES ($1,'debito',$2,$3,$4,$5,$6,$7,$8)`,
        [
          cc.id,
          concepto || "Pago a proveedor",
          montoEnCuenta,
          metodo_pago || null,
          divisa,
          divisaCobro,
          monto,
          divisaCobro !== divisa ? cotizacion : null,
        ]
      );

      // Registrar en cash_movements (siempre en ARS)
      const montoARS = convertir(monto, divisaCobro, "ARS", cotizacion);
      await client.query(
        `INSERT INTO cash_movements (type, source, amount, reference_id, negocio_id, warehouse_id)
         VALUES ('egreso', $1, $2, $3, $4, $5)`,
        [metodo_pago || "Efectivo", montoARS, cc.id, negocio_id, warehouse_id || null]
      );

      await client.query("COMMIT");
      return { ok: true };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Registrar cobranza del proveedor (nos devuelve dinero) ─────
  async registrarCobranza(proveedorId, { monto, concepto, metodo_pago, divisa_cobro, cotizacion_manual, negocio_id }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const cotizacion  = cotizacion_manual != null ? cotizacion_manual : await getCotizacion(client, negocio_id);
      const cc          = await this.getOrCreateCC(proveedorId, client);
      const divisa      = cc.divisa ?? "ARS";
      const divisaCobro = divisa_cobro ?? divisa;

      const montoEnCuenta = convertir(monto, divisaCobro, divisa, cotizacion);

      await client.query(
        `UPDATE cuentas_corrientes_prov
         SET saldo = saldo - $1, updated_at = now()
         WHERE id = $2`,
        [montoEnCuenta, cc.id]
      );

      await client.query(
        `INSERT INTO cc_movimientos_prov
           (cuenta_corriente_id, tipo, concepto, monto, metodo_pago,
            divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada)
         VALUES ($1,'debito',$2,$3,$4,$5,$6,$7,$8)`,
        [
          cc.id,
          concepto || "Cobranza proveedor",
          montoEnCuenta,
          metodo_pago || null,
          divisa,
          divisaCobro,
          monto,
          divisaCobro !== divisa ? cotizacion : null,
        ]
      );

      await client.query("COMMIT");
      return { ok: true };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
