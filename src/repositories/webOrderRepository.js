import pool from "../database/db.js";

export default class WebOrderRepository {

  // ── SELECT completo con items y datos del cliente ──────────
  async getById(id) {
    const res = await pool.query(`
      SELECT
        w.*,
        COALESCE(c.name,  w.customer_name)  AS customer_name,
        COALESCE(c.email, w.customer_email) AS customer_email,
        COALESCE(c.phone, w.customer_phone) AS customer_phone,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id',         wi.id,
                'product_id', wi.product_id,
                'code',       wi.code,
                'name',       wi.name,
                'quantity',   wi.quantity,
                'unit_price', wi.unit_price
              ) ORDER BY wi.name
            )
            FROM web_order_items wi
            WHERE wi.web_order_id = w.id
          ), '[]'
        ) AS items
      FROM web_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      WHERE w.id = $1
    `, [id]);
    return res.rows[0];
  }

  // ── LISTADO con filtros ────────────────────────────────────
  async getAll({ from, to, color, reservado, search }) {
    let query = `
      SELECT
        w.*,
        COALESCE(c.name,  w.customer_name)  AS customer_name,
        COALESCE(c.email, w.customer_email) AS customer_email,
        COALESCE(c.phone, w.customer_phone) AS customer_phone,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id',         wi.id,
                'product_id', wi.product_id,
                'code',       wi.code,
                'name',       wi.name,
                'quantity',   wi.quantity,
                'unit_price', wi.unit_price
              ) ORDER BY wi.name
            )
            FROM web_order_items wi
            WHERE wi.web_order_id = w.id
          ), '[]'
        ) AS items
      FROM web_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      WHERE 1=1
    `;
    const params = [];

    if (from) {
      params.push(from);
      query += ` AND w.created_at >= $${params.length}`;
    }
    if (to) {
      params.push(to + ' 23:59:59');
      query += ` AND w.created_at <= $${params.length}`;
    }
    if (color) {
      params.push(color);
      query += ` AND w.color = $${params.length}`;
    }
    if (reservado !== undefined) {
      params.push(reservado);
      query += ` AND w.reservado = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (c.name ILIKE $${params.length} OR c.email ILIKE $${params.length})`;
    }

    query += ` ORDER BY w.created_at DESC`;

    const res = await pool.query(query, params);
    return res.rows;
  }

  // ── CREATE ─────────────────────────────────────────────────
  async create(data, client) {
    const db = client || pool;
    const res = await db.query(`
      INSERT INTO web_orders
        (customer_id, customer_name, customer_email, customer_phone, observaciones, total, color)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      data.customer_id    || null,
      data.customer_name  || null,
      data.customer_email || null,
      data.customer_phone || null,
      data.observaciones  || null,
      data.total          || 0,
      data.color          || 'pending',
    ]);
    return res.rows[0];
  }

  // ── UPDATE completo ────────────────────────────────────────
  async update(id, data, client) {
    const db = client || pool;
    const res = await db.query(`
      UPDATE web_orders SET
        customer_id   = COALESCE($1, customer_id),
        observaciones = COALESCE($2, observaciones),
        total         = COALESCE($3, total),
        color         = COALESCE($4, color),
        reservado     = COALESCE($5, reservado),
        order_id      = COALESCE($6, order_id),
        updated_at    = NOW()
      WHERE id = $7
      RETURNING *
    `, [
      data.customer_id  || null,
      data.observaciones || null,
      data.total         ?? null,
      data.color         || null,
      data.reservado     ?? null,
      data.order_id      || null,
      id,
    ]);
    return res.rows[0];
  }

  // ── PATCH color ────────────────────────────────────────────
  async setColor(id, color) {
    const res = await pool.query(
      `UPDATE web_orders SET color = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [color, id]
    );
    return res.rows[0];
  }

  // ── PATCH reservado ────────────────────────────────────────
  async setReservado(id, reservado) {
    const res = await pool.query(
      `UPDATE web_orders SET reservado = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [reservado, id]
    );
    return res.rows[0];
  }

  // ── DELETE ─────────────────────────────────────────────────
  async delete(id) {
    await pool.query(`DELETE FROM web_orders WHERE id = $1`, [id]);
  }

  // ── ITEMS: reemplazar todos ────────────────────────────────
  async replaceItems(webOrderId, items, client) {
    const db = client || pool;
    await db.query(`DELETE FROM web_order_items WHERE web_order_id = $1`, [webOrderId]);
    for (const item of items) {
      await db.query(`
        INSERT INTO web_order_items (web_order_id, product_id, code, name, quantity, unit_price)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [
        webOrderId,
        item.product_id || null,
        item.code       || null,
        item.name,
        item.quantity,
        item.unit_price || 0,
      ]);
    }
  }

  // ── Crear customer nuevo ───────────────────────────────────
  async createCustomer(data, client) {
    const db = client || pool;
    const res = await db.query(
      `INSERT INTO customers (name, email, phone, type)
       VALUES ($1, $2, $3, 'web')
       RETURNING *`,
      [data.name, data.email || null, data.phone || null]
    );
    return res.rows[0];
  }
}
