import { Router } from "express";
import CashService from "../services/cashService.js";
import { requireAuth } from "./authRoutes.js";

const router = Router();
const svc = new CashService();

// Crear movimiento
router.post("/", requireAuth, async (req, res) => {
  const { type, amount } = req.body;

  if (!type || !amount) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  const result = await svc.create(req.body, req.user.warehouse_id, req.user.negocio_id);
  return res.status(201).json(result);
});

// Listar
router.get("/", requireAuth, async (req, res) => {
  const { from, to } = req.query;
  const warehouseId = req.user.role === "superadmin" ? null : req.user.warehouse_id;
  const result = await svc.getAll({ from, to, warehouseId, negocioId: req.user.negocio_id });
  return res.status(200).json(result);
});

// Obtener uno
router.get("/:id", requireAuth, async (req, res) => {
  const result = await svc.getById(req.params.id);
  if (!result) return res.status(404).json({ message: "No encontrado" });

  return res.status(200).json(result);
});

export default router;
