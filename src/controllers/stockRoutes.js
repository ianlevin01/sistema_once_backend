import express from "express";
import pool from "../database/db.js";
import { requireAuth } from "./authRoutes.js";

const router = express.Router();

// GET /api/stock/movements
// ?product_id=UUID  (required)
// ?mode=completo|deposito  (default: completo)
// ?include_manual=true|false  (default: true)
// ?from=YYYY-MM-DD  (optional)
// ?to=YYYY-MM-DD    (optional)
router.get("/movements", requireAuth, async (req, res) => {
  try {
    const {
      product_id,
      mode = "completo",
      include_manual = "true",
      from,
      to,
    } = req.query;

    const negocioId = req.user.negocio_id;
    if (!product_id) return res.status(400).json({ message: "product_id requerido" });

    const warehouseId   = mode === "deposito" ? (req.user.warehouse_id || null) : null;
    const inclManual    = include_manual !== "false";

    const params   = [product_id, negocioId];
    let dateFilter = "";
    if (from && to) {
      params.push(`${from} 00:00:00`, `${to} 23:59:59`);
      dateFilter = `AND o.created_at BETWEEN $${params.length - 1} AND $${params.length}`;
    } else if (from) {
      params.push(`${from} 00:00:00`);
      dateFilter = `AND o.created_at >= $${params.length}`;
    } else if (to) {
      params.push(`${to} 23:59:59`);
      dateFilter = `AND o.created_at <= $${params.length}`;
    }

    let whParam         = "";
    let whParamIdx      = 0;
    let whReposParam    = "";
    let whRemitoSale    = "";
    let whRemitoEntra   = "";
    let whManualParam   = "";

    if (warehouseId) {
      params.push(warehouseId);
      whParamIdx     = params.length;
      whParam        = `AND o.warehouse_id::text = $${whParamIdx}`;
      whReposParam   = `AND o.destino::text = $${whParamIdx}`;
      whRemitoSale   = `AND EXISTS (SELECT 1 FROM warehouses _wf WHERE _wf.id::text = $${whParamIdx} AND _wf.name = o.origen AND _wf.negocio_id = $2)`;
      whRemitoEntra  = `AND EXISTS (SELECT 1 FROM warehouses _wf WHERE _wf.id::text = $${whParamIdx} AND _wf.name = o.destino AND _wf.negocio_id = $2)`;
      whManualParam  = `AND smm.warehouse_id::text = $${whParamIdx}`;
    }

    const manualDateFilter = dateFilter.replace(/o\.created_at/g, "smm.created_at");

    const sql = `
      -- 1. Presupuestos (salidas)
      SELECT
        o.created_at AS fecha,
        o.tipo || ' ' || o.id::text AS concepto,
        CASE WHEN o.es_consumidor_final
             THEN COALESCE(o.consumidor_final_nombre, 'Consumidor Final')
             ELSE COALESCE(c.name, '') END AS entidad,
        COALESCE(o.vendedor, o.created_by_name, '') AS operador,
        COALESCE(w.name, '') AS deposito,
        oi.unit_price AS precio,
        NULL::numeric AS entradas,
        oi.quantity::numeric AS salidas,
        'comprobante' AS tipo_mov,
        FALSE AS es_manual
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN warehouses w ON w.id = o.warehouse_id
      WHERE oi.product_id = $1
        AND o.tipo IN ('Presupuesto', 'Presupuesto Web')
        AND o.deleted_at IS NULL
        AND o.negocio_id = $2
        ${whParam}
        ${dateFilter}

      UNION ALL

      -- 2. Devoluciones (entradas)
      SELECT
        o.created_at,
        'Devolucion ' || o.id::text,
        CASE WHEN o.es_consumidor_final
             THEN COALESCE(o.consumidor_final_nombre, 'Consumidor Final')
             ELSE COALESCE(c.name, '') END,
        COALESCE(o.vendedor, o.created_by_name, ''),
        COALESCE(w.name, ''),
        oi.unit_price,
        oi.quantity::numeric,
        NULL::numeric,
        'comprobante',
        FALSE
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN warehouses w ON w.id = o.warehouse_id
      WHERE oi.product_id = $1
        AND o.tipo = 'Devolucion'
        AND o.deleted_at IS NULL
        AND o.negocio_id = $2
        ${whParam}
        ${dateFilter}

      UNION ALL

      -- 3. Reposiciones (entradas) — destino guarda el UUID del warehouse destino como text
      SELECT
        o.created_at,
        'Reposicion ' || o.id::text,
        COALESCE(pr.name, ''),
        COALESCE(o.created_by_name, ''),
        COALESCE(w_dest.name, ''),
        oi.unit_price,
        oi.quantity::numeric,
        NULL::numeric,
        'comprobante',
        FALSE
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN proveedores pr ON pr.id = o.supplier_id
      LEFT JOIN warehouses w_dest ON w_dest.id::text = o.destino
      WHERE oi.product_id = $1
        AND o.tipo = 'Reposicion'
        AND o.deleted_at IS NULL
        AND o.negocio_id = $2
        ${whReposParam}
        ${dateFilter}

      UNION ALL

      -- 4. Devol a proveedor (salidas)
      SELECT
        o.created_at,
        'Devol a proveedor ' || o.id::text,
        COALESCE(pr.name, ''),
        COALESCE(o.created_by_name, ''),
        COALESCE(w_dest.name, ''),
        oi.unit_price,
        NULL::numeric,
        oi.quantity::numeric,
        'comprobante',
        FALSE
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN proveedores pr ON pr.id = o.supplier_id
      LEFT JOIN warehouses w_dest ON w_dest.id::text = o.destino
      WHERE oi.product_id = $1
        AND o.tipo = 'Devol a proveedor'
        AND o.deleted_at IS NULL
        AND o.negocio_id = $2
        ${whReposParam}
        ${dateFilter}

      UNION ALL

      -- 5a. Remito Sale (salida del depósito origen)
      SELECT
        o.created_at,
        'Remito Interno Sale ' || o.id::text,
        COALESCE(o.origen, '') || '....' || COALESCE(u.name, '') || ' → ' || COALESCE(o.destino, ''),
        COALESCE(u.name, ''),
        COALESCE(o.origen, ''),
        oi.unit_price,
        NULL::numeric,
        oi.quantity::numeric,
        'remito',
        FALSE
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN users u ON u.id = o.recipient_user_id
      WHERE oi.product_id = $1
        AND o.tipo = 'Remito'
        AND o.deleted_at IS NULL
        AND o.negocio_id = $2
        ${whRemitoSale}
        ${dateFilter}

      UNION ALL

      -- 5b. Remito Entra (entrada al depósito destino)
      SELECT
        o.created_at,
        'Remito Interno Entra ' || o.id::text,
        COALESCE(o.origen, '') || '....' || COALESCE(u.name, '') || ' → ' || COALESCE(o.destino, ''),
        COALESCE(u.name, ''),
        COALESCE(o.destino, ''),
        oi.unit_price,
        oi.quantity::numeric,
        NULL::numeric,
        'remito',
        FALSE
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN users u ON u.id = o.recipient_user_id
      WHERE oi.product_id = $1
        AND o.tipo = 'Remito'
        AND o.deleted_at IS NULL
        AND o.negocio_id = $2
        ${whRemitoEntra}
        ${dateFilter}

      ${inclManual ? `
      UNION ALL

      -- 6. Ajustes manuales y Excel import
      SELECT
        smm.created_at,
        CASE WHEN smm.source = 'excel' THEN 'Excel Import' ELSE 'Ajuste Manual' END,
        COALESCE(smm.created_by, ''),
        COALESCE(smm.created_by, ''),
        COALESCE(w.name, ''),
        NULL,
        CASE WHEN smm.delta > 0 THEN smm.delta ELSE NULL END,
        CASE WHEN smm.delta < 0 THEN ABS(smm.delta) ELSE NULL END,
        'manual',
        TRUE
      FROM stock_manual_movements smm
      LEFT JOIN warehouses w ON w.id = smm.warehouse_id
      WHERE smm.product_id = $1
        AND smm.negocio_id = $2
        ${whManualParam}
        ${manualDateFilter}
      ` : ""}

      ORDER BY fecha DESC
      LIMIT 1000
    `;

    // Stock actual del producto (suma por warehouse)
    const stockRes = await pool.query(`
      SELECT w.name AS deposito, s.quantity AS stock
      FROM stock s
      JOIN warehouses w ON w.id = s.warehouse_id
      WHERE s.product_id = $1
      ORDER BY w.name
    `, [product_id]);

    const productRes = await pool.query(
      `SELECT id, name, code FROM products WHERE id = $1`, [product_id]
    );

    const movRes = await pool.query(sql, params);

    return res.json({
      product:    productRes.rows[0] || null,
      stock:      stockRes.rows,
      movements:  movRes.rows,
    });
  } catch (err) {
    console.error("[stockRoutes] /movements error:", err);
    return res.status(500).json({ message: err.message });
  }
});

export default router;
