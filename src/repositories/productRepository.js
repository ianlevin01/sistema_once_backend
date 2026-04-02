import pool from "../database/db.js"

export default class ProductRepository {
  async search(name) {
    const res = await pool.query(`
      SELECT
        p.*,
        c.name AS category_name,
        COALESCE(
          (SELECT json_agg(json_build_object('id', pi.id, 'key', pi.key) ORDER BY pi.created_at)
           FROM product_images pi WHERE pi.product_id = p.id), '[]'
        ) AS images,
        COALESCE(
          (SELECT json_agg(json_build_object('price_type', pp.price_type, 'currency', pp.currency, 'price', pp.price) ORDER BY pp.price_type)
           FROM product_prices pp WHERE pp.product_id = p.id), '[]'
        ) AS prices,
        COALESCE(
          (SELECT json_agg(json_build_object('warehouse_id', s.warehouse_id, 'quantity', s.quantity))
           FROM stock s WHERE s.product_id = p.id), '[]'
        ) AS stock
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.name ILIKE $1
      ORDER BY p.name
    `, [`%${name || ""}%`]);
    return res.rows;
  }

  async getPaginated(limit = 30, offset = 0, categoryId = null) {
    const params      = categoryId ? [limit, offset, categoryId] : [limit, offset];
    const whereClause = categoryId ? "WHERE p.category_id = $3" : "";

    const res = await pool.query(`
      SELECT
        p.*,
        c.name AS category_name,

        COALESCE(
          (
            SELECT json_agg(json_build_object('id', pi.id, 'key', pi.key) ORDER BY pi.created_at)
            FROM product_images pi
            WHERE pi.product_id = p.id
          ),
          '[]'
        ) AS images,

        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
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
            SELECT json_agg(json_build_object('warehouse_id', s.warehouse_id, 'quantity', s.quantity))
            FROM stock s
            WHERE s.product_id = p.id
          ),
          '[]'
        ) AS stock

      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    return res.rows;
  }

  async getCategories() {
    const res = await pool.query(
      "SELECT id, name FROM categories ORDER BY name ASC"
    );
    return res.rows;
  }

  async createCategory(name, parentId = null) {
    const res = await pool.query(
      `INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id, name, parent_id`,
      [name, parentId]
    );
    return res.rows[0];
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
        video_url,
        costo_usd
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
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
        p.video_url,
        p.costo_usd ?? null,
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
        video_url=$14,
        costo_usd=$15
      WHERE id=$16
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
        p.costo_usd ?? null,
        id
      ]
    );

    return res.rows[0];
  }

  async delete(id) {
    await pool.query("DELETE FROM products WHERE id=$1", [id]);
  }

  // ── Imágenes ────────────────────────────────────────────────────────────────

  async insertImage(productId, key) {
    await pool.query(
      "INSERT INTO product_images (product_id, key) VALUES ($1,$2)",
      [productId, key]
    );
  }

  async deleteImagesByProduct(productId) {
    await pool.query(
      "DELETE FROM product_images WHERE product_id=$1",
      [productId]
    );
  }

  // ── Costos ──────────────────────────────────────────────────────────────────

  async insertCost(productId, cost) {
    await pool.query(
      "INSERT INTO product_costs (product_id, cost) VALUES ($1, $2)",
      [productId, cost]
    );
  }

  // ── Precios ─────────────────────────────────────────────────────────────────

  async upsertPrice(productId, priceType, price, currency = "ARS") {
    await pool.query(
      `INSERT INTO product_prices (product_id, price_type, price, currency)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, price_type)
       DO UPDATE SET price = EXCLUDED.price, currency = EXCLUDED.currency`,
      [productId, priceType, price, currency]
    );
  }

  async deletePricesByProduct(productId) {
    await pool.query(
      "DELETE FROM product_prices WHERE product_id=$1",
      [productId]
    );
  }
}
