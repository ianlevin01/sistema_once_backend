import { Router } from "express";
import CashService from "../services/cashService.js";

const router = Router();
const svc = new CashService();

// Crear movimiento
router.post("/", async (req, res) => {
  const { type, amount } = req.body;

  if (!type || !amount) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  const result = await svc.create(req.body);
  return res.status(201).json(result);
});

// Listar
router.get("/", async (req, res) => {
  const result = await svc.getAll();
  return res.status(200).json(result);
});

// Obtener uno
router.get("/:id", async (req, res) => {
  const result = await svc.getById(req.params.id);
  if (!result) return res.status(404).json({ message: "No encontrado" });

  return res.status(200).json(result);
});

export default router;