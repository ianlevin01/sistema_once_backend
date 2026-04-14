import { Router } from "express";
import RemitoService from "../services/remitoService.js";
import { requireAuth } from "./authRoutes.js";

const router = Router();
const svc = new RemitoService();

// Crear remito
router.post("/", async (req, res) => {
  const { origen, destino, user_id, price_type, items } = req.body;

  if (!origen || !destino || !items) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  const result = await svc.createRemito(req.body);
  return res.status(201).json(result);
});

// Obtener remito
router.get("/:id", async (req, res) => {
  const result = await svc.getById(req.params.id);
  if (!result) return res.status(404).json({ message: "Remito no encontrado" });

  return res.status(200).json(result);
});

// Listar remitos
router.get("/", requireAuth, async (req, res) => {
  const { from, to } = req.query;
  const result = await svc.getAll({ from, to, warehouseName: req.user.warehouse_name });
  return res.status(200).json(result);
});

// Eliminar remito
router.delete("/:id", async (req, res) => {
  try {
    await svc.delete(req.params.id);
    return res.status(200).json({ message: "Remito eliminado" });
  } catch (err) {
    console.error("Error eliminando remito:", err);
    return res.status(500).json({ message: "Error eliminando remito" });
  }
});

export default router;