import pool from "../database/db.js";
import OrderRepository from "../repositories/orderRepository.js";
import OrderItemRepository from "../repositories/orderItemRepository.js";
import PaymentRepository from "../repositories/paymentRepository.js";
import CuentaCorrienteRepository from "../repositories/cuentaCorrienteRepository.js";

// ─────────────────────────────────────────────────────────────────────────────
// WAREHOUSE HARDCODEADO
// Cuando implementes JWT, reemplazá este valor por req.user.warehouse_id
// que debería venir del token del usuario autenticado.
// ─────────────────────────────────────────────────────────────────────────────
// Para obtener el ID del warehouse por defecto, ejecutá:
//   SELECT id, name FROM warehouses LIMIT 5;
// y pegá el UUID correspondiente acá:
const DEFAULT_WAREHOUSE_ID = process.env.DEFAULT_WAREHOUSE_ID || null;
// Cuando haya JWT: const DEFAULT_WAREHOUSE_ID = req.user.warehouse_id;

export default class ComprobanteService {
  orderRepo   = new OrderRepository();
  itemRepo    = new OrderItemRepository();
  paymentRepo = new PaymentRepository();
  ccRepo      = new CuentaCorrienteRepository();

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE
  // data.warehouse_id:
  //   - Para Presupuesto/Nota de Pedido/etc.: se ignora el que venga del body
  //     y se usa DEFAULT_WAREHOUSE_ID (del usuario hardcodeado por ahora).
  //   - Para Reposicion: se usa el que venga explícitamente en data.warehouse_id.
  //
  // data.supplier_id: UUID del proveedor (solo para Reposicion)
  // ─────────────────────────────────────────────────────────────────────────
  async create(data) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const total = data.items.reduce((acc, i) => acc + i.unit_price * i.quantity, 0);

      // ── Determinar tipo final ────────────────────────────────────────────
      let tipoFinal = data.tipo || "Presupuesto";
      if (data.source_nota_id && (tipoFinal === "Presupuesto" || tipoFinal === "Presupuesto Web")) {
        const notaOrig = await client.query(
          "SELECT tipo FROM orders WHERE id = $1",
          [data.source_nota_id]
        );
        if (notaOrig.rows[0]?.tipo === "Nota de Pedido Web") {
          tipoFinal = "Presupuesto Web";
          if (!data.web_order_id) {
            const webOrderRes = await client.query(
              "SELECT id FROM web_orders WHERE order_id = $1 LIMIT 1",
              [data.source_nota_id]
            );
            if (webOrderRes.rows[0]) {
              data = { ...data, web_order_id: webOrderRes.rows[0].id };
            }
          }
        }
      }

      // ── Determinar warehouse_id ──────────────────────────────────────────
      // Reposicion: el usuario elige manualmente la warehouse (viene en data.warehouse_id)
      // Todo lo demás: se usa el warehouse del usuario (hardcodeado por ahora)
      const esReposicion = tipoFinal === "Reposicion";
      const warehouseId  = esReposicion
        ? (data.warehouse_id || null)
        : DEFAULT_WAREHOUSE_ID;

      // ── Crear la orden principal ─────────────────────────────────────────
      const order = await this.orderRepo.create({
        customer_id:  data.customer_id  || null,
        supplier_id:  data.supplier_id  || null,
        user_id:      data.user_id      || null,
        warehouse_id: warehouseId,
        total,
        profit:       0,
        status:       "completed",
        tipo:         tipoFinal,
        vendedor:     data.vendedor    || null,
        price_type:   data.price_type  || "precio_1",
        texto_libre:  data.texto_libre || null,
      }, client);

      for (const item of data.items) {
        await this.itemRepo.create(item, order.id, client);
      }

      // ── Pago ─────────────────────────────────────────────────────────────
      const esCuentaCorriente = data.payment_method === "Cta Cte";
      await this.paymentRepo.create({
        method: data.payment_method,
        amount: esCuentaCorriente ? 0 : total,
      }, order.id, client);

      // ── Cuenta corriente de cliente (solo Presupuesto + Cta Cte) ─────────
      const esPresupuesto = tipoFinal === "Presupuesto" || tipoFinal === "Presupuesto Web";
      if (esPresupuesto && esCuentaCorriente && data.customer_id) {
        const cuenta = await this.ccRepo.getOrCreate(data.customer_id, client);
        await this.ccRepo.addMovimiento({
          cuentaId: cuenta.id,
          tipo:     "debito",
          concepto: `${tipoFinal} — ${order.id.slice(0, 8)}`,
          monto:    total,
          orderId:  order.id,
        }, client);
      }

      // ── Vincular pedido web ───────────────────────────────────────────────
      if (data.web_order_id) {
        await client.query(
          `UPDATE web_orders SET order_id = $1, updated_at = now() WHERE id = $2`,
          [order.id, data.web_order_id]
        );
      }

      // ─────────────────────────────────────────────────────────────────────
      // LÓGICA NOTA DE PEDIDO → PRESUPUESTO
      // ─────────────────────────────────────────────────────────────────────
      if (data.source_nota_id && esPresupuesto) {
        for (const item of data.items) {
          if (!item.product_id) continue;

          // Descontar stock_reserva
          await client.query(
            `UPDATE products
             SET stock_reserva = GREATEST(0, stock_reserva - $1)
             WHERE id = $2`,
            [item.quantity, item.product_id]
          );

          // Descontar stock real
          // Si hay warehouse_id definido (del usuario), descuenta de ahí primero;
          // si no, descuenta del que tenga más stock (comportamiento original)
          if (warehouseId) {
            await this._deductStockFromWarehouse(client, item.product_id, item.quantity, warehouseId);
          } else {
            await this._deductStockMaxFirst(client, item.product_id, item.quantity);
          }
        }

        // Nota paralela con items eliminados
        if (data.removed_items && data.removed_items.length > 0) {
          const removedTotal = data.removed_items.reduce(
            (acc, i) => acc + (i.unit_price || 0) * i.quantity, 0
          );
          const notaParalela = await this.orderRepo.create({
            customer_id:  data.customer_id,
            user_id:      null,
            total:        removedTotal,
            profit:       0,
            status:       "completed",
            tipo:         tipoFinal === "Presupuesto Web" ? "Nota de Pedido Web" : "Nota de Pedido",
            vendedor:     data.vendedor    || null,
            price_type:   data.price_type  || "precio_1",
            texto_libre:  data.texto_libre || null,
          }, client);
          for (const item of data.removed_items) {
            await this.itemRepo.create(item, notaParalela.id, client);
          }
          for (const item of data.removed_items) {
            if (!item.product_id) continue;
            await client.query(
              `UPDATE products SET stock_reserva = stock_reserva + $1 WHERE id = $2`,
              [item.quantity, item.product_id]
            );
          }
        }

        // Eliminar nota original
        await client.query(`DELETE FROM order_items WHERE order_id = $1`, [data.source_nota_id]);
        await client.query(`DELETE FROM orders WHERE id = $1`, [data.source_nota_id]);
      }

      // ─────────────────────────────────────────────────────────────────────
      // PRESUPUESTO NUEVO (sin source_nota_id) → descontar stock
      // ─────────────────────────────────────────────────────────────────────
      if (esPresupuesto && !data.source_nota_id) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          if (warehouseId) {
            await this._deductStockFromWarehouse(client, item.product_id, item.quantity, warehouseId);
          } else {
            await this._deductStockMaxFirst(client, item.product_id, item.quantity);
          }
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // NOTA DE PEDIDO nueva → sumar stock_reserva
      // ─────────────────────────────────────────────────────────────────────
      if ((tipoFinal === "Nota de Pedido" || tipoFinal === "Nota de Pedido Web") && !data.source_nota_id) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          await client.query(
            `UPDATE products SET stock_reserva = stock_reserva + $1 WHERE id = $2`,
            [item.quantity, item.product_id]
          );
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // REPOSICION → sumar stock al warehouse elegido
      // ─────────────────────────────────────────────────────────────────────
      if (esReposicion && warehouseId) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          // Upsert: si ya existe la fila stock(product_id, warehouse_id) la suma,
          // si no la crea
          await client.query(
            `INSERT INTO stock (product_id, warehouse_id, quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT (product_id, warehouse_id)
             DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
            [item.product_id, warehouseId, item.quantity]
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

  // ─────────────────────────────────────────────────────────────────────────
  // Descontar stock de un warehouse específico primero; si no alcanza,
  // desborda al que tenga más stock
  // ─────────────────────────────────────────────────────────────────────────
  async _deductStockFromWarehouse(client, productId, quantity, warehouseId) {
    // Intentar descontar del warehouse preferido primero
    const preferred = await client.query(
      `SELECT id, quantity FROM stock
       WHERE product_id = $1 AND warehouse_id = $2`,
      [productId, warehouseId]
    );

    let remaining = quantity;

    if (preferred.rows[0]) {
      const deduct = Math.min(remaining, preferred.rows[0].quantity);
      if (deduct > 0) {
        await client.query(
          `UPDATE stock SET quantity = quantity - $1 WHERE id = $2`,
          [deduct, preferred.rows[0].id]
        );
        remaining -= deduct;
      }
    }

    // Si sobra, descontar del que tenga más stock (excluyendo el ya usado)
    if (remaining > 0) {
      await this._deductStockMaxFirst(client, productId, remaining, warehouseId);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Descontar del warehouse con más stock primero (comportamiento original)
  // excludeWarehouseId: opcional, excluye ese warehouse del reparto
  // ─────────────────────────────────────────────────────────────────────────
  async _deductStockMaxFirst(client, productId, quantity, excludeWarehouseId = null) {
    let query = `
      SELECT s.id, s.quantity
      FROM stock s
      WHERE s.product_id = $1
    `;
    const params = [productId];
    if (excludeWarehouseId) {
      params.push(excludeWarehouseId);
      query += ` AND s.warehouse_id != $${params.length}`;
    }
    query += ` ORDER BY s.quantity DESC`;

    const stockRows = await client.query(query, params);
    let remaining = quantity;
    for (const row of stockRows.rows) {
      if (remaining <= 0) break;
      const deduct = Math.min(remaining, row.quantity);
      await client.query(
        `UPDATE stock SET quantity = quantity - $1 WHERE id = $2`,
        [deduct, row.id]
      );
      remaining -= deduct;
    }
  }

  getById(id)     { return this.orderRepo.getById(id); }
  getAll(filters) { return this.orderRepo.getAll(filters); }

  // ─────────────────────────────────────────────────────────────────────────
  // GET LISTADO AGRUPADO para CajaListado
  // ─────────────────────────────────────────────────────────────────────────
  async getListado({ from, to } = {}) {
    const client = await pool.connect();
    try {
      const dateFrom = from ? `${from} 00:00:00` : "1970-01-01";
      const dateTo   = to   ? `${to} 23:59:59`   : "2099-12-31";

      const presRes = await client.query(`
        SELECT
          o.id, o.tipo, o.created_at, o.total, o.vendedor, o.texto_libre,
          COALESCE(c.name, pr.name) AS customer_name,
          p.method AS payment_method
        FROM orders o
        LEFT JOIN customers  c  ON c.id  = o.customer_id
        LEFT JOIN proveedores pr ON pr.id = o.supplier_id
        LEFT JOIN payments   p  ON p.order_id = o.id
        WHERE o.tipo IN ('Presupuesto', 'Presupuesto Web')
          AND o.created_at BETWEEN $1 AND $2
        ORDER BY o.created_at DESC
      `, [dateFrom, dateTo]);

      const notasRes = await client.query(`
        SELECT
          o.id, o.tipo, o.created_at, o.total, o.vendedor, o.texto_libre,
          o.customer_id, c.name AS customer_name
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.tipo IN ('Nota de Pedido', 'Nota de Pedido Web')
          AND o.created_at BETWEEN $1 AND $2
        ORDER BY o.created_at DESC
      `, [dateFrom, dateTo]);

      const notasConItems = await Promise.all(
        notasRes.rows.map(async (nota) => {
          const itemsRes = await client.query(`
            SELECT oi.*, p.name, p.code
            FROM order_items oi
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = $1
          `, [nota.id]);
          return { ...nota, items: itemsRes.rows };
        })
      );

      const remitosRes = await client.query(`
        SELECT
          o.id, o.created_at, o.total, o.vendedor, o.origen, o.destino
        FROM orders o
        WHERE o.tipo = 'Remito'
          AND o.created_at BETWEEN $1 AND $2
        ORDER BY o.created_at DESC
      `, [dateFrom, dateTo]);

      const remitosConItems = await Promise.all(
        remitosRes.rows.map(async (r) => {
          const itemsRes = await client.query(`
            SELECT oi.*, p.name, p.code
            FROM order_items oi
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = $1
          `, [r.id]);
          return { ...r, items: itemsRes.rows };
        })
      );

      return {
        presupuestos: presRes.rows,
        notasPedido:  notasConItems,
        remitos:      remitosConItems,
      };
    } finally {
      client.release();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE
  // ─────────────────────────────────────────────────────────────────────────
  async delete(id) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const orderRes = await client.query(
        `SELECT tipo FROM orders WHERE id = $1`, [id]
      );
      const tipo = orderRes.rows[0]?.tipo;

      if (tipo === "Nota de Pedido" || tipo === "Nota de Pedido Web") {
        const itemsRes = await client.query(
          `SELECT product_id, quantity FROM order_items WHERE order_id = $1`, [id]
        );
        for (const item of itemsRes.rows) {
          await client.query(
            `UPDATE products SET stock_reserva = GREATEST(0, stock_reserva - $1) WHERE id = $2`,
            [item.quantity, item.product_id]
          );
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

  // ─────────────────────────────────────────────────────────────────────────
  // ÚLTIMO PRECIO de un producto para un cliente
  // ─────────────────────────────────────────────────────────────────────────
  async getLastSalePrice(customerId, productId) {
    return this.orderRepo.getLastSalePrice(customerId, productId);
  }
}
