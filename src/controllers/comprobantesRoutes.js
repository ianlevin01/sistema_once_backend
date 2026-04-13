import { Router } from "express";
import pool from "../database/db.js";
import ComprobanteService from "../services/comprobanteService.js";

const router = Router();
const svc    = new ComprobanteService();

// ── Crear comprobante ─────────────────────────────────────────
router.post("/", async (req, res) => {
  const { items } = req.body;

  const esReposicion      = req.body.tipo === "Reposicion";
  const esConsumidorFinal = !!req.body.es_consumidor_final;

  // Reposicion requiere supplier_id
  if (esReposicion && !req.body.supplier_id) {
    return res.status(400).json({ message: "Datos incompletos: falta supplier_id para Reposicion" });
  }

  // Presupuesto/Devolucion/etc.: requiere customer_id SALVO que sea consumidor final
  if (!esReposicion && !esConsumidorFinal && !req.body.customer_id) {
    return res.status(400).json({ message: "Datos incompletos: falta customer_id" });
  }

  if (!req.body.payment_method || !items?.length) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  try {
    const result = await svc.create(req.body);
    return res.status(201).json(result);
  } catch (err) {
    console.error("Error POST /comprobantes:", err);
    return res.status(500).json({ message: err.message || "Error interno" });
  }
});

// ── Listado agrupado para CajaListado ─────────────────────────
router.get("/listado", async (req, res) => {
  const { from, to } = req.query;
  try {
    const result = await svc.getListado({ from, to });
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error en /comprobantes/listado:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── Último precio de un producto para un cliente ──────────────
// GET /comprobantes/last-price?customer_id=...&product_id=...
router.get("/last-price", async (req, res) => {
  const { customer_id, product_id } = req.query;
  if (!customer_id || !product_id) {
    return res.status(400).json({ message: "customer_id y product_id son requeridos" });
  }
  try {
    const result = await svc.getLastSalePrice(customer_id, product_id);
    return res.status(200).json(result || null);
  } catch (err) {
    console.error("Error GET /comprobantes/last-price:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── Listado de warehouses (para selector en Reposicion) ───────
router.get("/warehouses", async (_req, res) => {
  try {
    const result = await pool.query(`SELECT id, name FROM warehouses ORDER BY name`);
    return res.status(200).json(result.rows);
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── Obtener comprobante por ID ────────────────────────────────
router.get("/:id", async (req, res) => {
  const result = await svc.getById(req.params.id);
  if (!result) return res.status(404).json({ message: "No encontrado" });
  return res.status(200).json(result);
});

// ── Listado con filtros ───────────────────────────────────────
router.get("/", async (req, res) => {
  const { from, to } = req.query;
  const result = await svc.getAll({ from, to });
  return res.status(200).json(result);
});

// ── Eliminar ──────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    await svc.delete(req.params.id);
    return res.status(200).json({ message: "Eliminado" });
  } catch (err) {
    console.error("Error DELETE /comprobantes:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
