import pool from "../database/db.js";

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recordatorios (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id      UUID,
      negocio_id       UUID NOT NULL,
      tipo             TEXT NOT NULL,
      mensaje          TEXT,
      last_order_date  TIMESTAMP,
      last_order_total NUMERIC(12,2),
      created_at       TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recordatorio_lecturas (
      recordatorio_id  UUID REFERENCES recordatorios(id) ON DELETE CASCADE,
      user_id          UUID,
      leido_at         TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (recordatorio_id, user_id)
    )
  `);
} catch (err) {
  console.error("[recordatorios] Error al inicializar tablas:", err.message);
}

class RecordatorioService {
  // Detecta clientes inactivos y genera recordatorios nuevos, luego retorna los no leídos
  async checkAndGetPendientes(negocioId, userId) {
    // Clientes con última Nota de Pedido en ARS >= 300k y más de 20 días sin comprar,
    // sin recordatorio generado desde esa última compra
    const { rows: toNotify } = await pool.query(
      `SELECT
         c.id             AS customer_id,
         c.name           AS customer_name,
         last_order.date  AS last_order_date,
         last_order.total AS last_order_total
       FROM customers c
       JOIN LATERAL (
         SELECT o.created_at AS date, o.total
         FROM orders o
         WHERE o.customer_id = c.id
           AND o.negocio_id  = $1
           AND o.deleted_at  IS NULL
           AND o.tipo        IN ('Nota de Pedido', 'Nota de Pedido Web')
           AND o.divisa      = 'ARS'
           AND o.total       >= 300000
         ORDER BY o.created_at DESC
         LIMIT 1
       ) last_order ON true
       WHERE c.negocio_id = $1
         AND last_order.date < NOW() - INTERVAL '20 days'
         AND NOT EXISTS (
           SELECT 1 FROM recordatorios r
           WHERE r.customer_id = c.id
             AND r.negocio_id  = $1
             AND r.created_at  > last_order.date
         )`,
      [negocioId]
    );

    for (const row of toNotify) {
      const dias = Math.floor((Date.now() - new Date(row.last_order_date).getTime()) / 86400000);
      await pool.query(
        `INSERT INTO recordatorios (customer_id, negocio_id, tipo, mensaje, last_order_date, last_order_total)
         VALUES ($1, $2, 'cliente_inactivo', $3, $4, $5)`,
        [
          row.customer_id,
          negocioId,
          `${row.customer_name} lleva ${dias} días sin comprar`,
          row.last_order_date,
          row.last_order_total,
        ]
      );
    }

    // Retorna recordatorios no leídos por este usuario
    const { rows } = await pool.query(
      `SELECT
         r.id,
         r.tipo,
         r.mensaje,
         r.last_order_date,
         r.last_order_total,
         r.created_at,
         c.id   AS customer_id,
         c.name AS customer_name
       FROM recordatorios r
       LEFT JOIN customers c ON c.id = r.customer_id
       WHERE r.negocio_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM recordatorio_lecturas rl
           WHERE rl.recordatorio_id = r.id AND rl.user_id = $2
         )
       ORDER BY r.created_at DESC`,
      [negocioId, userId]
    );

    return rows;
  }

  // Todos los recordatorios (leídos y no leídos) para la página de recordatorios
  async getAll(negocioId, userId) {
    const { rows } = await pool.query(
      `SELECT
         r.id,
         r.tipo,
         r.mensaje,
         r.last_order_date,
         r.last_order_total,
         r.created_at,
         c.id   AS customer_id,
         c.name AS customer_name,
         EXISTS (
           SELECT 1 FROM recordatorio_lecturas rl
           WHERE rl.recordatorio_id = r.id AND rl.user_id = $1
         ) AS leido
       FROM recordatorios r
       LEFT JOIN customers c ON c.id = r.customer_id
       WHERE r.negocio_id = $2
       ORDER BY r.created_at DESC
       LIMIT 100`,
      [userId, negocioId]
    );
    return rows;
  }

  async marcarLeido(recordatorioId, userId) {
    await pool.query(
      `INSERT INTO recordatorio_lecturas (recordatorio_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [recordatorioId, userId]
    );
  }

  async marcarTodosLeidos(negocioId, userId) {
    await pool.query(
      `INSERT INTO recordatorio_lecturas (recordatorio_id, user_id)
       SELECT r.id, $1
       FROM recordatorios r
       WHERE r.negocio_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM recordatorio_lecturas rl
           WHERE rl.recordatorio_id = r.id AND rl.user_id = $1
         )
       ON CONFLICT DO NOTHING`,
      [userId, negocioId]
    );
  }
}

export default new RecordatorioService();
