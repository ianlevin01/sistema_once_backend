import { Router } from "express";
import pool from "../database/db.js";

const router = Router();

// Listar (con filtro de fechas)
router.get("/", async (req, res) => {
  const { from, to } = req.query;
  let query = `
    SELECT
      tr.*,
      t.codigo       AS transporte_codigo,
      t.razon_social AS transporte_nombre,
      t.domicilio    AS transporte_domicilio,
      t.telefono     AS transporte_telefono,
      t.email        AS transporte_email,
      c.document      AS customer_document,
      c.condicion_iva AS customer_condicion_iva,
      c.domicilio     AS customer_domicilio,
      c.localidad     AS customer_localidad
    FROM transport_remitos tr
    LEFT JOIN transportes t ON t.id = tr.transporte_id
    LEFT JOIN customers   c ON c.id = tr.customer_id
    WHERE 1=1
  `;
  const params = [];
  if (from) { params.push(`${from} 00:00:00`); query += ` AND tr.created_at >= $${params.length}`; }
  if (to)   { params.push(`${to} 23:59:59`);   query += ` AND tr.created_at <= $${params.length}`; }
  query += " ORDER BY tr.created_at DESC";
  try {
    const result = await pool.query(query, params);
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error GET /transport-remitos:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Obtener uno
router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        tr.*,
        t.codigo       AS transporte_codigo,
        t.razon_social AS transporte_nombre,
        t.domicilio    AS transporte_domicilio,
        t.telefono     AS transporte_telefono,
        t.email        AS transporte_email,
        c.document     AS customer_document,
        c.condicion_iva AS customer_condicion_iva
      FROM transport_remitos tr
      LEFT JOIN transportes t ON t.id = tr.transporte_id
      LEFT JOIN customers   c ON c.id = tr.customer_id
      WHERE tr.id = $1
    `, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ message: "No encontrado" });
    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Error GET /transport-remitos/:id:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Crear
router.post("/", async (req, res) => {
  const { customer_id, customer_name, transporte_id, envia, bultos, valor } = req.body;
  if (!transporte_id || !envia || !bultos) {
    return res.status(400).json({ message: "transporte_id, envia y bultos son obligatorios" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO transport_remitos (customer_id, customer_name, transporte_id, envia, bultos, valor)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [customer_id || null, customer_name || null, transporte_id, envia, bultos, valor || null]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /transport-remitos:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Eliminar
router.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM transport_remitos WHERE id=$1", [req.params.id]);
    return res.status(200).json({ message: "Eliminado" });
  } catch (err) {
    console.error("Error DELETE /transport-remitos/:id:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
