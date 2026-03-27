import pool from "../database/db.js"

export default class OrderRepository {
async create(data, client) {
  const res = await client.query(
    `INSERT INTO orders
      (customer_id, user_id, total, profit, status,
       tipo, vendedor, price_type, texto_libre, escenario,
       origen, destino)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      data.customer_id,
      data.user_id,
      data.total,
      data.profit,
      data.status,
      data.tipo        || null,
      data.vendedor    || null,
      data.price_type  || null,
      data.texto_libre || null,
      data.escenario   || null,
      data.origen      || null,
      data.destino     || null,
    ]
  );
  return res.rows[0];
}

async getById(id) {
  const res = await pool.query(`
    SELECT
      o.*,
      c.name AS customer_name,

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
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.id = $1
  `, [id]);

  return res.rows[0];
}

  async getAll({ from, to }) {
  let query = `
    SELECT
      o.*,
      c.name AS customer_name
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE 1=1
  `;
  let params = [];

  if (from) {
    params.push(`${from} 00:00:00`);
    query += ` AND o.created_at >= $${params.length}`;
  }
  if (to) {
    params.push(`${to} 23:59:59`);
    query += ` AND o.created_at <= $${params.length}`;
  }

  query += ` ORDER BY o.created_at DESC`;

  const res = await pool.query(query, params);
  return res.rows;
}
}