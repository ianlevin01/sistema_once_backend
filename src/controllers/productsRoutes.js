import { Router } from "express";
import ProductService from "../services/productService.js";
import { upload } from "../middlewares/upload.js";
import { requireAuth } from "./authRoutes.js";
import jwt from "jsonwebtoken";

const router = Router();
const svc = new ProductService();
const JWT_SECRET = process.env.JWT_SECRET ?? "oncepuntos_secret_dev";

// Middleware para rutas públicas: acepta JWT de staff O negocio_id por query param
function resolveNegocio(req, res, next) {
  const header = req.headers.authorization ?? "";
  if (header.startsWith("Bearer ")) {
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET);
      return next();
    } catch {}
  }
  const negocioId = req.query.negocio_id;
  if (negocioId) {
    req.user = { negocio_id: negocioId };
    return next();
  }
  return res.status(401).json({ message: "Se requiere autenticación o negocio_id" });
}

// Obtener todas las categorías
router.get("/categories", resolveNegocio, async (req, res) => {
  const result = await svc.getCategories(req.user.negocio_id);
  return res.status(200).json(result);
});

// Crear una nueva categoría
router.post("/categories", requireAuth, async (req, res) => {
  const { name, parent_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: "El nombre es obligatorio" });
  const result = await svc.createCategory(name.trim(), parent_id ?? null, req.user.negocio_id);
  return res.status(201).json(result);
});

// Buscar productos
router.get("/search", resolveNegocio, async (req, res) => {
  const { name } = req.query;
  const result = await svc.search(name, req.user.negocio_id);
  return res.status(200).json(result);
});

// Obtener producto por id
router.get("/:id", resolveNegocio, async (req, res) => {
  const result = await svc.getById(req.params.id, req.user.negocio_id);
  if (!result) return res.status(404).json({ message: "Producto no encontrado" });
  return res.status(200).json(result);
});

router.get("/", resolveNegocio, async (req, res) => {
  const { limit = 30, offset = 0, category_id, sort = "default" } = req.query;
  const result = await svc.getPaginated(limit, offset, category_id ?? null, sort, req.user.negocio_id);
  return res.json(result);
});

// Crear producto
router.post("/", requireAuth, upload.array("images"), async (req, res) => {
  try {
    const result = await svc.create(req.body, req.files, req.user.negocio_id);
    return res.status(201).json(result);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ message: "Ya existe un producto con ese código" });
    console.error("Error POST /products:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Modificar producto
router.put("/:id", requireAuth, upload.array("images"), async (req, res) => {
  try {
    const result = await svc.update(req.params.id, req.body, req.files, req.user.negocio_id);
    return res.status(200).json(result);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ message: "Ya existe un producto con ese código" });
    console.error("Error PUT /products:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Eliminar producto
router.delete("/:id", requireAuth, async (req, res) => {
  await svc.delete(req.params.id);
  return res.status(200).json({ message: "Producto eliminado" });
});

export default router;
