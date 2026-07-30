import { Router } from "express";
import { requireAuth } from "./authRoutes.js";
import whatsAppService from "../services/whatsAppService.js";

const router = Router();

function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== "superadmin") return res.status(403).json({ message: "Solo superadmin" });
  next();
}

// GET /api/whatsapp/status
router.get("/status", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const result = await whatsAppService.getStatus(req.user.negocio_id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/whatsapp/connect
router.post("/connect", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await whatsAppService.startSession(req.user.negocio_id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/whatsapp/qr — devuelve { qrCode: "data:image/png;base64,..." }
router.get("/qr", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const qrCode = await whatsAppService.getQR(req.user.negocio_id);
    return res.json({ qrCode });
  } catch (err) {
    return res.status(503).json({ message: err.message });
  }
});

// POST /api/whatsapp/disconnect
router.post("/disconnect", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await whatsAppService.disconnect(req.user.negocio_id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/whatsapp/features
router.get("/features", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const features = await whatsAppService.getFeatures(req.user.negocio_id);
    return res.json(features);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/whatsapp/send
router.post("/send", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ message: "phone y message son requeridos" });
    await whatsAppService.sendMessage(req.user.negocio_id, phone, message);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[whatsapp] /send error:", err.message);
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/whatsapp/features
router.put("/features", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await whatsAppService.updateFeatures(req.user.negocio_id, req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

export default router;
