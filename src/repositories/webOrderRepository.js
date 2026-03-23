import pool from "../database/db.js";

export default class WebOrderRepository {

  // ── SELECT completo con items ──────────────────────────────
  async getById(id) {
    const res = await pool.query(`
      SELECT
        w.*,
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
      WHERE w.id = $1
    `, [id]);
    return res.rows[0];
  }

  // ── LISTADO con filtros ────────────────────────────────────
  async getAll({ from, to, color, reservado, search }) {
    let query = `
      SELECT
        w.*,
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
      query += ` AND (w.customer_name ILIKE $${params.length} OR w.customer_city ILIKE $${params.length})`;
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
        (customer_name, customer_email, customer_phone, customer_city, observaciones, total, color)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [
      data.customer_name,
      data.customer_email  || null,
      data.customer_phone  || null,
      data.customer_city   || null,
      data.observaciones   || null,
      data.total           || 0,
      data.color           || 'pending',
    ]);
    return res.rows[0];
  }

  // ── UPDATE completo ────────────────────────────────────────
  async update(id, data, client) {
    const db = client || pool;
    const res = await db.query(`
      UPDATE web_orders SET
        customer_name  = COALESCE($1, customer_name),
        customer_email = COALESCE($2, customer_email),
        customer_phone = COALESCE($3, customer_phone),
        customer_city  = COALESCE($4, customer_city),
        observaciones  = COALESCE($5, observaciones),
        total          = COALESCE($6, total),
        color          = COALESCE($7, color),
        reservado      = COALESCE($8, reservado),
        order_id       = COALESCE($9, order_id),
        updated_at     = NOW()
      WHERE id = $10
      RETURNING *
    `, [
      data.customer_name  || null,
      data.customer_email || null,
      data.customer_phone || null,
      data.customer_city  || null,
      data.observaciones  || null,
      data.total          ?? null,
      data.color          || null,
      data.reservado      ?? null,
      data.order_id       || null,
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
}
