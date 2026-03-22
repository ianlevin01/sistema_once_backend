import { Router } from "express";
import ComprobanteService from "../services/comprobanteService.js";

const router = Router();
const svc = new ComprobanteService();

// Crear comprobante
router.post("/", async (req, res) => {
  const { customer_id, user_id, payment_method, items } = req.body;

  if (!customer_id || !user_id || !items) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  const result = await svc.create(req.body);
  return res.status(201).json(result);
});

// Obtener comprobante
router.get("/:id", async (req, res) => {
  const result = await svc.getById(req.params.id);
  if (!result) return res.status(404).json({ message: "No encontrado" });

  return res.status(200).json(result);
});

// Listado con filtros
router.get("/", async (req, res) => {
  const { from, to } = req.query;

  const result = await svc.getAll({ from, to });
  return res.status(200).json(result);
});

// Eliminar
router.delete("/:id", async (req, res) => {
  await svc.delete(req.params.id);
  return res.status(200).json({ message: "Eliminado" });
});

export default router;