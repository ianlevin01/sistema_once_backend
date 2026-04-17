// routes/shopAuthRoutes.js
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../database/db.js";
import S3Service from "../services/S3Service.js"; // ajustá el path si es diferente

const s3 = new S3Service(); // mismo path que el resto del proyecto

const router = Router();
const JWT_SECRET  = process.env.JWT_SECRET ?? "oncepuntos_secret_dev";
const SALT_ROUNDS = 10;

// ── Middleware: verificar JWT ─────────────────────────────────────────────────
export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "No autenticado" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Token inválido o expirado" });
  }
}

// ── POST /api/shop/register ───────────────────────────────────────────────────
// Crea solo el shop_user, sin tocar la tabla customers
router.post("/register", async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password)
    return res.status(400).json({ message: "Email y contraseña requeridos" });
  if (password.length < 6)
    return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" });

  const normalizedEmail = email.toLowerCase().trim();
  try {
    const exists = await pool.query(
      "SELECT id FROM public.shop_users WHERE email = $1",
      [normalizedEmail]
    );
    if (exists.rows.length > 0)
      return res.status(409).json({ message: "Ya existe una cuenta con ese email" });

    // Crear o encontrar el customer asociado (type='web', sin CC)
    let customerId = null;
    const existingCust = await pool.query(
      `SELECT id FROM public.customers WHERE email = $1 AND type = 'web' LIMIT 1`,
      [normalizedEmail]
    );
    if (existingCust.rows[0]) {
      customerId = existingCust.rows[0].id;
    } else {
      const newCust = await pool.query(
        `INSERT INTO public.customers (name, email, type) VALUES ($1, $2, 'web') RETURNING id`,
        [name?.trim() || normalizedEmail, normalizedEmail]
      );
      customerId = newCust.rows[0].id;
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO public.shop_users (email, password_hash, name, customer_id)
       VALUES ($1, $2, $3, $4) RETURNING id, email, name`,
      [normalizedEmail, password_hash, name?.trim() ?? null, customerId]
    );

    const user  = result.rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email, customer_id: customerId },
      JWT_SECRET,
      { expiresIn: "30d" }
    );
    return res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── POST /api/shop/login ──────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ message: "Email y contraseña requeridos" });

  try {
    const result = await pool.query(
      "SELECT * FROM public.shop_users WHERE email = $1",
      [email.toLowerCase().trim()]
    );
    const user = result.rows[0];

    if (!user)
      return res.status(401).json({ message: "Email o contraseña incorrectos" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ message: "Email o contraseña incorrectos" });

    const token = jwt.sign(
      { id: user.id, email: user.email, customer_id: user.customer_id },
      JWT_SECRET,
      { expiresIn: "30d" }
    );
    return res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── GET /api/shop/me ──────────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, email, name, created_at FROM public.shop_users WHERE id = $1",
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: "Usuario no encontrado" });
    return res.json(result.rows[0]);
  } catch {
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── GET /api/shop/favorites ───────────────────────────────────────────────────
router.get("/favorites", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT product_id FROM public.favorites WHERE user_id = $1",
      [req.user.id]
    );
    return res.json(result.rows.map((r) => r.product_id));
  } catch {
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── POST /api/shop/favorites/:productId ──────────────────────────────────────
router.post("/favorites/:productId", requireAuth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO public.favorites (user_id, product_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.id, req.params.productId]
    );
    return res.status(201).json({ ok: true });
  } catch {
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── DELETE /api/shop/favorites/:productId ────────────────────────────────────
router.delete("/favorites/:productId", requireAuth, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM public.favorites WHERE user_id = $1 AND product_id = $2",
      [req.user.id, req.params.productId]
    );
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── GET /api/shop/orders ──────────────────────────────────────────────────────
router.get("/orders", requireAuth, async (req, res) => {
  try {
    // Buscar por customer_id del JWT primero, fallback por email
    const customerId = req.user.customer_id;
    const whereClause = customerId
      ? "w.customer_id = $1"
      : "c.email = $1";
    const param = customerId ?? req.user.email;

    const result = await pool.query(
      `SELECT
         w.id, w.total, w.created_at,
         CASE WHEN EXISTS(SELECT 1 FROM public.orders o WHERE o.id = w.order_id AND o.tipo IN ('Presupuesto','Presupuesto Web')) THEN 'completed' ELSE 'pending' END AS status,
         w.observaciones,
         COALESCE(
           (
             SELECT json_agg(
               json_build_object(
                 'product_id', wi.product_id,
                 'name',       wi.name,
                 'quantity',   wi.quantity,
                 'unit_price', wi.unit_price,
                 'image',      (SELECT pi.key FROM product_images pi WHERE pi.product_id = wi.product_id LIMIT 1)
               )
             )
             FROM public.web_order_items wi
             WHERE wi.web_order_id = w.id
           ), '[]'::json
         ) AS items
       FROM public.web_orders w
       LEFT JOIN public.customers c ON c.id = w.customer_id
       WHERE ${whereClause}
       ORDER BY w.created_at DESC`,
      [param]
    );
    // Generar URLs firmadas para las imágenes de cada ítem
    const orders = await Promise.all(
      result.rows.map(async (order) => {
        const items = await Promise.all(
          (order.items ?? []).map(async (item) => {
            let imageUrl = null;
            if (item.image) {
              try { imageUrl = await s3.getSignedUrl(item.image); } catch {}
            }
            return { ...item, image: imageUrl };
          })
        );
        return { ...order, items };
      })
    );

    return res.json(orders);
  } catch (err) {
    console.error("orders error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
