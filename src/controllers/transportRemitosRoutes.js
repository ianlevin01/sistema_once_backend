import { Router } from "express";
import pool from "../database/db.js";
import { requireAuth } from "./authRoutes.js";

const router = Router();

// Listar (con filtro de fechas y negocio_id)
router.get("/", requireAuth, async (req, res) => {
  const { from, to } = req.query;
  let query = `
    SELECT
      tr.*,
      t.codigo        AS transporte_codigo,
      t.razon_social  AS transporte_nombre,
      t.domicilio     AS transporte_domicilio,
      t.localidad     AS transporte_localidad,
      t.telefono      AS transporte_telefono,
      t.email         AS transporte_email,
      c.document      AS customer_document,
      c.condicion_iva AS customer_condicion_iva,
      c.domicilio     AS customer_domicilio,
      c.localidad     AS customer_localidad,
      c.provincia     AS customer_provincia
    FROM transport_remitos tr
    LEFT JOIN transportes t ON t.id = tr.transporte_id
    LEFT JOIN customers   c ON c.id = tr.customer_id
    WHERE tr.negocio_id = $1
  `;
  const params = [req.user.negocio_id];
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
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        tr.*,
        t.codigo        AS transporte_codigo,
        t.razon_social  AS transporte_nombre,
        t.domicilio     AS transporte_domicilio,
        t.localidad     AS transporte_localidad,
        t.telefono      AS transporte_telefono,
        t.email         AS transporte_email,
        c.document      AS customer_document,
        c.condicion_iva AS customer_condicion_iva,
        c.domicilio     AS customer_domicilio,
        c.localidad     AS customer_localidad,
        c.provincia     AS customer_provincia
      FROM transport_remitos tr
      LEFT JOIN transportes t ON t.id = tr.transporte_id
      LEFT JOIN customers   c ON c.id = tr.customer_id
      WHERE tr.id = $1 AND tr.negocio_id = $2
    `, [req.params.id, req.user.negocio_id]);
    if (!result.rows[0]) return res.status(404).json({ message: "No encontrado" });
    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Error GET /transport-remitos/:id:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Crear
router.post("/", requireAuth, async (req, res) => {
  const { customer_id, customer_name, transporte_id, envia, bultos, valor } = req.body;
  if (!envia || !bultos) {
    return res.status(400).json({ message: "envia y bultos son obligatorios" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO transport_remitos (customer_id, customer_name, transporte_id, envia, bultos, valor, negocio_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [customer_id || null, customer_name || null, transporte_id || null, envia, bultos, valor || null, req.user.negocio_id]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /transport-remitos:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Eliminar
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM transport_remitos WHERE id=$1 AND negocio_id=$2", [req.params.id, req.user.negocio_id]);
    return res.status(200).json({ message: "Eliminado" });
  } catch (err) {
    console.error("Error DELETE /transport-remitos/:id:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
