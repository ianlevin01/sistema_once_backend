import { Router } from "express";
import ProveedorRepository from "../repositories/proveedorRepository.js";
import pool from "../database/db.js";

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
  const { monto, concepto, metodo_pago, divisa_cobro, cotizacion_manual } = req.body;
  if (!monto || Number(monto) <= 0) {
    return res.status(400).json({ message: "Monto inválido" });
  }
  try {
    const result = await repo.registrarPago(req.params.id, {
      monto:             Number(monto),
      concepto:          concepto || "Pago a proveedor",
      metodo_pago,
      divisa_cobro,
      cotizacion_manual: cotizacion_manual ? Number(cotizacion_manual) : null,
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
  const { monto, concepto, metodo_pago, divisa_cobro, cotizacion_manual } = req.body;
  if (!monto || Number(monto) <= 0) {
    return res.status(400).json({ message: "Monto inválido" });
  }
  try {
    const result = await repo.registrarCobranza(req.params.id, {
      monto:             Number(monto),
      concepto:          concepto || "Cobranza proveedor",
      metodo_pago,
      divisa_cobro,
      cotizacion_manual: cotizacion_manual ? Number(cotizacion_manual) : null,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("POST /proveedores/:id/cobranza:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ─────────────────────────────────────────────────────────────
// Agregar estas rutas al archivo proveedorRoutes.js existente
// (o al archivo donde estén las rutas de proveedores)
// ─────────────────────────────────────────────────────────────

// PUT /proveedores/movimientos/:movId — editar movimiento de proveedor
router.put("/movimientos/:movId", async (req, res) => {
  const { movId } = req.params;
  const { monto, concepto, metodo_pago } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const movRes = await client.query(
      `SELECT m.*, cc.id AS cc_id FROM cc_movimientos_prov m
       JOIN cuentas_corrientes_prov cc ON cc.id = m.cuenta_corriente_id
       WHERE m.id = $1`,
      [movId]
    );
    const mov = movRes.rows[0];
    if (!mov) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Movimiento no encontrado" });
    }

    const montoAnterior = Number(mov.monto);
    const montoNuevo    = monto !== undefined ? Number(monto) : montoAnterior;

    if (montoNuevo !== montoAnterior) {
      const diff = montoNuevo - montoAnterior;
      // Para prov: "pago" = saldo sube (proveedor tiene más crédito), "debito" = saldo baja
      const saldoDelta = mov.tipo === "pago" ? diff : -diff;
      await client.query(
        `UPDATE cuentas_corrientes_prov SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
        [saldoDelta, mov.cc_id]
      );
    }

    const updates = {};
    if (monto       !== undefined) updates.monto       = montoNuevo;
    if (concepto    !== undefined) updates.concepto    = concepto;
    if (metodo_pago !== undefined) updates.metodo_pago = metodo_pago;

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
      await client.query(
        `UPDATE cc_movimientos_prov SET ${setClauses.join(", ")} WHERE id = $1`,
        [movId, ...Object.values(updates)]
      );
    }

    await client.query("COMMIT");

    const ccRes = await client.query(
      `SELECT * FROM cuentas_corrientes_prov WHERE id = $1`, [mov.cc_id]
    );
    return res.status(200).json(ccRes.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error PUT /proveedores/movimientos/:id:", err);
    return res.status(500).json({ message: err.message || "Error interno" });
  } finally {
    client.release();
  }
});

// DELETE /proveedores/movimientos/:movId — eliminar movimiento de proveedor
router.delete("/movimientos/:movId", async (req, res) => {
  const { movId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const movRes = await client.query(
      `SELECT m.*, cc.id AS cc_id FROM cc_movimientos_prov m
       JOIN cuentas_corrientes_prov cc ON cc.id = m.cuenta_corriente_id
       WHERE m.id = $1`,
      [movId]
    );
    const mov = movRes.rows[0];
    if (!mov) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Movimiento no encontrado" });
    }

    // "pago" sumó saldo → al eliminar restar; "debito" restó saldo → al eliminar sumar
    const saldoDelta = mov.tipo === "pago" ? -Number(mov.monto) : Number(mov.monto);
    await client.query(
      `UPDATE cuentas_corrientes_prov SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
      [saldoDelta, mov.cc_id]
    );
    await client.query(`DELETE FROM cc_movimientos_prov WHERE id = $1`, [movId]);

    await client.query("COMMIT");
    return res.status(200).json({ message: "Eliminado" });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ message: "Error interno" });
  } finally {
    client.release();
  }
});

export default router;
