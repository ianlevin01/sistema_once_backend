import { Router } from "express";
import VendedorService from "../services/vendedorService.js";
import { requireAuth } from "./authRoutes.js";

const router = Router();
const svc = new VendedorService();

// GET todos los vendedores (con total_ventas)
router.get("/", requireAuth, async (req, res) => {
  try {
    const result = await svc.getAll(req.user.negocio_id);
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error en GET /vendedores:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET solo activos — para selects en formularios
router.get("/activos", requireAuth, async (req, res) => {
  try {
    const result = await svc.getActivos(req.user.negocio_id);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET por ID
router.get("/:id", requireAuth, async (req, res) => {
  const result = await svc.getById(req.params.id);
  if (!result) return res.status(404).json({ message: "Vendedor no encontrado" });
  return res.status(200).json(result);
});

// POST crear
router.post("/", requireAuth, async (req, res) => {
  const { nombre, email } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ message: "El nombre es obligatorio" });
  try {
    const result = await svc.create({
      nombre: nombre.trim(),
      email,
      negocio_id: req.user.negocio_id,
    });
    return res.status(201).json(result);
  } catch (err) {
    console.error("Error en POST /vendedores:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT actualizar
router.put("/:id", requireAuth, async (req, res) => {
  const { nombre, email, activo } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ message: "El nombre es obligatorio" });
  try {
    const result = await svc.update(req.params.id, { nombre: nombre.trim(), email, activo });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// DELETE
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    await svc.delete(req.params.id);
    return res.status(200).json({ message: "Vendedor eliminado" });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
