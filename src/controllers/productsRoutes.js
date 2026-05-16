import { Router } from "express";
import ProductService from "../services/productService.js";
import { upload } from "../middlewares/upload.js";
import { requireAuth } from "./authRoutes.js";
import jwt from "jsonwebtoken";
import pool from "../database/db.js";

const router = Router();
const svc = new ProductService();
const JWT_SECRET = process.env.JWT_SECRET ?? "oncepuntos_secret_dev";

// Middleware para rutas públicas: acepta JWT de staff O negocio_id por query param
function resolveNegocio(req, res, next) {
  const header = req.headers.authorization ?? "";
  if (header.startsWith("Bearer ")) {
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET);
      return next();
    } catch {}
  }
  const negocioId = req.query.negocio_id;
  if (negocioId) {
    req.user = { negocio_id: negocioId };
    return next();
  }
  return res.status(401).json({ message: "Se requiere autenticación o negocio_id" });
}

// Obtener todas las categorías
router.get("/categories", resolveNegocio, async (req, res) => {
  const result = await svc.getCategories(req.user.negocio_id);
  return res.status(200).json(result);
});

// Crear una nueva categoría
router.post("/categories", requireAuth, async (req, res) => {
  const { name, parent_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: "El nombre es obligatorio" });
  const result = await svc.createCategory(name.trim(), parent_id ?? null, req.user.negocio_id);
  return res.status(201).json(result);
});

// Buscar productos
router.get("/search", resolveNegocio, async (req, res) => {
  const { name } = req.query;
  const isShop = !req.user.id; // shop uses ?negocio_id= param, ERP uses JWT (has user.id)
  const result = await svc.search(name, req.user.negocio_id, isShop);
  return res.status(200).json(result);
});

// Agregar stock al warehouse del usuario (solo suma, sin reposición)
router.patch("/:id/stock", requireAuth, async (req, res) => {
  const warehouseId = req.user.warehouse_id;
  if (!warehouseId) {
    return res.status(400).json({ message: "Tu usuario no tiene un depósito asignado. Pedile a un administrador que te asigne uno." });
  }
  const qty = Number(req.body.quantity);
  if (!qty || qty <= 0) return res.status(400).json({ message: "La cantidad debe ser mayor a 0" });

  await pool.query(
    `INSERT INTO stock (product_id, warehouse_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (product_id, warehouse_id)
     DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
    [req.params.id, warehouseId, qty]
  );
  // Track manual adjustment
  await pool.query(
    `INSERT INTO stock_manual_movements (negocio_id, product_id, warehouse_id, delta, source, created_by)
     VALUES ($1, $2, $3, $4, 'manual', $5)`,
    [req.user.negocio_id, req.params.id, warehouseId, qty, req.user.name || null]
  ).catch(() => {}); // non-blocking — don't fail the stock update if tracking fails
  const { rows } = await pool.query(
    `SELECT quantity FROM stock WHERE product_id = $1 AND warehouse_id = $2`,
    [req.params.id, warehouseId]
  );
  return res.json({ quantity: rows[0]?.quantity ?? qty });
});

// Subir producto (actualiza created_at a NOW para que aparezca primero)
router.patch("/:id/subir", requireAuth, async (req, res) => {
  await pool.query("UPDATE products SET created_at = NOW() WHERE id = $1", [req.params.id]);
  return res.status(200).json({ ok: true });
});

// Reordenar productos — guarda el orden via created_at
router.post("/reorder", requireAuth, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "Se requiere un array de ids" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const base = new Date();
    for (let i = 0; i < ids.length; i++) {
      const ts = new Date(base.getTime() - i * 1000).toISOString();
      await client.query(`UPDATE products SET created_at = $1 WHERE id = $2`, [ts, ids[i]]);
    }
    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// ── Price overrides por producto ──────────────────────────────
router.get("/:id/price-overrides", requireAuth, async (req, res) => {
  const result = await svc.getOverride(req.params.id);
  return res.status(200).json(result);
});

router.put("/:id/price-overrides", requireAuth, async (req, res) => {
  try {
    const result = await svc.setOverride(req.params.id, req.body);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.delete("/:id/price-overrides", requireAuth, async (req, res) => {
  await svc.removeOverride(req.params.id);
  return res.status(200).json({ message: "Override eliminado" });
});

// ── Exportar catálogo a Excel ──────────────────────────────────
router.get("/export", requireAuth, async (req, res) => {
  try {
    const buf = await svc.exportToExcel(req.user.negocio_id);
    res.setHeader("Content-Disposition", "attachment; filename=productos.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(buf);
  } catch (err) {
    console.error("Error GET /products/export:", err);
    return res.status(500).json({ message: err.message || "Error generando Excel" });
  }
});

// ── Importar Excel (diff + apply) ─────────────────────────────
router.post("/import", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Se requiere el archivo Excel" });
    const apply         = req.body.apply === "true";
    const includeStock  = req.body.includeStock !== "false";
    const selectedCodes = req.body.selectedCodes
      ? JSON.parse(req.body.selectedCodes)
      : [];
    const result = await svc.importFromExcel(
      req.file.buffer,
      { includeStock, apply, selectedCodes, userName: req.user.name || null },
      req.user.negocio_id
    );
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error POST /products/import:", err);
    return res.status(400).json({ message: err.message || "Error procesando Excel" });
  }
});

// Obtener producto por id
router.get("/:id", resolveNegocio, async (req, res) => {
  const result = await svc.getById(req.params.id, req.user.negocio_id);
  if (!result) return res.status(404).json({ message: "Producto no encontrado" });
  return res.status(200).json(result);
});

router.get("/", resolveNegocio, async (req, res) => {
  const { limit = 30, offset = 0, category_id, sort = "default" } = req.query;
  const result = await svc.getPaginated(limit, offset, category_id ?? null, sort, req.user.negocio_id);
  return res.json(result);
});

// Crear producto
router.post("/", requireAuth, upload.array("images"), async (req, res) => {
  try {
    const result = await svc.create(req.body, req.files, req.user.negocio_id);
    return res.status(201).json(result);
  } catch (err) {
    if (err.code === "DELETED_PRODUCT_CODE") return res.status(409).json({ message: err.message, deleted: true });
    if (err.code === "23505") return res.status(409).json({ message: "Ya existe un producto con ese código" });
    console.error("Error POST /products:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Modificar producto
router.put("/:id", requireAuth, upload.array("images"), async (req, res) => {
  try {
    const result = await svc.update(req.params.id, req.body, req.files, req.user.negocio_id);
    return res.status(200).json(result);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ message: "Ya existe un producto con ese código" });
    console.error("Error PUT /products:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// Eliminar producto
router.delete("/:id", requireAuth, async (req, res) => {
  await svc.delete(req.params.id);
  return res.status(200).json({ message: "Producto eliminado" });
});

export default router;
