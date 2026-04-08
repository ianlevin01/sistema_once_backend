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

  // ── Acreditar saldo a favor cuando se genera una Reposicion ──
  // (llamado desde comprobanteService dentro de una transacción)
  async acreditarReposicion(proveedorId, { monto, orderId }, client) {
    const db = client || pool;
    const cc = await this.getOrCreateCC(proveedorId, db);

    // Suma saldo a favor (saldo negativo = proveedor nos debe; saldo positivo = le debemos)
    await db.query(
      `UPDATE cuentas_corrientes_prov
       SET saldo = saldo + $1, updated_at = now()
       WHERE id = $2`,
      [monto, cc.id]
    );

    await db.query(
      `INSERT INTO cc_movimientos_prov
         (cuenta_corriente_id, tipo, concepto, monto, order_id)
       VALUES ($1, 'credito', $2, $3, $4)`,
      [cc.id, `Reposición — ${orderId.slice(0, 8)}`, monto, orderId]
    );

    return cc;
  }

  // ── Registrar pago al proveedor (le pagamos lo que le debemos) ──
  // Reduce el saldo a favor del proveedor
  async registrarPago(proveedorId, { monto, concepto }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const cc = await this.getOrCreateCC(proveedorId, client);

      if (cc.saldo < monto) {
        throw new Error("El monto supera el saldo a favor del proveedor");
      }

      await client.query(
        `UPDATE cuentas_corrientes_prov
         SET saldo = saldo - $1, updated_at = now()
         WHERE id = $2`,
        [monto, cc.id]
      );

      await client.query(
        `INSERT INTO cc_movimientos_prov
           (cuenta_corriente_id, tipo, concepto, monto)
         VALUES ($1, 'debito', $2, $3)`,
        [cc.id, concepto || "Pago a proveedor", monto]
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

  // ── Registrar cobranza del proveedor (nos devuelve dinero) ──
  // Reduce el saldo a favor del proveedor (igual que pago, semántica diferente)
  async registrarCobranza(proveedorId, { monto, concepto, metodo_pago }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const cc = await this.getOrCreateCC(proveedorId, client);

      await client.query(
        `UPDATE cuentas_corrientes_prov
         SET saldo = saldo - $1, updated_at = now()
         WHERE id = $2`,
        [monto, cc.id]
      );

      await client.query(
        `INSERT INTO cc_movimientos_prov
           (cuenta_corriente_id, tipo, concepto, monto, metodo_pago)
         VALUES ($1, 'debito', $2, $3, $4)`,
        [cc.id, concepto || "Cobranza proveedor", monto, metodo_pago || null]
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
