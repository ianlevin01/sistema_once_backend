import { Router } from "express";
import pool from "../database/db.js";
import { requireAuth } from "./authRoutes.js";

const router = Router();

// GET /warehouses — devuelve los depósitos del negocio actual
router.get("/", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (LOWER(TRIM(name))) id, TRIM(name) AS name
       FROM warehouses
       WHERE negocio_id = $1
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
      `INSERT INTO warehouses (name, negocio_id) VALUES ($1, $2) RETURNING id, TRIM(name) AS name`,
      [name.trim(), req.user.negocio_id]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ message: "Ya existe un depósito con ese nombre" });
    console.error("Error POST /warehouses:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
