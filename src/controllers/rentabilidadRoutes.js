import express from "express";
import pool from "../database/db.js";
import { requireAuth } from "./authRoutes.js";

const router = express.Router();

function requireSuperAdmin(req, res, next) {
  if (req.user.role !== "superadmin") {
    return res.status(403).json({ message: "Acceso restringido a superadmin" });
  }
  next();
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/rentabilidad/stats?from=YYYY-MM-DD&to=YYYY-MM-DD
// ────────────────────────────────────────────────────────────────────────────
router.get("/stats", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    const negocioId = req.user.negocio_id;

    if (!from || !to) return res.status(400).json({ message: "from y to son requeridos" });

    const fromDate = `${from} 00:00:00`;
    const toDate   = `${to} 23:59:59`;

    // Cotización actual para convertir USD → ARS
    const cotizRes = await pool.query(
      `SELECT cotizacion_dolar FROM price_config WHERE negocio_id = $1 LIMIT 1`,
      [negocioId]
    );
    const cotizacion = Number(cotizRes.rows[0]?.cotizacion_dolar || 1000);

    // Helper SQL inline: total en ARS
    const totalARS = `(CASE WHEN o.divisa = 'USD' THEN o.total * ${cotizacion} ELSE o.total END)`;

    // ── 1. Comprobantes por tipo ─────────────────────────────────────────────
    const comprobantesRes = await pool.query(`
      SELECT
        o.tipo,
        COALESCE(SUM(${totalARS}), 0) AS total_ars
      FROM orders o
      WHERE o.negocio_id = $1
        AND o.deleted_at IS NULL
        AND o.created_at BETWEEN $2 AND $3
        AND o.tipo IN ('Presupuesto', 'Presupuesto Web', 'Reposicion', 'Devolucion', 'Devol a proveedor')
      GROUP BY o.tipo
    `, [negocioId, fromDate, toDate]);

    // ── 2. TODOS los comprobantes NO Cta Cte (para ganancia real) ────────────
    // Todos los tipos filtrados: presupuesto, reposicion, devolucion, devol prov
    const realComprobantesRes = await pool.query(`
      SELECT
        o.tipo,
        COALESCE(SUM(${totalARS}), 0) AS total_ars
      FROM orders o
      JOIN payments p ON p.order_id = o.id
      WHERE o.negocio_id = $1
        AND o.deleted_at IS NULL
        AND o.created_at BETWEEN $2 AND $3
        AND o.tipo IN ('Presupuesto', 'Presupuesto Web', 'Reposicion', 'Devolucion', 'Devol a proveedor')
        AND p.method != 'Cta Cte'
      GROUP BY o.tipo
    `, [negocioId, fromDate, toDate]);

    // ── 3. Cobranzas manuales CC clientes (order_id IS NULL) ─────────────────
    // Solo haber (tipo='pago') = cliente pagó en efectivo = SUMA.
    // El "debe" (tipo='debito') = cargo al cliente sin comprobante = el cliente
    // te debe más, pero NO hubo movimiento de efectivo → no entra en ganancia real.
    // Conversión USD→ARS incluida para clientes con cuenta en dólares.
    const ccClientesRes = await pool.query(`
      SELECT
        ccm.tipo,
        COALESCE(SUM(
          CASE WHEN ccm.divisa_cuenta = 'USD' THEN ccm.monto * ${cotizacion}
               ELSE ccm.monto
          END
        ), 0) AS total
      FROM cc_movimientos ccm
      JOIN cuentas_corrientes cc ON cc.id = ccm.cuenta_corriente_id
      JOIN customers c ON c.id = cc.customer_id
      WHERE c.negocio_id = $1
        AND ccm.order_id IS NULL
        AND ccm.created_at BETWEEN $2 AND $3
      GROUP BY ccm.tipo
    `, [negocioId, fromDate, toDate]);

    // ── 4. Cobranzas manuales CC proveedores (order_id IS NULL) ──────────────
    // haber (tipo='pago') = proveedor nos acreditó = SUMA
    // debe  (tipo='debito') = le pagamos al proveedor en efectivo = RESTA
    // Conversión USD→ARS incluida para proveedores con cuenta en dólares.
    const ccProveedoresRes = await pool.query(`
      SELECT
        ccm.tipo,
        COALESCE(SUM(
          CASE WHEN ccm.divisa_cuenta = 'USD' THEN ccm.monto * ${cotizacion}
               ELSE ccm.monto
          END
        ), 0) AS total
      FROM cc_movimientos_prov ccm
      JOIN cuentas_corrientes_prov cc ON cc.id = ccm.cuenta_corriente_id
      JOIN proveedores p ON p.id = cc.proveedor_id
      WHERE p.negocio_id = $1
        AND ccm.order_id IS NULL
        AND ccm.created_at BETWEEN $2 AND $3
      GROUP BY ccm.tipo
    `, [negocioId, fromDate, toDate]);

    // ── 4. Gastos fijos ──────────────────────────────────────────────────────
    const gastosRes = await pool.query(
      `SELECT COALESCE(SUM(monto), 0) AS total FROM gastos_fijos WHERE negocio_id = $1`,
      [negocioId]
    );
    const gastosFijosMensual = Number(gastosRes.rows[0]?.total || 0);

    // Prorrateo según días del rango (30 días = 1 mes)
    const fromMs = new Date(from).getTime();
    const toMs   = new Date(to).getTime();
    const days   = Math.max(1, Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24)) + 1);
    const gastosFijosProrrateados = Math.round(gastosFijosMensual * (days / 30));

    // ── Calcular ganancia nominal ────────────────────────────────────────────
    let presupuestoNominal = 0;
    let reposicionTotal    = 0;
    let devolucionTotal    = 0;
    let devolProvTotal     = 0;

    for (const row of comprobantesRes.rows) {
      const v = Number(row.total_ars || 0);
      switch (row.tipo) {
        case "Presupuesto":
        case "Presupuesto Web":
          presupuestoNominal += v;
          break;
        case "Devol a proveedor":
          devolProvTotal += v;
          break;
        case "Reposicion":
          reposicionTotal += v;
          break;
        case "Devolucion":
          devolucionTotal += v;
          break;
      }
    }

    const gananciaBrutaNominal = presupuestoNominal + devolProvTotal - reposicionTotal - devolucionTotal;
    const gananciaNominal      = gananciaBrutaNominal - gastosFijosProrrateados;

    // ── Calcular ganancia real ───────────────────────────────────────────────
    // Comprobantes filtrados por payment != 'Cta Cte'
    let presupuestoReal = 0;
    let reposicionReal  = 0;
    let devolucionReal  = 0;
    let devolProvReal   = 0;

    for (const row of realComprobantesRes.rows) {
      const v = Number(row.total_ars || 0);
      switch (row.tipo) {
        case "Presupuesto":
        case "Presupuesto Web":  presupuestoReal += v; break;
        case "Devol a proveedor": devolProvReal   += v; break;
        case "Reposicion":        reposicionReal  += v; break;
        case "Devolucion":        devolucionReal  += v; break;
      }
    }

    // Cobranzas CC clientes: solo haber (pago) = cobro real de efectivo = +
    // El debe (debito) es un cargo al cliente — NO es caja saliente, se omite.
    let ccClientesHaber = 0;
    for (const row of ccClientesRes.rows) {
      if (row.tipo === "pago") ccClientesHaber += Number(row.total || 0);
    }

    // Cobranzas CC proveedores: haber (pago) = +, debe (debito) = pagamos al prov = -
    let ccProvHaber = 0;
    let ccProvDebe  = 0;
    for (const row of ccProveedoresRes.rows) {
      if (row.tipo === "pago")   ccProvHaber += Number(row.total || 0);
      if (row.tipo === "debito") ccProvDebe  += Number(row.total || 0);
    }

    const gananciaBrutaReal =
      presupuestoReal + devolProvReal
      - reposicionReal - devolucionReal
      + ccClientesHaber
      + ccProvHaber - ccProvDebe;
    const gananciaReal = gananciaBrutaReal - gastosFijosProrrateados;

    // ── 5. Métricas adicionales ──────────────────────────────────────────────
    const newClientsRes = await pool.query(`
      SELECT COUNT(*) AS count
      FROM customers
      WHERE negocio_id = $1
        AND created_at BETWEEN $2 AND $3
    `, [negocioId, fromDate, toDate]);

    const webOrdersRes = await pool.query(`
      SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
      FROM web_orders
      WHERE negocio_id = $1
        AND created_at BETWEEN $2 AND $3
    `, [negocioId, fromDate, toDate]);

    // ── 6. Distribución de ventas (para pie chart) ───────────────────────────
    const consumidorFinalRes = await pool.query(`
      SELECT COALESCE(SUM(${totalARS}), 0) AS total
      FROM orders o
      WHERE o.negocio_id = $1
        AND o.deleted_at IS NULL
        AND o.created_at BETWEEN $2 AND $3
        AND o.tipo IN ('Presupuesto', 'Presupuesto Web')
        AND o.es_consumidor_final = true
    `, [negocioId, fromDate, toDate]);

    const clientesRes = await pool.query(`
      SELECT COALESCE(SUM(${totalARS}), 0) AS total
      FROM orders o
      WHERE o.negocio_id = $1
        AND o.deleted_at IS NULL
        AND o.created_at BETWEEN $2 AND $3
        AND o.tipo = 'Presupuesto'
        AND o.es_consumidor_final = false
    `, [negocioId, fromDate, toDate]);

    const webPresupuestoRes = await pool.query(`
      SELECT COALESCE(SUM(${totalARS}), 0) AS total
      FROM orders o
      WHERE o.negocio_id = $1
        AND o.deleted_at IS NULL
        AND o.created_at BETWEEN $2 AND $3
        AND o.tipo = 'Presupuesto Web'
    `, [negocioId, fromDate, toDate]);

    // ── 7. Tendencia diaria (para line chart) ────────────────────────────────
    const dailyRes = await pool.query(`
      SELECT
        DATE(o.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') AS fecha,
        COALESCE(SUM(
          CASE
            WHEN o.tipo IN ('Presupuesto', 'Presupuesto Web', 'Devol a proveedor') THEN  ${totalARS}
            WHEN o.tipo IN ('Reposicion', 'Devolucion')                            THEN -${totalARS}
            ELSE 0
          END
        ), 0) AS nominal
      FROM orders o
      WHERE o.negocio_id = $1
        AND o.deleted_at IS NULL
        AND o.created_at BETWEEN $2 AND $3
        AND o.tipo IN ('Presupuesto', 'Presupuesto Web', 'Reposicion', 'Devolucion', 'Devol a proveedor')
      GROUP BY DATE(o.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')
      ORDER BY fecha ASC
    `, [negocioId, fromDate, toDate]);

    return res.json({
      // Ganancias
      ganancia_nominal:            Math.round(gananciaNominal),
      ganancia_real:               Math.round(gananciaReal),
      ganancia_bruta_nominal:      Math.round(gananciaBrutaNominal),
      ganancia_bruta_real:         Math.round(gananciaBrutaReal),
      // Gastos
      gastos_fijos_mensual:        Math.round(gastosFijosMensual),
      gastos_fijos_prorrateados:   gastosFijosProrrateados,
      // Desglose nominal
      presupuesto_nominal:         Math.round(presupuestoNominal),
      reposicion_total:            Math.round(reposicionTotal),
      devolucion_total:            Math.round(devolucionTotal),
      devol_prov_total:            Math.round(devolProvTotal),
      // Desglose real (comprobantes filtrados por payment != 'Cta Cte')
      presupuesto_real:            Math.round(presupuestoReal),
      reposicion_real:             Math.round(reposicionReal),
      devolucion_real:             Math.round(devolucionReal),
      devol_prov_real:             Math.round(devolProvReal),
      // Cobranzas CC clientes (order_id IS NULL) — solo cobros reales
      cc_clientes_haber:           Math.round(ccClientesHaber),
      // Cobranzas CC proveedores (order_id IS NULL)
      cc_prov_haber:               Math.round(ccProvHaber),
      cc_prov_debe:                Math.round(ccProvDebe),
      // Métricas
      clientes_nuevos:             Number(newClientsRes.rows[0]?.count || 0),
      pedidos_web_count:           Number(webOrdersRes.rows[0]?.count || 0),
      pedidos_web_total:           Number(webOrdersRes.rows[0]?.total || 0),
      // Distribución
      consumidor_final_total:      Math.round(Number(consumidorFinalRes.rows[0]?.total || 0)),
      clientes_total:              Math.round(Number(clientesRes.rows[0]?.total || 0)),
      web_presupuesto_total:       Math.round(Number(webPresupuestoRes.rows[0]?.total || 0)),
      // Chart data
      daily_trend:                 dailyRes.rows,
    });
  } catch (err) {
    console.error("[rentabilidadRoutes] /stats error:", err);
    return res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GASTOS FIJOS CRUD
// ────────────────────────────────────────────────────────────────────────────

// GET /api/rentabilidad/gastos-fijos
router.get("/gastos-fijos", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM gastos_fijos WHERE negocio_id = $1 ORDER BY created_at ASC`,
      [req.user.negocio_id]
    );
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/rentabilidad/gastos-fijos
router.post("/gastos-fijos", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { descripcion, monto } = req.body;
    if (!descripcion || monto === undefined || monto === null)
      return res.status(400).json({ message: "descripcion y monto son requeridos" });

    const result = await pool.query(
      `INSERT INTO gastos_fijos (negocio_id, descripcion, monto) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.negocio_id, descripcion.trim(), Number(monto)]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/rentabilidad/gastos-fijos/:id
router.put("/gastos-fijos/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { descripcion, monto } = req.body;
    if (!descripcion || monto === undefined || monto === null)
      return res.status(400).json({ message: "descripcion y monto son requeridos" });

    const result = await pool.query(
      `UPDATE gastos_fijos
       SET descripcion = $1, monto = $2
       WHERE id = $3 AND negocio_id = $4
       RETURNING *`,
      [descripcion.trim(), Number(monto), req.params.id, req.user.negocio_id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: "No encontrado" });
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// DELETE /api/rentabilidad/gastos-fijos/:id
router.delete("/gastos-fijos/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM gastos_fijos WHERE id = $1 AND negocio_id = $2`,
      [req.params.id, req.user.negocio_id]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

export default router;
