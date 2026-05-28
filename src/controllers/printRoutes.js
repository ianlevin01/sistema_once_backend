import { Router } from "express";
import { requireAuth } from "./authRoutes.js";
import { generatePdfFromHtml } from "../services/pdfService.js";

const router = Router();

// POST /api/print/pdf
// Body: { html: string }
// Retorna: PDF binario (application/pdf)
router.post("/pdf", requireAuth, async (req, res) => {
  const { html } = req.body;
  if (!html || typeof html !== "string") {
    return res.status(400).json({ message: "Campo 'html' requerido" });
  }

  try {
    const pdfBuffer = await generatePdfFromHtml(html);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.setHeader("Cache-Control", "no-store");
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("Error generando PDF:", err);
    return res.status(500).json({ message: "Error generando PDF" });
  }
});

export default router;
