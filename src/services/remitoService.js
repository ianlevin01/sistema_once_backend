import pool from "../database/db.js";
import OrderRepository from "../repositories/orderRepository.js";
import OrderItemRepository from "../repositories/orderItemRepository.js";

export default class RemitoService {
  orderRepo = new OrderRepository();
  itemRepo  = new OrderItemRepository();

  // ── Helper: busca el warehouse_id canónico por nombre (case-insensitive) ──
  async #findWarehouseId(client, name) {
    const res = await client.query(
      `SELECT id FROM warehouses WHERE TRIM(name) ILIKE TRIM($1) ORDER BY id LIMIT 1`,
      [name]
    );
    if (!res.rows[0]) {
      console.warn(`[RemitoService] Warehouse no encontrado: "${name}"`);
    }
    return res.rows[0]?.id || null;
  }

  // ── Helper: ajusta stock en un warehouse ──
  async #adjustStock(client, productId, warehouseId, delta) {
    // Asegurar que existe la fila
    await client.query(
      `INSERT INTO stock (product_id, warehouse_id, quantity)
       VALUES ($1, $2, 0)
       ON CONFLICT (product_id, warehouse_id) DO NOTHING`,
      [productId, warehouseId]
    );
    // Aplicar delta; si es negativo nunca baja de 0
    if (delta < 0) {
      await client.query(
        `UPDATE stock
         SET quantity = GREATEST(0, quantity + $1)
         WHERE product_id = $2 AND warehouse_id = $3`,
        [delta, productId, warehouseId]
      );
    } else {
      await client.query(
        `UPDATE stock
         SET quantity = quantity + $1
         WHERE product_id = $2 AND warehouse_id = $3`,
        [delta, productId, warehouseId]
      );
    }
  }

  async createRemito(data) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const total = (data.items || []).reduce(
        (acc, i) => acc + (i.unit_price || 0) * i.quantity, 0
      );

      const order = await this.orderRepo.create({
        customer_id: data.customer_id || null,
        user_id:     null,
        total,
        profit:      0,
        status:      "remito",
        tipo:        "Remito",
        origen:      data.origen    || null,
        destino:     data.destino   || null,
        price_type:  data.price_type || "precio_1",
        vendedor:    data.vendedor  || null,
      }, client);

      for (const item of data.items) {
        await this.itemRepo.create(item, order.id, client);
      }

      const origenId  = await this.#findWarehouseId(client, data.origen);
      const destinoId = await this.#findWarehouseId(client, data.destino);

      for (const item of data.items) {
        if (!item.product_id) continue;

        // ORIGEN: descontar
        if (origenId) {
          await this.#adjustStock(client, item.product_id, origenId, -item.quantity);
        }

        // DESTINO: sumar
        if (destinoId) {
          await this.#adjustStock(client, item.product_id, destinoId, item.quantity);
        }
      }

      await client.query("COMMIT");
      return order;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ── getById con items completos (nombre + código del producto) ────────────
  async getById(id) {
    const { rows } = await pool.query(
      `SELECT
         o.*,
         c.name AS customer_name
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = $1`,
      [id]
    );
    if (!rows[0]) return null;

    const itemsRes = await pool.query(
      `SELECT
         oi.id,
         oi.product_id,
         oi.quantity,
         oi.unit_price,
         oi.cost,
         p.name,
         p.code
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1
       ORDER BY oi.id`,
      [id]
    );

    return { ...rows[0], items: itemsRes.rows };
  }

  getAll({ from, to } = {}) {
    return this.orderRepo.getAllByTipo("Remito", { from, to });
  }

  // ── delete: revierte el stock antes de borrar ─────────────────────────────
  async delete(id) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1) Obtener datos del remito antes de borrar
      const orderRes = await client.query(
        `SELECT origen, destino FROM orders WHERE id = $1`,
        [id]
      );
      const order = orderRes.rows[0];

      // 2) Obtener items
      const itemsRes = await client.query(
        `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
        [id]
      );
      const items = itemsRes.rows;

      // 3) Revertir stock si hay datos de origen/destino
      if (order && items.length > 0) {
        const origenId  = order.origen  ? await this.#findWarehouseId(client, order.origen)  : null;
        const destinoId = order.destino ? await this.#findWarehouseId(client, order.destino) : null;

        for (const item of items) {
          if (!item.product_id) continue;

          // Devolver al origen
          if (origenId) {
            await this.#adjustStock(client, item.product_id, origenId, item.quantity);
          }

          // Quitar del destino
          if (destinoId) {
            await this.#adjustStock(client, item.product_id, destinoId, -item.quantity);
          }
        }
      }

      // 4) Borrar items y orden
      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [id]);
      await client.query(`DELETE FROM orders WHERE id = $1`, [id]);

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
