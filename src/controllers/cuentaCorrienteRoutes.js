import { Router } from "express";
import pool from "../database/db.js";
import CuentaCorrienteService from "../services/cuentaCorrienteService.js";
import { requireAuth } from "./authRoutes.js";

const router = Router();
const svc = new CuentaCorrienteService();

// GET todas las cuentas corrientes
router.get("/", requireAuth, async (req, res) => {
  try {
    const result = await svc.getAll(req.user.negocio_id);
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error en GET /cuenta-corriente:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// GET cuenta corriente de un cliente (con movimientos)
router.get("/cliente/:customerId", requireAuth, async (req, res) => {
  try {
    const result = await svc.getByCustomer(req.params.customerId);
    if (!result) return res.status(404).json({ message: "Sin cuenta corriente" });
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error en GET /cuenta-corriente/cliente/:id:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST registrar pago (legacy)
router.post("/cliente/:customerId/pago", requireAuth, async (req, res) => {
  const { monto, concepto } = req.body;
  if (!monto || Number(monto) <= 0)
    return res.status(400).json({ message: "Monto inválido" });
  try {
    const result = await svc.registrarPago(req.params.customerId, {
      monto: Number(monto), concepto,
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

// POST agregar saldo a favor (legacy)
router.post("/cliente/:customerId/saldo", requireAuth, async (req, res) => {
  const { monto, concepto } = req.body;
  if (!monto || Number(monto) <= 0)
    return res.status(400).json({ message: "Monto inválido" });
  try {
    const result = await svc.agregarSaldo(req.params.customerId, {
      monto: Number(monto), concepto,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error en POST /cuenta-corriente/cliente/:id/saldo:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// POST registrar cobranza
router.post("/cliente/:customerId/cobranza", requireAuth, async (req, res) => {
  const { monto, concepto, metodo_pago, divisa_cobro, cotizacion_manual } = req.body;
  if (!monto || Number(monto) <= 0)
    return res.status(400).json({ message: "Monto inválido" });
  if (!metodo_pago)
    return res.status(400).json({ message: "Método de pago obligatorio" });
  try {
    const result = await svc.registrarCobranza(req.params.customerId, {
      monto:            Number(monto),
      concepto:         concepto || "Cobranza",
      metodo_pago,
      divisa_cobro:     divisa_cobro || null,
      cotizacion_manual: cotizacion_manual ? Number(cotizacion_manual) : null,
      negocio_id:       req.user.negocio_id,
      warehouse_id:     req.user.warehouse_id || null,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error en POST /cuenta-corriente/cliente/:id/cobranza:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// PUT /movimientos/:movId  — editar un movimiento de cliente
router.put("/movimientos/:movId", requireAuth, async (req, res) => {
  const { movId } = req.params;
  const { monto, concepto, metodo_pago } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const movRes = await client.query(
      `SELECT m.*, cc.divisa AS divisa_cuenta, cc.id AS cc_id, cc.saldo AS cc_saldo
       FROM cc_movimientos m
       JOIN cuentas_corrientes cc ON cc.id = m.cuenta_corriente_id
       WHERE m.id = $1`,
      [movId]
    );
    const mov = movRes.rows[0];
    if (!mov) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Movimiento no encontrado" });
    }

    const montoAnterior = Number(mov.monto);
    let montoNuevo = monto !== undefined ? Number(monto) : montoAnterior;

    if (montoNuevo !== montoAnterior) {
      const diff = montoNuevo - montoAnterior;
      const saldoDelta = mov.tipo === "debito" ? diff : -diff;

      await client.query(
        `UPDATE cuentas_corrientes SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
        [saldoDelta, mov.cc_id]
      );
    }

    const updates = {};
    if (monto      !== undefined) updates.monto      = montoNuevo;
    if (concepto   !== undefined) updates.concepto   = concepto;
    if (metodo_pago !== undefined) updates.metodo_pago = metodo_pago;

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
      await client.query(
        `UPDATE cc_movimientos SET ${setClauses.join(", ")} WHERE id = $1`,
        [movId, ...Object.values(updates)]
      );
    }

    await client.query("COMMIT");

    const ccRes = await client.query(
      `SELECT cc.*, c.name AS customer_name FROM cuentas_corrientes cc
       JOIN customers c ON c.id = cc.customer_id WHERE cc.id = $1`,
      [mov.cc_id]
    );
    return res.status(200).json(ccRes.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error PUT /cuenta-corriente/movimientos/:id:", err);
    return res.status(500).json({ message: err.message || "Error interno" });
  } finally {
    client.release();
  }
});

// DELETE /movimientos/:movId — eliminar movimiento de cliente
router.delete("/movimientos/:movId", requireAuth, async (req, res) => {
  const { movId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const movRes = await client.query(
      `SELECT m.*, cc.id AS cc_id FROM cc_movimientos m
       JOIN cuentas_corrientes cc ON cc.id = m.cuenta_corriente_id
       WHERE m.id = $1`,
      [movId]
    );
    const mov = movRes.rows[0];
    if (!mov) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Movimiento no encontrado" });
    }

    const saldoDelta = mov.tipo === "debito" ? -Number(mov.monto) : Number(mov.monto);
    await client.query(
      `UPDATE cuentas_corrientes SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
      [saldoDelta, mov.cc_id]
    );
    await client.query(`DELETE FROM cc_movimientos WHERE id = $1`, [movId]);

    await client.query("COMMIT");
    return res.status(200).json({ message: "Eliminado" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error DELETE /cuenta-corriente/movimientos/:id:", err);
    return res.status(500).json({ message: "Error interno" });
  } finally {
    client.release();
  }
});

// GET cobranzas por rango de fecha
router.get("/cobranzas", requireAuth, async (req, res) => {
  const { from, to } = req.query;
  try {
    const result = await svc.getCobranzas(from, to, req.user.negocio_id);
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error en GET /cuenta-corriente/cobranzas:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
