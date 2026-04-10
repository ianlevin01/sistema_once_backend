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
      const nueva = await svc.getOrCreate(req.params.customerId);
      return res.status(200).json({ ...nueva, movimientos: [] });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error en GET /cuenta-corriente/cliente/:id:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST registrar pago (legacy)
router.post("/cliente/:customerId/pago", async (req, res) => {
  const { monto, concepto } = req.body;
  if (!monto || Number(monto) <= 0)
    return res.status(400).json({ message: "Monto inválido" });
  try {
    const result = await svc.registrarPago(req.params.customerId, {
      monto: Number(monto),
      concepto,
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

// POST agregar saldo a favor (legacy)
router.post("/cliente/:customerId/saldo", async (req, res) => {
  const { monto, concepto } = req.body;
  if (!monto || Number(monto) <= 0)
    return res.status(400).json({ message: "Monto inválido" });
  try {
    const result = await svc.agregarSaldo(req.params.customerId, {
      monto: Number(monto),
      concepto,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error en POST /cuenta-corriente/cliente/:id/saldo:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST registrar cobranza
// Body: { monto, concepto?, metodo_pago, divisa_cobro? }
// divisa_cobro: 'ARS' | 'USD' — en qué moneda pagó el cliente físicamente
//               Si se omite, se asume la divisa de la cuenta
router.post("/cliente/:customerId/cobranza", async (req, res) => {
  const { monto, concepto, metodo_pago, divisa_cobro } = req.body;
  if (!monto || Number(monto) <= 0)
    return res.status(400).json({ message: "Monto inválido" });
  if (!metodo_pago)
    return res.status(400).json({ message: "Método de pago obligatorio" });
  try {
    const result = await svc.registrarCobranza(req.params.customerId, {
      monto:       Number(monto),
      concepto:    concepto || "Cobranza",
      metodo_pago,
      divisa_cobro: divisa_cobro || null,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error en POST /cuenta-corriente/cliente/:id/cobranza:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET cobranzas por rango de fecha (para CajaListado)
router.get("/cobranzas", async (req, res) => {
  const { from, to } = req.query;
  try {
    const result = await svc.getCobranzas(from, to);
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error en GET /cuenta-corriente/cobranzas:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
