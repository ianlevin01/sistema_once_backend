import { Router } from "express";
import ProductService from "../services/productService.js";
import { upload } from "../middlewares/upload.js";

const router = Router();
const svc = new ProductService();

// Obtener todas las categorías
router.get("/categories", async (req, res) => {
  const result = await svc.getCategories();
  return res.status(200).json(result);
});

// Buscar productos
router.get("/search", async (req, res) => {
  const { name } = req.query;
  const result = await svc.search(name);
  return res.status(200).json(result);
});

// Obtener producto
router.get("/:id", async (req, res) => {
  const result = await svc.getById(req.params.id);
  if (!result) return res.status(404).json({ message: "Producto no encontrado" });
  return res.status(200).json(result);
});

router.get("/", async (req, res) => {
  const { limit = 30, offset = 0, category_id } = req.query;
  const result = await svc.getPaginated(limit, offset, category_id ?? null);
  return res.json(result);
});

// Crear producto
router.post("/", upload.array("images"), async (req, res) => {
  const result = await svc.create(req.body, req.files);
  return res.status(201).json(result);
});

// Modificar producto
router.put("/:id", upload.array("images"), async (req, res) => {
  const result = await svc.update(req.params.id, req.body, req.files);
  return res.status(200).json(result);
});

// Eliminar producto
router.delete("/:id", async (req, res) => {
  await svc.delete(req.params.id);
  return res.status(200).json({ message: "Producto eliminado" });
});

export default router;