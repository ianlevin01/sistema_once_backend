import { Router } from "express";
import { requireAuth } from "./authRoutes.js";
import { runBackup } from "../services/backupService.js";

const router = Router();

// POST /api/backup/run  — dispara el backup manualmente (solo admins)
router.post("/run", requireAuth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Solo admins pueden ejecutar el backup" });
  }
  // Responde inmediato y corre el backup en background
  res.json({ message: "Backup iniciado. Revisá los logs del servidor para ver el resultado." });
  runBackup();
});

export default router;
