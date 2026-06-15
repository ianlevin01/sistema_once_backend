import { Router } from "express";
import { requireAuth } from "./authRoutes.js";
import AIAgentService from "../services/ai/aiAgentService.js";
import AIPermissionRepository from "../repositories/aiPermissionRepository.js";

const router   = Router();
const svc      = new AIAgentService();
const permRepo = new AIPermissionRepository();

const VALID_SECTIONS = [
  "comprobantes", "cuenta_corriente", "clientes", "productos",
  "stock", "proveedores", "vendedores", "usuarios", "caja", "remitos",
];

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin" && req.user?.role !== "superadmin") {
    return res.status(403).json({ message: "Acceso solo para administradores" });
  }
  return next();
}

// Enviar mensaje al agente
router.post("/chat", requireAuth, requireAdmin, async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ message: "Se requiere el array messages" });
  }
  try {
    const ctx = {
      negocioId:   req.user.negocio_id,
      warehouseId: req.user.warehouse_id || null,
      userName:    req.user.name || null,
    };
    const result = await svc.chat(messages, ctx);
    return res.json(result);
  } catch (err) {
    console.error("[aiAgentRoutes] Error:", err.message);
    return res.status(500).json({ message: "Error en el asistente de IA" });
  }
});

// Obtener permisos del asistente
router.get("/permissions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const perms = await permRepo.getByNegocio(req.user.negocio_id);
    return res.json(perms);
  } catch (err) {
    return res.status(500).json({ message: "Error obteniendo permisos" });
  }
});

// Actualizar permiso de una sección
router.put("/permissions/:section", requireAuth, requireAdmin, async (req, res) => {
  const { section } = req.params;
  if (!VALID_SECTIONS.includes(section)) {
    return res.status(400).json({ message: "Sección inválida" });
  }
  const { can_read, can_create, can_edit, can_delete } = req.body;
  try {
    await permRepo.upsert(req.user.negocio_id, section, { can_read, can_create, can_edit, can_delete });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Error actualizando permiso" });
  }
});

export default router;
