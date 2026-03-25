import { Router } from "express";
import CuentaCorrienteService from "../services/cuentaCorrienteService.js";

const router = Router();
const svc = new CuentaCorrienteService();

// GET todas las cuentas corrientes
router.get("/", async (req, res) => {
  const result = await svc.getAll();
  return res.status(200).json(result);
});

// GET cuenta corriente de un cliente (con movimientos)
router.get("/cliente/:customerId", async (req, res) => {
  const result = await svc.getByCustomer(req.params.customerId);
  if (!result) return res.status(404).json({ message: "Cuenta corriente no encontrada" });
  return res.status(200).json(result);
});

// POST registrar pago
router.post("/cliente/:customerId/pago", async (req, res) => {
  const { monto, concepto } = req.body;
  if (!monto || monto <= 0) return res.status(400).json({ message: "Monto inválido" });
  try {
    const result = await svc.registrarPago(req.params.customerId, { monto, concepto });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

export default router;
