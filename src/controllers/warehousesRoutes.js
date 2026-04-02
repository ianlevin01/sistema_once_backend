import { Router } from "express";
import pool from "../database/db.js";

const router = Router();

// GET /warehouses — devuelve todos los depósitos ordenados por nombre
// warehousesRoutes.js — sin cambios de estructura, solo la query como fallback seguro
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (LOWER(TRIM(name))) id, TRIM(name) AS name 
       FROM warehouses 
       ORDER BY LOWER(TRIM(name)), id`
    );
    return res.status(200).json(rows);
  } catch (err) {
    console.error("Error GET /warehouses:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
