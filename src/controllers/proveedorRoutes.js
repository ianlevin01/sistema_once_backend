import { Router } from "express";
import ProveedorRepository from "../repositories/proveedorRepository.js";

const router = Router();
const repo   = new ProveedorRepository();

// Búsqueda rápida
router.get("/search", async (req, res) => {
  const { q } = req.query;
  if (!q?.trim()) return res.status(200).json([]);
  try {
    const result = await repo.search(q);
    return res.status(200).json(result);
  } catch (err) {
    console.error("GET /proveedores/search:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Listado completo
router.get("/", async (_req, res) => {
  try {
    const result = await repo.getAll();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// Por ID
router.get("/:id", async (req, res) => {
  try {
    const result = await repo.getById(req.params.id);
    if (!result) return res.status(404).json({ message: "No encontrado" });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// Crear
router.post("/", async (req, res) => {
  if (!req.body.name?.trim()) {
    return res.status(400).json({ message: "El nombre es obligatorio" });
  }
  try {
    const result = await repo.create(req.body);
    return res.status(201).json(result);
  } catch (err) {
    console.error("POST /proveedores:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Actualizar
router.put("/:id", async (req, res) => {
  try {
    const result = await repo.update(req.params.id, req.body);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// Eliminar
router.delete("/:id", async (req, res) => {
  try {
    await repo.delete(req.params.id);
    return res.status(200).json({ message: "Eliminado" });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// Cuenta corriente
router.get("/:id/cuenta-corriente", async (req, res) => {
  try {
    const cc   = await repo.getCuentaCorriente(req.params.id);
    const movs = await repo.getMovimientos(req.params.id);
    return res.status(200).json({ cuenta: cc, movimientos: movs });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── Registrar pago al proveedor ───────────────────────────────
// Reduce el saldo a favor (le pagamos lo que le debemos)
router.post("/:id/pago", async (req, res) => {
  const { monto, concepto } = req.body;
  if (!monto || Number(monto) <= 0) {
    return res.status(400).json({ message: "Monto inválido" });
  }
  try {
    const result = await repo.registrarPago(req.params.id, {
      monto:    Number(monto),
      concepto: concepto || "Pago a proveedor",
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("POST /proveedores/:id/pago:", err);
    return res.status(400).json({ message: err.message || "Error interno" });
  }
});

// ── Registrar cobranza del proveedor ─────────────────────────
// También reduce el saldo a favor (nos devuelve dinero / nota de crédito)
router.post("/:id/cobranza", async (req, res) => {
  const { monto, concepto, metodo_pago } = req.body;
  if (!monto || Number(monto) <= 0) {
    return res.status(400).json({ message: "Monto inválido" });
  }
  try {
    const result = await repo.registrarCobranza(req.params.id, {
      monto:      Number(monto),
      concepto:   concepto || "Cobranza proveedor",
      metodo_pago,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("POST /proveedores/:id/cobranza:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
