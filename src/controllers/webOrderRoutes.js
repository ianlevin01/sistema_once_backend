import { Router } from "express";
import WebOrderService from "../services/webOrderService.js";
import { requireAuth } from "./authRoutes.js";
import jwt from "jsonwebtoken";
import pool from "../database/db.js";

const router = Router();
const svc = new WebOrderService();
const JWT_SECRET = process.env.JWT_SECRET ?? "oncepuntos_secret_dev";

// Extrae customer_id del JWT. Si no existe, crea un customer automáticamente.
async function resolveCustomerFromToken(req) {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return null;
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    if (payload.customer_id) return payload.customer_id;

    // customer_id null en el token → buscar en shop_users
    if (payload.id) {
      const res = await pool.query(
        `SELECT customer_id FROM shop_users WHERE id = $1`, [payload.id]
      );
      let customerId = res.rows[0]?.customer_id;

      // Si aún no hay customer_id, crear uno nuevo
      if (!customerId) {
        const shopUser = await pool.query(
          `SELECT email, name FROM shop_users WHERE id = $1`, [payload.id]
        );
        if (shopUser.rows[0]) {
          const { email, name } = shopUser.rows[0];
          const newCust = await pool.query(
            `INSERT INTO customers (name, email, type) VALUES ($1, $2, 'web') RETURNING id`,
            [name || email, email]
          );
          customerId = newCust.rows[0].id;
          // Actualizar shop_users con el nuevo customer_id
          await pool.query(
            `UPDATE shop_users SET customer_id = $1 WHERE id = $2`,
            [customerId, payload.id]
          );
        }
      }
      return customerId;
    }
    return null;
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

  const hasAuthHeader = !!req.headers.authorization;
  console.log("[WEB-ORDER POST] Inicio - hasAuth:", hasAuthHeader, "customer_id en body:", !!customer_id, "customer_name en body:", !!customer_name);

  // Intentar resolver desde JWT si no vino en el body
  if (!customer_id) {
    customer_id = await resolveCustomerFromToken(req);
    console.log("[WEB-ORDER POST] Después resolveCustomerFromToken - customer_id:", !!customer_id, "hasAuth:", hasAuthHeader);
  }

  // Si tiene header de Auth pero NO tiene customer_id → sesión inválida
  if (hasAuthHeader && !customer_id && !customer_name) {
    console.error("[WEB-ORDER ERROR] Usuario logueado sin customer_id - debe reiniciar sesión");
    return res.status(401).json({
      message: "Sesión expirada. Por favor, inicia sesión nuevamente.",
      code: "SESSION_EXPIRED",
    });
  }

  // Si no tiene auth ni customer_id/name → necesita datos del cliente
  if (!customer_id && !customer_name) {
    console.error("[WEB-ORDER ERROR] Sin customer_id ni customer_name");
    return res.status(400).json({
      message: "Se requiere customer_id o datos del cliente (customer_name)",
    });
  }

  if (!items?.length) {
    return res.status(400).json({ message: "Items requeridos" });
  }

  try {
    const result = await svc.create({ ...req.body, customer_id, negocio_id: negocio_id || null });
    console.log("[WEB-ORDER SUCCESS] Pedido creado - customer_id:", !!customer_id);
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
