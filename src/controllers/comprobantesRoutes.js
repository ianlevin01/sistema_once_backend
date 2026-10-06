import { Router } from "express";
import bcrypt from "bcryptjs";
import pool from "../database/db.js";
import ComprobanteService from "../services/comprobanteService.js";
import ReceiptScanService from "../services/receiptScanService.js";
import S3Service from "../services/S3Service.js";
import { upload } from "../middlewares/upload.js";
import { requireAuth } from "./authRoutes.js";

const router  = Router();
const svc     = new ComprobanteService();
const scanSvc = new ReceiptScanService();
const s3      = new S3Service();

// ── Crear comprobante ─────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const { items } = req.body;
  const esReposicion      = req.body.tipo === "Reposicion";
  const esDevolProv       = req.body.tipo === "Devol a proveedor";
  const esOperProv        = esReposicion || esDevolProv;
  const esConsumidorFinal = !!req.body.es_consumidor_final;

  if (esOperProv && !req.body.supplier_id) {
    return res.status(400).json({ message: "Datos incompletos: falta supplier_id" });
  }
  if (!esOperProv && !esConsumidorFinal && !req.body.customer_id) {
    return res.status(400).json({ message: "Datos incompletos: falta customer_id" });
  }
  if (!req.body.payment_method || !items?.length) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  try {
    const result = await svc.create({
      ...req.body,
      user_id:            req.user.id,
      negocio_id:         req.user.negocio_id,
      created_by_user_id: req.user.id,
      created_by_name:    req.user.name,
    });
    return res.status(201).json(result);
  } catch (err) {
    console.error("Error POST /comprobantes:", err);
    return res.status(500).json({ message: err.message || "Error interno" });
  }
});

// ── Editar comprobante ────────────────────────────────────────
router.put("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!req.body.items?.length) {
    return res.status(400).json({ message: "Se requiere al menos un item" });
  }
  try {
    const result = await svc.update(id, {
      ...req.body,
      edited_by_user_id: req.user.id,
      edited_by_name:    req.user.name,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error PUT /comprobantes/:id:", err);
    return res.status(500).json({ message: err.message || "Error interno" });
  }
});

// ── Listado agrupado para CajaListado ─────────────────────────
// ── Escanear foto de comprobante (IA) ──────────────────────────
// Sube la imagen a S3, la analiza con IA de visión, matchea cada línea
// contra el catálogo (código exacto, o fragmentos del código + verificación
// semántica del nombre) y devuelve los items ya resueltos para precargar
// un comprobante nuevo. No crea el comprobante — eso lo hace el usuario
// después de revisar/completar el resto de los datos.
router.post("/scan", requireAuth, upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Se requiere una imagen" });
  try {
    const imageKey = await s3.upload(req.file, "comprobantes-scans");
    const base64   = req.file.buffer.toString("base64");

    const rawItems            = await scanSvc.analyzeImage(base64, req.file.mimetype);
    const { matched, unmatched } = await scanSvc.matchProducts(rawItems, req.user.negocio_id);

    return res.status(200).json({
      image_key: imageKey,
      image_url: s3.getPublicUrl(imageKey),
      items:     matched,
      unmatched,
    });
  } catch (err) {
    console.error("Error en POST /comprobantes/scan:", err);
    return res.status(500).json({ message: err.message || "Error analizando la imagen" });
  }
});

router.get("/listado", requireAuth, async (req, res) => {
  const { from, to, personal, todo } = req.query;
  const esTodo = todo === "true" && req.user.role === "superadmin";
  const userId = esTodo ? null : (personal === "true" ? req.user.id : null);
  try {
    const result = await svc.getListado({
      from,
      to,
      negocioId:     req.user.negocio_id,
      userId:        userId || null,
      warehouseId:   esTodo ? null : (userId ? null : (req.user.warehouse_id || null)),
      warehouseName: esTodo ? null : (userId ? null : (req.user.warehouse_name || null)),
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("Error en /comprobantes/listado:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── Último precio de un producto para un cliente ──────────────
router.get("/last-price", requireAuth, async (req, res) => {
  const { customer_id, product_id } = req.query;
  if (!customer_id || !product_id) {
    return res.status(400).json({ message: "customer_id y product_id son requeridos" });
  }
  try {
    const result = await svc.getLastSalePrice(customer_id, product_id);
    return res.status(200).json(result || null);
  } catch (err) {
    console.error("Error GET /comprobantes/last-price:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── Listado de warehouses ─────────────────────────────────────
router.get("/warehouses", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name FROM warehouses WHERE negocio_id = $1 AND active = true ORDER BY name`,
      [req.user.negocio_id]
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── Últimas compras (reposiciones de stock) ───────────────────
router.get("/ultimas-compras", requireAuth, async (req, res) => {
  const { from, to } = req.query;
  const result = await svc.getUltimasCompras({ negocioId: req.user.negocio_id, from, to });
  return res.status(200).json(result);
});

// ── Obtener comprobante por ID ────────────────────────────────
router.get("/:id", requireAuth, async (req, res) => {
  const result = await svc.getById(req.params.id);
  if (!result) return res.status(404).json({ message: "No encontrado" });
  return res.status(200).json(result);
});

// ── Listado con filtros ───────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  const { from, to } = req.query;
  const warehouseId = req.user.role === "superadmin" ? null : req.user.warehouse_id;
  const result = await svc.getAll({ from, to, warehouseId, negocioId: req.user.negocio_id });
  return res.status(200).json(result);
});

// ── Eliminar (revierte stock + CC) ───────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: "Se requiere clave para eliminar" });
    const { rows } = await pool.query(
      "SELECT password_hash FROM users WHERE negocio_id = $1 AND active = true AND role = 'superadmin'",
      [req.user.negocio_id]
    );
    if (!rows.length) return res.status(403).json({ message: "No hay superadmin configurado" });
    const valid = (await Promise.all(rows.map((u) => bcrypt.compare(password, u.password_hash)))).some(Boolean);
    if (!valid) return res.status(403).json({ message: "Clave de superadmin incorrecta" });
    await svc.delete(req.params.id, {
      deleted_by_user_id: req.user.id,
      deleted_by_name:    req.user.name,
    });
    return res.status(200).json({ message: "Eliminado" });
  } catch (err) {
    console.error("Error DELETE /comprobantes:", err);
    return res.status(500).json({ message: err.message || "Error interno" });
  }
});

export default router;
