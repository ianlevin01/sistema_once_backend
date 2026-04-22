import pool from "../database/db.js";
import OrderRepository from "../repositories/orderRepository.js";
import OrderItemRepository from "../repositories/orderItemRepository.js";

export default class RemitoService {
  orderRepo = new OrderRepository();
  itemRepo  = new OrderItemRepository();

  async #findWarehouseId(client, name, negocioId) {
    const res = await client.query(
      `SELECT id FROM warehouses WHERE TRIM(name) ILIKE TRIM($1) AND negocio_id = $2 ORDER BY id LIMIT 1`,
      [name, negocioId]
    );
    if (!res.rows[0]) {
      console.warn(`[RemitoService] Warehouse no encontrado: "${name}"`);
    }
    return res.rows[0]?.id || null;
  }

  // ── Helper: ajusta stock en un warehouse, permite negativos ──
  // El stock de remitos no tiene piso en 0 — si salen más de lo que hay
  // el número queda negativo (deuda de mercadería), y al revertir
  // vuelve exactamente al valor anterior.
  async #adjustStock(client, productId, warehouseId, delta) {
    await client.query(
      `INSERT INTO stock (product_id, warehouse_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (product_id, warehouse_id)
       DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
      [productId, warehouseId, delta]
    );
  }

  async createRemito(data) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const total = (data.items || []).reduce(
        (acc, i) => acc + (i.unit_price || 0) * i.quantity, 0
      );

      const order = await this.orderRepo.create({
        customer_id:  data.customer_id  || null,
        user_id:      data.user_id      || null,
        warehouse_id: data.warehouse_id || null,
        total,
        profit:      0,
        status:      "remito",
        tipo:        "Remito",
        origen:      data.origen    || null,
        destino:     data.destino   || null,
        price_type:  data.price_type || "precio_1",
        vendedor:    data.vendedor  || null,
        negocio_id:  data.negocio_id || null,
      }, client);

      for (const item of data.items) {
        await this.itemRepo.create(item, order.id, client);
      }

      const negocioId = data.negocio_id;
      const origenId  = await this.#findWarehouseId(client, data.origen, negocioId);
      const destinoId = await this.#findWarehouseId(client, data.destino, negocioId);

      for (const item of data.items) {
        if (!item.product_id) continue;
        if (origenId)  await this.#adjustStock(client, item.product_id, origenId,  -item.quantity);
        if (destinoId) await this.#adjustStock(client, item.product_id, destinoId,  item.quantity);
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

  async getById(id) {
    const { rows } = await pool.query(
      `SELECT o.*, c.name AS customer_name
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = $1`,
      [id]
    );
    if (!rows[0]) return null;

    const itemsRes = await pool.query(
      `SELECT oi.id, oi.product_id, oi.quantity, oi.unit_price, oi.cost,
              p.name, p.code
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1
       ORDER BY oi.id`,
      [id]
    );

    return { ...rows[0], items: itemsRes.rows };
  }

  getAll({ from, to, warehouseId, negocioId } = {}) {
    return this.orderRepo.getAll({ from, to, warehouseId, negocioId, tipo: "Remito" });
  }

  async updateRemito(id, data) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Cargar estado actual para revertir stock
      const oldOrderRes = await client.query(
        `SELECT origen, destino, negocio_id FROM orders WHERE id = $1`, [id]
      );
      const oldOrder = oldOrderRes.rows[0];
      if (!oldOrder) throw new Error("Remito no encontrado");

      const oldItemsRes = await client.query(
        `SELECT product_id, quantity FROM order_items WHERE order_id = $1`, [id]
      );

      // 2. Revertir stock de la versión anterior
      const negocioId    = oldOrder.negocio_id || data.negocio_id || null;
      const oldOrigenId  = oldOrder.origen  ? await this.#findWarehouseId(client, oldOrder.origen, negocioId)  : null;
      const oldDestinoId = oldOrder.destino ? await this.#findWarehouseId(client, oldOrder.destino, negocioId) : null;

      for (const item of oldItemsRes.rows) {
        if (!item.product_id) continue;
        if (oldOrigenId)  await this.#adjustStock(client, item.product_id, oldOrigenId,   item.quantity);
        if (oldDestinoId) await this.#adjustStock(client, item.product_id, oldDestinoId, -item.quantity);
      }

      // 3. Actualizar metadata del remito
      const newTotal = (data.items || []).reduce(
        (acc, i) => acc + (i.unit_price || 0) * i.quantity, 0
      );
      await client.query(
        `UPDATE orders SET origen=$1, destino=$2, customer_id=$3, price_type=$4, total=$5 WHERE id=$6`,
        [data.origen || null, data.destino || null, data.customer_id || null, data.price_type || "precio_1", newTotal, id]
      );

      // 4. Reemplazar items
      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [id]);
      for (const item of data.items || []) {
        await this.itemRepo.create(item, id, client);
      }

      // 5. Aplicar nuevo stock
      const newOrigenId  = data.origen  ? await this.#findWarehouseId(client, data.origen, negocioId)  : null;
      const newDestinoId = data.destino ? await this.#findWarehouseId(client, data.destino, negocioId) : null;

      for (const item of data.items || []) {
        if (!item.product_id) continue;
        if (newOrigenId)  await this.#adjustStock(client, item.product_id, newOrigenId,  -item.quantity);
        if (newDestinoId) await this.#adjustStock(client, item.product_id, newDestinoId,  item.quantity);
      }

      await client.query("COMMIT");
      return this.getById(id);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async delete(id) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const orderRes = await client.query(
        `SELECT origen, destino, negocio_id FROM orders WHERE id = $1`, [id]
      );
      const order = orderRes.rows[0];

      const itemsRes = await client.query(
        `SELECT product_id, quantity FROM order_items WHERE order_id = $1`, [id]
      );
      const items = itemsRes.rows;

      if (order && items.length > 0) {
        const negocioId = order.negocio_id;
        const origenId  = order.origen  ? await this.#findWarehouseId(client, order.origen, negocioId)  : null;
        const destinoId = order.destino ? await this.#findWarehouseId(client, order.destino, negocioId) : null;

        for (const item of items) {
          if (!item.product_id) continue;
          // Revertir exactamente: devolver lo que se descontó del origen,
          // quitar lo que se sumó al destino. Sin piso en 0.
          if (origenId)  await this.#adjustStock(client, item.product_id, origenId,   item.quantity);
          if (destinoId) await this.#adjustStock(client, item.product_id, destinoId, -item.quantity);
        }
      }

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
