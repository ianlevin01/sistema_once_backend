import { Router } from "express";
import pool from "../database/db.js";
import { invalidatePriceConfigCache } from "../services/productService.js";
import { requireAuth } from "./authRoutes.js";

const router = Router();

// GET /config/precios
router.get("/precios", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM price_config WHERE negocio_id = $1 LIMIT 1`,
      [req.user.negocio_id]
    );
    if (!rows.length) {
      return res.status(404).json({ message: "Sin configuración" });
    }
    return res.status(200).json(rows[0]);
  } catch (err) {
    console.error("Error GET /config/precios:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /config/precios
router.put("/precios", requireAuth, async (req, res) => {
  const { cotizacion_dolar, pct_1, pct_2, pct_3, pct_4, pct_5 } = req.body;

  if (
    cotizacion_dolar == null || pct_1 == null || pct_2 == null ||
    pct_3 == null || pct_4 == null || pct_5 == null
  ) {
    return res.status(400).json({ message: "Todos los campos son requeridos" });
  }

  const negocioId = req.user.negocio_id;

  try {
    const existing = await pool.query(
      `SELECT id FROM price_config WHERE negocio_id = $1`,
      [negocioId]
    );
    let result;

    if (existing.rows.length) {
      const { rows } = await pool.query(
        `UPDATE price_config
         SET cotizacion_dolar=$1, pct_1=$2, pct_2=$3, pct_3=$4, pct_4=$5, pct_5=$6, updated_at=now()
         WHERE id=$7
         RETURNING *`,
        [cotizacion_dolar, pct_1, pct_2, pct_3, pct_4, pct_5, existing.rows[0].id]
      );
      result = rows[0];
    } else {
      const { rows } = await pool.query(
        `INSERT INTO price_config (cotizacion_dolar, pct_1, pct_2, pct_3, pct_4, pct_5, negocio_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [cotizacion_dolar, pct_1, pct_2, pct_3, pct_4, pct_5, negocioId]
      );
      result = rows[0];
    }

    invalidatePriceConfigCache(negocioId);

    return res.status(200).json(result);
  } catch (err) {
    console.error("Error PUT /config/precios:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
