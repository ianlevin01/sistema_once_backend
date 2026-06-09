import { Router } from "express";
import pool from "../database/db.js";
import { requireAuth } from "./authRoutes.js";

const router = Router();

// Listar todos (filtrados por negocio)
router.get("/", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM transportes WHERE negocio_id = $1 ORDER BY razon_social",
      [req.user.negocio_id]
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error GET /transportes:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Crear
router.post("/", requireAuth, async (req, res) => {
  const { codigo, razon_social, domicilio, localidad, telefono, email } = req.body;
  if (!razon_social || !razon_social.trim()) {
    return res.status(400).json({ message: "Nombre (Razón Social) es obligatorio" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO transportes (codigo, razon_social, domicilio, localidad, telefono, email, negocio_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [codigo, razon_social, domicilio || null, localidad || null, telefono, email || null, req.user.negocio_id]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /transportes:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Editar
router.put("/:id", requireAuth, async (req, res) => {
  const { codigo, razon_social, domicilio, localidad, telefono, email } = req.body;
  if (!razon_social || !razon_social.trim()) {
    return res.status(400).json({ message: "Nombre (Razón Social) es obligatorio" });
  }
  try {
    const result = await pool.query(
      `UPDATE transportes
       SET codigo=$1, razon_social=$2, domicilio=$3, localidad=$4, telefono=$5, email=$6
       WHERE id=$7 AND negocio_id=$8 RETURNING *`,
      [codigo, razon_social, domicilio || null, localidad || null, telefono, email || null, req.params.id, req.user.negocio_id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: "No encontrado" });
    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /transportes/:id:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Eliminar
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM transportes WHERE id=$1 AND negocio_id=$2", [req.params.id, req.user.negocio_id]);
    return res.status(200).json({ message: "Eliminado" });
  } catch (err) {
    console.error("Error DELETE /transportes/:id:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
