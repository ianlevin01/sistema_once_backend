import { Router } from "express";
import CuentaCorrienteService from "../services/cuentaCorrienteService.js";

const router = Router();
const svc = new CuentaCorrienteService();

// GET todas las cuentas corrientes
router.get("/", async (req, res) => {
  try {
    const result = await svc.getAll();
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error en GET /cuenta-corriente:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET cuenta corriente de un cliente (con movimientos)
router.get("/cliente/:customerId", async (req, res) => {
  try {
    const result = await svc.getByCustomer(req.params.customerId);
    if (!result) {
      // Si no existe aún, crear y devolver vacía
      const nueva = await svc.getOrCreate(req.params.customerId);
      return res.status(200).json({ ...nueva, movimientos: [] });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error en GET /cuenta-corriente/cliente/:id:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST registrar pago
router.post("/cliente/:customerId/pago", async (req, res) => {
  const { monto, concepto } = req.body;
  if (!monto || Number(monto) <= 0) return res.status(400).json({ message: "Monto inválido" });
  try {
    const result = await svc.registrarPago(req.params.customerId, { monto: Number(monto), concepto });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

// POST agregar saldo a favor
router.post("/cliente/:customerId/saldo", async (req, res) => {
  const { monto, concepto } = req.body;
  if (!monto || Number(monto) <= 0) return res.status(400).json({ message: "Monto inválido" });
  try {
    const result = await svc.agregarSaldo(req.params.customerId, { monto: Number(monto), concepto });
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error en POST /cuenta-corriente/cliente/:id/saldo:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
