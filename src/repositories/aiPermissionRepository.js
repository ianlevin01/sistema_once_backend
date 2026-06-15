import pool from "../database/db.js";

export default class AIPermissionRepository {
  async getByNegocio(negocioId) {
    const { rows } = await pool.query(
      `SELECT section, can_read, can_create, can_edit, can_delete
       FROM ai_permissions WHERE negocio_id = $1`,
      [negocioId]
    );
    return rows;
  }

  async upsert(negocioId, section, perms) {
    await pool.query(
      `INSERT INTO ai_permissions (negocio_id, section, can_read, can_create, can_edit, can_delete)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (negocio_id, section) DO UPDATE SET
         can_read   = EXCLUDED.can_read,
         can_create = EXCLUDED.can_create,
         can_edit   = EXCLUDED.can_edit,
         can_delete = EXCLUDED.can_delete`,
      [
        negocioId,
        section,
        perms.can_read   ?? false,
        perms.can_create ?? false,
        perms.can_edit   ?? false,
        perms.can_delete ?? false,
      ]
    );
  }
}
