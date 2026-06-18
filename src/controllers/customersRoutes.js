import { Router } from "express";
import CustomerService from "../services/customerService.js";
import CuentaCorrienteRepository from "../repositories/cuentaCorrienteRepository.js";
import { requireAuth } from "./authRoutes.js";
import pool from "../database/db.js";

const router = Router();
const svc    = new CustomerService();
const ccRepo = new CuentaCorrienteRepository();

// Listar todos los clientes (no web)
router.get("/", requireAuth, async (req, res) => {
  try {
    const result = await svc.getAll(req.user.negocio_id);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// Buscar clientes — ?con_cc=true devuelve solo los que tienen cuenta corriente
router.get("/search", requireAuth, async (req, res) => {
  const { name, con_cc } = req.query;
  if (!name) return res.status(400).json({ message: "Nombre requerido" });
  const result = await svc.searchByName(name, req.user.negocio_id, con_cc === "true");
  return res.status(200).json(result);
});

// Abrir cuenta corriente para un cliente
router.post("/:id/cuenta-corriente", requireAuth, async (req, res) => {
  try {
    const cc = await ccRepo.createCC(req.params.id);
    return res.status(201).json(cc);
  } catch (err) {
    console.error("Error abriendo CC:", err);
    return res.status(500).json({ message: err.message || "Error interno" });
  }
});

// Historial de emails de marketing automático
router.get("/marketing-log", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         eml.id, eml.sent_at, eml.subject, eml.email,
         c.name AS customer_name,
         COALESCE(
           json_agg(json_build_object('name', p.name))
           FILTER (WHERE p.id IS NOT NULL),
           '[]'
         ) AS products
       FROM email_marketing_log eml
       LEFT JOIN customers c ON c.id = eml.customer_id
       LEFT JOIN products p ON p.id = ANY(eml.product_ids)
       WHERE eml.negocio_id = $1
       GROUP BY eml.id, eml.sent_at, eml.subject, eml.email, c.name
       ORDER BY eml.sent_at DESC
       LIMIT 200`,
      [req.user.negocio_id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error GET /customers/marketing-log:", err);
    res.status(500).json({ message: err.message });
  }
});

// Obtener cliente por ID
router.get("/:id", requireAuth, async (req, res) => {
  const result = await svc.getById(req.params.id);
  if (!result) return res.status(404).json({ message: "Cliente no encontrado" });
  return res.status(200).json(result);
});

// Crear cliente
router.post("/", requireAuth, async (req, res) => {
  const customer = req.body;
  if (!customer.name) return res.status(400).json({ message: "Nombre requerido" });
  const result = await svc.create({ ...customer, negocio_id: req.user.negocio_id });
  return res.status(201).json(result);
});

// Modificar cliente
router.put("/:id", requireAuth, async (req, res) => {
  const result = await svc.update(req.params.id, req.body);
  return res.status(200).json(result);
});

// Eliminar cliente
router.delete("/:id", requireAuth, async (req, res) => {
  await svc.delete(req.params.id);
  return res.status(200).json({ message: "Cliente eliminado" });
});

export default router;
