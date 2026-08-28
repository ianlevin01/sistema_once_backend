import { Router } from "express";
import jwt from "jsonwebtoken";
import ProductVariantsService from "../services/productVariantsService.js";

const router = Router({ mergeParams: true });
const svc = new ProductVariantsService();

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No autenticado" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Token inválido" });
  }
}

// GET /api/products/:productId/variants
router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await svc.getByProduct(req.params.productId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/products/:productId/variants  { tipo: "color"|"talle", ...fields }
router.post("/", requireAuth, async (req, res) => {
  try {
    const { tipo, ...fields } = req.body;
    let variant;
    if (tipo === "color") {
      variant = await svc.addColor(req.params.productId, fields);
    } else if (tipo === "tamaño") {
      variant = await svc.addTamanio(req.params.productId, fields);
    } else {
      return res.status(400).json({ message: "tipo debe ser 'color' o 'tamaño'" });
    }
    res.status(201).json(variant);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/products/:productId/variants/:id
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    await svc.delete(Number(req.params.id), req.params.productId);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
});

export default router;
