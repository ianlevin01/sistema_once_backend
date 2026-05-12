import pool from "../database/db.js"

export default class ProductRepository {
  async search(name, negocioId, queryEmbedding = null) {
    const SELECT = `
      SELECT
        p.*,
        c.name AS category_name,
        ppo.pct_1 AS ovr_pct_1,
        ppo.pct_2 AS ovr_pct_2,
        ppo.pct_3 AS ovr_pct_3,
        ppo.pct_4 AS ovr_pct_4,
        ppo.pct_5 AS ovr_pct_5,
        COALESCE(
          (SELECT json_agg(json_build_object('id', pi.id, 'key', pi.key) ORDER BY pi.created_at)
           FROM product_images pi WHERE pi.product_id = p.id), '[]'
        ) AS images,
        COALESCE(
          (SELECT json_agg(json_build_object('warehouse_id', s.warehouse_id, 'quantity', s.quantity))
           FROM stock s WHERE s.product_id = p.id), '[]'
        ) AS stock
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN product_price_overrides ppo ON ppo.product_id = p.id
    `;

    if (queryEmbedding) {
      const res = await pool.query(`
        ${SELECT}
        WHERE p.negocio_id = $1 AND p.deleted_at IS NULL AND p.active = true
          AND p.embedding IS NOT NULL
          AND (p.embedding <=> $2) < 0.65
        ORDER BY p.embedding <=> $2
        LIMIT 30
      `, [negocioId, JSON.stringify(queryEmbedding)]);
      return res.rows;
    }

    if (!name?.trim()) {
      const res = await pool.query(`
        ${SELECT}
        WHERE p.negocio_id = $1 AND p.deleted_at IS NULL AND p.active = true
        ORDER BY p.created_at DESC
        LIMIT 20
      `, [negocioId]);
      return res.rows;
    }

    const res = await pool.query(`
      ${SELECT}
      WHERE (p.name ILIKE $1 OR p.code ILIKE $1) AND p.negocio_id = $2 AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC
      LIMIT 100
    `, [`%${name}%`, negocioId]);
    return res.rows;
  }

  async getPaginated(limit = 30, offset = 0, categoryId = null, sort = "default", negocioId) {
    const params = categoryId ? [limit, offset, categoryId, negocioId] : [limit, offset, negocioId];
    const negocioParam = categoryId ? 4 : 3;
    const whereClause = categoryId
      ? `WHERE p.category_id = $3 AND p.negocio_id = $${negocioParam} AND p.deleted_at IS NULL AND p.active = true`
      : `WHERE p.negocio_id = $${negocioParam} AND p.deleted_at IS NULL AND p.active = true`;

    const ORDER_MAP = {
      price_asc:  "price_asc",
      price_desc: "price_desc",
      name_asc:   "p.name ASC",
      name_desc:  "p.name DESC",
    };

    let orderClause;
    if (sort === "price_asc" || sort === "price_desc") {
      const dir = sort === "price_asc" ? "ASC" : "DESC";
      orderClause = `p.costo_usd ${dir} NULLS LAST`;
    } else {
      orderClause = ORDER_MAP[sort] ?? "p.created_at DESC";
    }

    const res = await pool.query(`
      SELECT
        p.*,
        c.name AS category_name,
        ppo.pct_1 AS ovr_pct_1,
        ppo.pct_2 AS ovr_pct_2,
        ppo.pct_3 AS ovr_pct_3,
        ppo.pct_4 AS ovr_pct_4,
        ppo.pct_5 AS ovr_pct_5,

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
            SELECT json_agg(json_build_object('warehouse_id', s.warehouse_id, 'quantity', s.quantity))
            FROM stock s
            WHERE s.product_id = p.id
          ),
          '[]'
        ) AS stock

      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN product_price_overrides ppo ON ppo.product_id = p.id
      ${whereClause}
      ORDER BY ${orderClause}
      LIMIT $1 OFFSET $2
    `, params);

    return res.rows;
  }

  async getCategories(negocioId) {
    const res = await pool.query(
      "SELECT id, name FROM categories WHERE negocio_id = $1 ORDER BY name ASC",
      [negocioId]
    );
    return res.rows;
  }

  async createCategory(name, parentId = null, negocioId) {
    const res = await pool.query(
      `INSERT INTO categories (name, parent_id, negocio_id) VALUES ($1, $2, $3) RETURNING id, name, parent_id`,
      [name, parentId, negocioId]
    );
    return res.rows[0];
  }

  async getById(id) {
    const res = await pool.query(`
      SELECT
        p.*,
        c.name AS category_name,
        ppo.pct_1 AS ovr_pct_1,
        ppo.pct_2 AS ovr_pct_2,
        ppo.pct_3 AS ovr_pct_3,
        ppo.pct_4 AS ovr_pct_4,
        ppo.pct_5 AS ovr_pct_5,

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
                'warehouse_id',   s.warehouse_id,
                'warehouse_name', w.name,
                'quantity',       s.quantity,
                'reserved', COALESCE((
                  SELECT SUM(oi.quantity)
                  FROM order_items oi
                  JOIN orders o ON o.id = oi.order_id
                  WHERE oi.product_id = p.id
                    AND o.warehouse_id = s.warehouse_id
                    AND o.tipo IN ('Nota de Pedido', 'Nota de Pedido Web')
                    AND o.status != 'cancelled'
                ), 0)
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
      LEFT JOIN product_price_overrides ppo ON ppo.product_id = p.id
      WHERE p.id = $1 AND p.deleted_at IS NULL
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
        costo_usd,
        negocio_id
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
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
        p.negocio_id,
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

  async softDelete(id) {
    await pool.query("UPDATE products SET deleted_at = NOW() WHERE id = $1", [id]);
  }

  async findDeletedByCode(code, negocioId) {
    const res = await pool.query(
      `SELECT id, name, code FROM products WHERE code = $1 AND negocio_id = $2 AND deleted_at IS NOT NULL LIMIT 1`,
      [code, negocioId]
    );
    return res.rows[0] || null;
  }

  async deleteStockByProduct(productId) {
    await pool.query("DELETE FROM stock WHERE product_id = $1", [productId]);
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

  async deleteImageByKey(key) {
    await pool.query(
      "DELETE FROM product_images WHERE key=$1",
      [key]
    );
  }

  // ── Costos ──────────────────────────────────────────────────────────────────

  async insertCost(productId, cost) {
    await pool.query(
      "INSERT INTO product_costs (product_id, cost) VALUES ($1, $2)",
      [productId, cost]
    );
  }

  // ── Price overrides ─────────────────────────────────────────────────────────

  async getOverride(productId) {
    const res = await pool.query(
      "SELECT * FROM product_price_overrides WHERE product_id = $1",
      [productId]
    );
    return res.rows[0] || null;
  }

  async upsertOverride(productId, data) {
    const res = await pool.query(
      `INSERT INTO product_price_overrides (product_id, pct_1, pct_2, pct_3, pct_4, pct_5)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (product_id) DO UPDATE SET
         pct_1 = EXCLUDED.pct_1,
         pct_2 = EXCLUDED.pct_2,
         pct_3 = EXCLUDED.pct_3,
         pct_4 = EXCLUDED.pct_4,
         pct_5 = EXCLUDED.pct_5
       RETURNING *`,
      [productId, data.pct_1 ?? null, data.pct_2 ?? null, data.pct_3 ?? null, data.pct_4 ?? null, data.pct_5 ?? null]
    );
    return res.rows[0];
  }

  async deleteOverride(productId) {
    await pool.query("DELETE FROM product_price_overrides WHERE product_id = $1", [productId]);
  }

}
