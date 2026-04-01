import pool from "../database/db.js";
import OrderRepository from "../repositories/orderRepository.js";
import OrderItemRepository from "../repositories/orderItemRepository.js";

export default class RemitoService {
  orderRepo = new OrderRepository();
  itemRepo  = new OrderItemRepository();

  async createRemito(data) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // ── Calcular total ───────────────────────────────────────────────────
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
        origen:      data.origen  || null,
        destino:     data.destino || null,
        price_type:  data.price_type || "precio_1",
        vendedor:    data.vendedor   || null,
      }, client);

      for (const item of data.items) {
        await this.itemRepo.create(item, order.id, client);
      }

      // ── Ajustar stock por warehouse ──────────────────────────────────────
      // Buscar el warehouse_id de origen y destino por nombre
      const origenRes = await client.query(
        `SELECT id FROM warehouses WHERE name = $1 LIMIT 1`,
        [data.origen]
      );
      const destinoRes = await client.query(
        `SELECT id FROM warehouses WHERE name = $1 LIMIT 1`,
        [data.destino]
      );

      const origenId  = origenRes.rows[0]?.id  || null;
      const destinoId = destinoRes.rows[0]?.id || null;

      for (const item of data.items) {
        if (!item.product_id) continue;

        // Decrementar stock en el warehouse ORIGEN
        if (origenId) {
          // Upsert: si no existe la fila de stock, la crea con 0 y luego resta
          await client.query(
            `INSERT INTO stock (product_id, warehouse_id, quantity)
             VALUES ($1, $2, 0)
             ON CONFLICT (product_id, warehouse_id) DO NOTHING`,
            [item.product_id, origenId]
          );
          await client.query(
            `UPDATE stock
             SET quantity = GREATEST(0, quantity - $1)
             WHERE product_id = $2 AND warehouse_id = $3`,
            [item.quantity, item.product_id, origenId]
          );
        }

        // Incrementar stock en el warehouse DESTINO
        if (destinoId) {
          await client.query(
            `INSERT INTO stock (product_id, warehouse_id, quantity)
             VALUES ($1, $2, 0)
             ON CONFLICT (product_id, warehouse_id) DO NOTHING`,
            [item.product_id, destinoId]
          );
          await client.query(
            `UPDATE stock
             SET quantity = quantity + $1
             WHERE product_id = $2 AND warehouse_id = $3`,
            [item.quantity, item.product_id, destinoId]
          );
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

  getById(id) {
    return this.orderRepo.getById(id);
  }

  getAll({ from, to } = {}) {
    return this.orderRepo.getAllByTipo("Remito", { from, to });
  }

  async delete(id) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
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
