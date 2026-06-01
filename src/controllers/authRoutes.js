import { Router } from "express";
import pool from "../database/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

const router = Router();
const JWT_SECRET    = process.env.JWT_SECRET    || "oncepuntos_secret_dev";
const GOOGLE_CLIENT = process.env.GOOGLE_CLIENT_ID || "";
const googleClient  = new OAuth2Client(GOOGLE_CLIENT);

// Helper: construye el token y la respuesta de usuario
function buildResponse(user) {
  const payload = {
    id:             user.id,
    name:           user.name,
    role:           user.role,
    warehouse_id:   user.warehouse_id,
    warehouse_name: user.warehouse_name,
    pct_vendedor:   user.pct_vendedor ?? 0,
    negocio_id:     user.negocio_id,
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
  return { token, user: payload };
}

// Helper: busca usuario activo por email con su warehouse
async function findUserByEmail(email) {
  const result = await pool.query(
    `SELECT u.*, w.name AS warehouse_name
     FROM users u
     LEFT JOIN warehouses w ON w.id = u.warehouse_id
     WHERE u.email = $1 AND u.active = true
     LIMIT 1`,
    [email.toLowerCase().trim()]
  );
  return result.rows[0] || null;
}

// ── Login email + contraseña ───────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "Email y contraseña requeridos" });

  try {
    const user = await findUserByEmail(email);
    if (!user || !await bcrypt.compare(password, user.password_hash))
      return res.status(401).json({ message: "Credenciales incorrectas" });

    return res.status(200).json(buildResponse(user));
  } catch (err) {
    console.error("POST /auth/login:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── Login con Google ───────────────────────────────────────────
router.post("/google", async (req, res) => {
  const { id_token } = req.body;
  if (!id_token) return res.status(400).json({ message: "Token requerido" });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken:  id_token,
      audience: GOOGLE_CLIENT,
    });
    const { email } = ticket.getPayload();

    const user = await findUserByEmail(email);
    if (!user)
      return res.status(401).json({ message: "Este email no tiene acceso al sistema" });

    return res.status(200).json(buildResponse(user));
  } catch (err) {
    console.error("POST /auth/google:", err);
    return res.status(401).json({ message: "Token de Google inválido" });
  }
});

// ── Middleware: verificar JWT ─────────────────────────────────
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return res.status(401).json({ message: "No autenticado" });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Token inválido o expirado" });
  }
}

router.patch("/pct-vendedor", requireAuth, async (req, res) => {
  const { pct_vendedor } = req.body;
  if (pct_vendedor === undefined || isNaN(Number(pct_vendedor))) {
    return res.status(400).json({ message: "Porcentaje inválido" });
  }
  if (req.user.role !== "vendedor") {
    return res.status(403).json({ message: "Solo vendedores pueden hacer esto" });
  }
  try {
    await pool.query(
      "UPDATE users SET pct_vendedor = $1 WHERE id = $2",
      [Number(pct_vendedor), req.user.id]
    );
    return res.status(200).json({ pct_vendedor: Number(pct_vendedor) });
  } catch (err) {
    console.error("PATCH /me/pct-vendedor:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
