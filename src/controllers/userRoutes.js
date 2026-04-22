import { Router } from "express";
import pool from "../database/db.js";
import bcrypt from "bcryptjs";
import { requireAuth } from "./authRoutes.js";

const router = Router();

// ── Listar todos los usuarios ─────────────────────────────────
router.get("/", requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at,
              u.warehouse_id, w.name AS warehouse_name
       FROM users u
       LEFT JOIN warehouses w ON w.id = u.warehouse_id
       WHERE u.negocio_id = $1
       ORDER BY u.name`,
      [_req.user.negocio_id]
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("GET /users:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── Crear usuario ─────────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const { name, email, password, role, warehouse_id } = req.body;
  if (!name?.trim())     return res.status(400).json({ message: "Nombre requerido" });
  if (!password?.trim()) return res.status(400).json({ message: "Contraseña requerida" });
  if (!role?.trim())     return res.status(400).json({ message: "Rol requerido" });

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, warehouse_id, active, negocio_id)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       RETURNING id, name, email, role, warehouse_id, active, created_at`,
      [name.trim(), email?.trim() || null, hash, role.trim(), warehouse_id || null, req.user.negocio_id]
    );
    const row = result.rows[0];
    if (row.warehouse_id) {
      const w = await pool.query(`SELECT name FROM warehouses WHERE id = $1`, [row.warehouse_id]);
      row.warehouse_name = w.rows[0]?.name || null;
    }
    return res.status(201).json(row);
  } catch (err) {
    console.error("POST /users:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── Actualizar usuario ────────────────────────────────────────
router.put("/:id", requireAuth, async (req, res) => {
  const { name, email, password, role, warehouse_id, active } = req.body;
  try {
    const params = [];
    let i = 1;

    const sets = [];
    if (name         !== undefined) { sets.push(`name = $${i++}`);         params.push(name); }
    if (email        !== undefined) { sets.push(`email = $${i++}`);        params.push(email || null); }
    if (role         !== undefined) { sets.push(`role = $${i++}`);         params.push(role); }
    if (warehouse_id !== undefined) { sets.push(`warehouse_id = $${i++}`); params.push(warehouse_id || null); }
    if (active       !== undefined) { sets.push(`active = $${i++}`);       params.push(active); }
    if (password?.trim()) {
      const hash = await bcrypt.hash(password, 10);
      sets.push(`password_hash = $${i++}`);
      params.push(hash);
    }

    if (!sets.length) return res.status(400).json({ message: "Nada para actualizar" });

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${i}
       RETURNING id, name, email, role, warehouse_id, active, created_at`,
      params
    );
    if (!result.rows[0]) return res.status(404).json({ message: "Usuario no encontrado" });

    const row = result.rows[0];
    if (row.warehouse_id) {
      const w = await pool.query(`SELECT name FROM warehouses WHERE id = $1`, [row.warehouse_id]);
      row.warehouse_name = w.rows[0]?.name || null;
    }
    return res.status(200).json(row);
  } catch (err) {
    console.error("PUT /users/:id:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── Eliminar usuario ──────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    await pool.query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
    return res.status(200).json({ message: "Eliminado" });
  } catch (err) {
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
