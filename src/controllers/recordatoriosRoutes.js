import { Router } from "express";
import jwt from "jsonwebtoken";
import svc from "../services/recordatorioService.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ message: "No autorizado" });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Token inválido" });
  }
}

function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== "superadmin") return res.status(403).json({ message: "Sin permisos" });
  next();
}

// Chequea inactivos y retorna no leídos
router.get("/pendientes", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const rows = await svc.checkAndGetPendientes(req.user.negocio_id, req.user.id);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// Todos (leídos y no leídos)
router.get("/", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const rows = await svc.getAll(req.user.negocio_id, req.user.id);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// Marcar uno como leído
router.post("/:id/leer", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await svc.marcarLeido(req.params.id, req.user.id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// Marcar todos como leídos
router.post("/leer-todos", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await svc.marcarTodosLeidos(req.user.negocio_id, req.user.id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

export default router;
