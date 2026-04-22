import { Router } from "express";
import pool from "../database/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "oncepuntos_secret_dev";

// ── Login ─────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ message: "Contraseña requerida" });

  try {
    // Buscar usuario por contraseña hasheada
    const result = await pool.query(
      `SELECT u.*, w.name AS warehouse_name
       FROM users u
       LEFT JOIN warehouses w ON w.id = u.warehouse_id
       WHERE u.active = true
       ORDER BY u.name`,
    );

    // Verificar contra cada usuario activo
    let matchedUser = null;
    for (const user of result.rows) {
      if (user.password_hash && await bcrypt.compare(password, user.password_hash)) {
        matchedUser = user;
        break;
      }
    }

    if (!matchedUser) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }

    const token = jwt.sign(
      {
        id:             matchedUser.id,
        name:           matchedUser.name,
        role:           matchedUser.role,
        warehouse_id:   matchedUser.warehouse_id,
        warehouse_name: matchedUser.warehouse_name,
        pct_vendedor:   matchedUser.pct_vendedor ?? 0,
        negocio_id:     matchedUser.negocio_id,
      },
      JWT_SECRET,
      { expiresIn: "12h" }
    );

    return res.status(200).json({
      token,
      user: {
        id:             matchedUser.id,
        name:           matchedUser.name,
        role:           matchedUser.role,
        warehouse_id:   matchedUser.warehouse_id,
        warehouse_name: matchedUser.warehouse_name,
        pct_vendedor:   matchedUser.pct_vendedor ?? 0,
        negocio_id:     matchedUser.negocio_id,
      },
    });
  } catch (err) {
    console.error("POST /auth/login:", err);
    return res.status(500).json({ message: "Error interno" });
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
