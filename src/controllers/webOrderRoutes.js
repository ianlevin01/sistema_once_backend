import { Router } from "express";
import WebOrderService from "../services/webOrderService.js";
import { requireAuth } from "./authRoutes.js";
import jwt from "jsonwebtoken";

const router = Router();
const svc = new WebOrderService();
const JWT_SECRET = process.env.JWT_SECRET ?? "oncepuntos_secret_dev";

// Extrae customer_id directo del JWT (ya viene dentro del token desde el registro)
function resolveCustomerFromToken(req) {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return null;
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    return payload.customer_id ?? null;
  } catch {
    return null;
  }
}

router.get("/", requireAuth, async (req, res) => {
  const { from, to, color, reservado, search } = req.query;
  const result = await svc.getAll({
    from, to, color,
    reservado: reservado !== undefined ? reservado === "true" : undefined,
    search,
    negocioId: req.user.negocio_id,
  });
  return res.status(200).json(result);
});

router.get("/:id", async (req, res) => {
  const result = await svc.getById(req.params.id);
  if (!result) return res.status(404).json({ message: "Pedido no encontrado" });
  return res.status(200).json(result);
});

router.post("/", async (req, res) => {
  let { customer_id, customer_name, items, negocio_id } = req.body;

  // Intentar resolver desde JWT si no vino en el body
  if (!customer_id) {
    customer_id = resolveCustomerFromToken(req);
  }

  if (!customer_id && !customer_name) {
    return res.status(400).json({
      message: "Se requiere customer_id o datos del cliente (customer_name)",
    });
  }
  if (!items?.length) {
    return res.status(400).json({ message: "Items requeridos" });
  }

  try {
    const result = await svc.create({ ...req.body, customer_id, negocio_id: negocio_id || null });
    return res.status(201).json(result);
  } catch (err) {
    console.error("webOrderRoutes POST error:", err.message);
    return res.status(400).json({ message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const result = await svc.update(req.params.id, req.body);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

router.patch("/:id/color", async (req, res) => {
  const { color } = req.body;
  if (!color) return res.status(400).json({ message: "Color requerido" });
  const result = await svc.setColor(req.params.id, color);
  return res.status(200).json(result);
});

router.patch("/:id/reservado", requireAuth, async (req, res) => {
  const { reservado } = req.body;
  if (reservado === undefined)
    return res.status(400).json({ message: "reservado requerido" });
  const result = await svc.setReservado(req.params.id, reservado, req.user.warehouse_id, req.user.negocio_id);
  return res.status(200).json(result);
});

router.delete("/:id", async (req, res) => {
  await svc.delete(req.params.id);
  return res.status(200).json({ message: "Pedido eliminado" });
});

export default router;
