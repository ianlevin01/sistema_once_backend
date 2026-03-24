import pool from "../database/db.js"

export default class ProductRepository {
  async search(name) {
    const res = await pool.query(
      "SELECT * FROM products WHERE name ILIKE $1",
      [`%${name || ""}%`]
    );
    return res.rows;
  }

async getPaginated(limit = 30, offset = 0) {
  const res = await pool.query(`
    SELECT 
      p.*,

      COALESCE(
        json_agg(
          json_build_object(
            'id', pi.id,
            'key', pi.key
          )
        ) FILTER (WHERE pi.id IS NOT NULL),
        '[]'
      ) AS images

    FROM products p
    LEFT JOIN product_images pi ON pi.product_id = p.id

    GROUP BY p.id
    ORDER BY p.created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  return res.rows;
}

async getById(id) {
  const res = await pool.query(`
    SELECT
      p.*,
      c.name AS category_name,

      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', pi.id,
              'key', pi.key
            ) ORDER BY pi.created_at
          )
          FROM product_images pi
          WHERE pi.product_id = p.id
        ),
        '[]'
      ) AS images,

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
    `INSERT INTO products (
      name,
      code,
      barcode,
      box_code,
      description,
      category_id,
      active,
      tasa_iva,
      despacho,
      aduana,
      origen,
      qxb,
      punto_pedido,
      video_url
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
    )
    RETURNING *`,
    [
      p.name,
      p.code,
      p.barcode,
      p.box_code,
      p.description,
      p.category_id,
      p.active ?? true,
      p.tasa_iva,
      p.despacho,
      p.aduana,
      p.origen,
      p.qxb,
      p.punto_pedido,
      p.video_url
    ]
  );

  return res.rows[0];
}

async update(id, p) {
  const res = await pool.query(
    `UPDATE products SET
      name=$1,
      code=$2,
      barcode=$3,
      box_code=$4,
      description=$5,
      category_id=$6,
      active=$7,
      tasa_iva=$8,
      despacho=$9,
      aduana=$10,
      origen=$11,
      qxb=$12,
      punto_pedido=$13,
      video_url=$14
    WHERE id=$15
    RETURNING *`,
    [
      p.name,
      p.code,
      p.barcode,
      p.box_code,
      p.description,
      p.category_id,
      p.active,
      p.tasa_iva,
      p.despacho,
      p.aduana,
      p.origen,
      p.qxb,
      p.punto_pedido,
      p.video_url,
      id
    ]
  );

  return res.rows[0];
}

  async delete(id) {
    await pool.query("DELETE FROM products WHERE id=$1", [id]);
  }

  // insertar imagen
async insertImage(productId, key) {
  await pool.query(
    "INSERT INTO product_images (product_id, key) VALUES ($1,$2)",
    [productId, key]
  );
}

// borrar imágenes
async deleteImagesByProduct(productId) {
  await pool.query(
    "DELETE FROM product_images WHERE product_id=$1",
    [productId]
  );
}
}