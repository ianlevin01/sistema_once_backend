import { Router } from "express";
import pool from "../database/db.js";
import { requireAuth } from "./authRoutes.js";

const router = Router();

// GET /warehouses — devuelve los depósitos activos del negocio actual
// ?include_inactive=true → incluye también los desactivados (usado solo por Configuración)
router.get("/", requireAuth, async (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === "true";
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (LOWER(TRIM(name))) id, TRIM(name) AS name, active
       FROM warehouses
       WHERE negocio_id = $1
       ${includeInactive ? "" : "AND active = true"}
       ORDER BY LOWER(TRIM(name)), id`,
      [req.user.negocio_id]
    );
    return res.status(200).json(rows);
  } catch (err) {
    console.error("Error GET /warehouses:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST /warehouses — crea un nuevo depósito
router.post("/", requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: "Nombre requerido" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO warehouses (name, negocio_id) VALUES ($1, $2) RETURNING id, TRIM(name) AS name, active`,
      [name.trim(), req.user.negocio_id]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ message: "Ya existe un depósito con ese nombre" });
    console.error("Error POST /warehouses:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// PATCH /warehouses/:id — activar/desactivar un depósito
// Al desactivar: el depósito deja de listarse en todos lados (salvo Configuración con
// include_inactive=true) y cualquier usuario o preferencia que apuntara a él queda sin asignar.
// El stock del depósito NO se toca — al reactivar vuelve a sumar exactamente igual.
router.patch("/:id", requireAuth, async (req, res) => {
  const { active } = req.body;
  if (typeof active !== "boolean") return res.status(400).json({ message: "active (boolean) requerido" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `UPDATE warehouses SET active = $1 WHERE id = $2 AND negocio_id = $3 RETURNING id, TRIM(name) AS name, active`,
      [active, req.params.id, req.user.negocio_id]
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Depósito no encontrado" });
    }

    if (!active) {
      await client.query(`UPDATE users SET warehouse_id = NULL WHERE warehouse_id = $1`, [req.params.id]);
      await client.query(
        `UPDATE price_config SET preferred_warehouse_id = NULL WHERE preferred_warehouse_id = $1 AND negocio_id = $2`,
        [req.params.id, req.user.negocio_id]
      );
    }

    await client.query("COMMIT");
    return res.status(200).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error PATCH /warehouses/:id:", err);
    return res.status(500).json({ message: "Error interno" });
  } finally {
    client.release();
  }
});

export default router;
