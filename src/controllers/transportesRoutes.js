import { Router } from "express";
import pool from "../database/db.js";

const router = Router();

// Listar todos
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM transportes ORDER BY razon_social"
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error GET /transportes:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Crear
router.post("/", async (req, res) => {
  const { codigo, razon_social, domicilio, telefono, email } = req.body;
  if (!codigo || !razon_social || !telefono) {
    return res.status(400).json({ message: "codigo, razon_social y telefono son obligatorios" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO transportes (codigo, razon_social, domicilio, telefono, email)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [codigo, razon_social, domicilio || null, telefono, email || null]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /transportes:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Editar
router.put("/:id", async (req, res) => {
  const { codigo, razon_social, domicilio, telefono, email } = req.body;
  if (!codigo || !razon_social || !telefono) {
    return res.status(400).json({ message: "codigo, razon_social y telefono son obligatorios" });
  }
  try {
    const result = await pool.query(
      `UPDATE transportes
       SET codigo=$1, razon_social=$2, domicilio=$3, telefono=$4, email=$5
       WHERE id=$6 RETURNING *`,
      [codigo, razon_social, domicilio || null, telefono, email || null, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: "No encontrado" });
    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /transportes/:id:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Eliminar
router.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM transportes WHERE id=$1", [req.params.id]);
    return res.status(200).json({ message: "Eliminado" });
  } catch (err) {
    console.error("Error DELETE /transportes/:id:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
