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
// Body: { customer_id?, customer_name?, customer_email?, customer_phone?, items, observaciones? }
// Si no viene customer_id → se crea un customer nuevo con customer_name/email/phone
router.post("/", async (req, res) => {
  const { customer_id, customer_name, items } = req.body;

  if (!customer_id && !customer_name) {
    return res.status(400).json({ message: "Se requiere customer_id o datos del cliente (customer_name)" });
  }
  if (!items?.length) {
    return res.status(400).json({ message: "Items requeridos" });
  }

  try {
    const result = await svc.create(req.body);
    // Si se creó un customer nuevo, la respuesta incluye new_customer
    // para que el front pueda mostrarle el ID al usuario
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

// PUT editar pedido completo + items
router.put("/:id", async (req, res) => {
  try {
    const result = await svc.update(req.params.id, req.body);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
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
