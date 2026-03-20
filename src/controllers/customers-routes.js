import { Router } from "express";
import CustomerService from "../services/customer-service.js";

const router = Router();
const svc = new CustomerService();

// Buscar clientes por nombre
router.get("/search", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ message: "Nombre requerido" });

  const result = await svc.searchByName(name);
  return res.status(200).json(result);
});

// Obtener cliente por ID
router.get("/:id", async (req, res) => {
  const result = await svc.getById(req.params.id);
  if (!result) return res.status(404).json({ message: "Cliente no encontrado" });

  return res.status(200).json(result);
});

// Crear cliente
router.post("/", async (req, res) => {
  const customer = req.body;

  if (!customer.name) {
    return res.status(400).json({ message: "Nombre requerido" });
  }

  const result = await svc.create(customer);
  return res.status(201).json(result);
});

// Modificar cliente
router.put("/:id", async (req, res) => {
  const result = await svc.update(req.params.id, req.body);
  return res.status(200).json(result);
});

// Eliminar cliente
router.delete("/:id", async (req, res) => {
  await svc.delete(req.params.id);
  return res.status(200).json({ message: "Cliente eliminado" });
});

export default router;