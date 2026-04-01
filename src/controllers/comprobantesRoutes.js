import { Router } from "express";
import ComprobanteService from "../services/comprobanteService.js";

const router = Router();
const svc = new ComprobanteService();

// ── Crear comprobante ─────────────────────────────────────────
router.post("/", async (req, res) => {
  const { customer_id, payment_method, items } = req.body;

  if (!customer_id || !payment_method || !items?.length) {
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
// IMPORTANTE: este endpoint va ANTES de /:id
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
// Ahora llama al service que maneja stock_reserva correctamente
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
