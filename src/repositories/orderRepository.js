import pool from "../database/db.js";

export default class OrderRepository {

  async create(data, client) {
    const res = await client.query(
      `INSERT INTO orders
        (customer_id, user_id, total, profit, status,
         tipo, vendedor, price_type, texto_libre,
         origen, destino, supplier_id, warehouse_id, negocio_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        data.customer_id  || null,
        data.user_id      || null,
        data.total,
        data.profit,
        data.status,
        data.tipo         || null,
        data.vendedor     || null,
        data.price_type   || null,
        data.texto_libre  || null,
        data.origen       || null,
        data.destino      || null,
        data.supplier_id  || null,
        data.warehouse_id || null,
        data.negocio_id   || null,
      ]
    );
    return res.rows[0];
  }

  async getById(id) {
    const res = await pool.query(`
      SELECT
        o.*,
        c.name  AS customer_name,
        pr.name AS supplier_name,
        w.name  AS warehouse_name,

        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id',          oi.id,
                'product_id',  oi.product_id,
                'product_name',p.name,
                'product_code',p.code,
                'quantity',    oi.quantity,
                'unit_price',  oi.unit_price,
                'cost',        oi.cost
              )
            )
            FROM order_items oi
            JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = o.id
          ),
          '[]'
        ) AS items,

        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id',     pay.id,
                'method', pay.method,
                'amount', pay.amount
              )
            )
            FROM payments pay
            WHERE pay.order_id = o.id
          ),
          '[]'
        ) AS payments

      FROM orders o
      LEFT JOIN customers  c  ON c.id  = o.customer_id
      LEFT JOIN proveedores pr ON pr.id = o.supplier_id
      LEFT JOIN warehouses  w  ON w.id  = o.warehouse_id
      WHERE o.id = $1
    `, [id]);

    return res.rows[0];
  }

  async getAll({ from, to, warehouseId, tipo, negocioId } = {}) {
    let query = `
      SELECT
        o.*,
        c.name  AS customer_name,
        pr.name AS supplier_name,
        p.method AS payment_method
      FROM orders o
      LEFT JOIN customers  c  ON c.id  = o.customer_id
      LEFT JOIN proveedores pr ON pr.id = o.supplier_id
      LEFT JOIN payments    p  ON p.order_id = o.id
      WHERE 1=1
    `;
    const params = [];

    if (negocioId)   { params.push(negocioId);             query += ` AND o.negocio_id = $${params.length}`; }
    if (tipo)        { params.push(tipo);                   query += ` AND o.tipo = $${params.length}`; }
    if (from)        { params.push(`${from} 00:00:00`);    query += ` AND o.created_at >= $${params.length}`; }
    if (to)          { params.push(`${to} 23:59:59`);      query += ` AND o.created_at <= $${params.length}`; }
    if (warehouseId) { params.push(warehouseId);            query += ` AND o.warehouse_id = $${params.length}`; }

    query += ` ORDER BY o.created_at DESC`;

    const res = await pool.query(query, params);
    return res.rows;
  }

  async getAllByTipo(tipo, { from, to, warehouseName, negocioId } = {}) {
    let query = `
      SELECT o.*, c.name AS customer_name
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.tipo = $1
    `;
    const params = [tipo];

    if (negocioId)     { params.push(negocioId);             query += ` AND o.negocio_id = $${params.length}`; }
    if (from)          { params.push(`${from} 00:00:00`);    query += ` AND o.created_at >= $${params.length}`; }
    if (to)            { params.push(`${to} 23:59:59`);      query += ` AND o.created_at <= $${params.length}`; }
    if (warehouseName) { params.push(warehouseName);          query += ` AND (o.origen = $${params.length} OR o.destino = $${params.length})`; }

    query += ` ORDER BY o.created_at DESC`;
    const res = await pool.query(query, params);
    return res.rows;
  }

  async getLastSalePrice(customerId, productId) {
    const res = await pool.query(
      `SELECT oi.unit_price, o.created_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.customer_id = $1
         AND oi.product_id = $2
         AND o.tipo IN ('Presupuesto', 'Presupuesto Web')
         AND o.status = 'completed'
       ORDER BY o.created_at DESC
       LIMIT 1`,
      [customerId, productId]
    );
    return res.rows[0] || null;
  }
}
