import { Router } from "express";
import ProductService from "../services/product-service.js";

const router = Router();
const svc = new ProductService();

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

// Crear producto
router.post("/", async (req, res) => {
  const result = await svc.create(req.body);
  return res.status(201).json(result);
});

// Modificar producto
router.put("/:id", async (req, res) => {
  const result = await svc.update(req.params.id, req.body);
  return res.status(200).json(result);
});

// Eliminar producto
router.delete("/:id", async (req, res) => {
  await svc.delete(req.params.id);
  return res.status(200).json({ message: "Producto eliminado" });
});

export default router;