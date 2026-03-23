import pool from "../database/db.js"

export default class ProductRepository {
  async search(name) {
    const res = await pool.query(
      "SELECT * FROM products WHERE name ILIKE $1",
      [`%${name || ""}%`]
    );
    return res.rows;
  }

async getById(id) {
  const res = await pool.query(`
    SELECT
      p.*,
      c.name AS category_name,

      -- Precios como array JSON
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id',         pp.id,
              'price_type', pp.price_type,
              'currency',   pp.currency,
              'price',      pp.price
            ) ORDER BY pp.price_type
          )
          FROM product_prices pp
          WHERE pp.product_id = p.id
        ),
        '[]'
      ) AS prices,

      -- Stock por depósito como array JSON
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'warehouse_id',   s.warehouse_id,
              'warehouse_name', w.name,
              'quantity',       s.quantity
            ) ORDER BY w.name
          )
          FROM stock s
          JOIN warehouses w ON w.id = s.warehouse_id
          WHERE s.product_id = p.id
        ),
        '[]'
      ) AS stock,

      -- Historial de costos como array JSON
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'cost',       pc.cost,
              'created_at', pc.created_at
            ) ORDER BY pc.created_at DESC
          )
          FROM product_costs pc
          WHERE pc.product_id = p.id
        ),
        '[]'
      ) AS costs

    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = $1
  `, [id]);

  return res.rows[0];
}

  async create(p) {
    const res = await pool.query(
      `INSERT INTO products (name, code, description, category_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [p.name, p.code, p.description, p.category_id]
    );
    return res.rows[0];
  }

  async update(id, p) {
    const res = await pool.query(
      `UPDATE products SET name=$1, description=$2 WHERE id=$3 RETURNING *`,
      [p.name, p.description, id]
    );
    return res.rows[0];
  }

  async delete(id) {
    await pool.query("DELETE FROM products WHERE id=$1", [id]);
  }
}