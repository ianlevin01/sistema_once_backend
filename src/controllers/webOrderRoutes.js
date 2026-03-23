import { Router } from "express";
import WebOrderService from "../services/webOrderService.js";

const router = Router();
const svc = new WebOrderService();

// GET todos con filtros opcionales
// ?from=YYYY-MM-DD&to=YYYY-MM-DD&color=green&reservado=true&search=juan
router.get("/", async (req, res) => {
  const { from, to, color, reservado, search } = req.query;
  const result = await svc.getAll({
    from,
    to,
    color,
    reservado: reservado !== undefined ? reservado === "true" : undefined,
    search,
  });
  return res.status(200).json(result);
});

// GET por id
router.get("/:id", async (req, res) => {
  const result = await svc.getById(req.params.id);
  if (!result) return res.status(404).json({ message: "Pedido no encontrado" });
  return res.status(200).json(result);
});

// POST crear pedido
router.post("/", async (req, res) => {
  const { customer_name, items } = req.body;
  if (!customer_name) return res.status(400).json({ message: "Nombre de cliente requerido" });
  if (!items?.length)  return res.status(400).json({ message: "Items requeridos" });
  const result = await svc.create(req.body);
  return res.status(201).json(result);
});

// PUT editar pedido completo + items
router.put("/:id", async (req, res) => {
  const result = await svc.update(req.params.id, req.body);
  return res.status(200).json(result);
});

// PATCH color
router.patch("/:id/color", async (req, res) => {
  const { color } = req.body;
  if (!color) return res.status(400).json({ message: "Color requerido" });
  const result = await svc.setColor(req.params.id, color);
  return res.status(200).json(result);
});

// PATCH reservado
router.patch("/:id/reservado", async (req, res) => {
  const { reservado } = req.body;
  if (reservado === undefined) return res.status(400).json({ message: "reservado requerido" });
  const result = await svc.setReservado(req.params.id, reservado);
  return res.status(200).json(result);
});

// DELETE
router.delete("/:id", async (req, res) => {
  await svc.delete(req.params.id);
  return res.status(200).json({ message: "Pedido eliminado" });
});

export default router;
