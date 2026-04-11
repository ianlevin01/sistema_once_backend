import pool from "../database/db.js";
import OrderRepository from "../repositories/orderRepository.js";
import OrderItemRepository from "../repositories/orderItemRepository.js";
import PaymentRepository from "../repositories/paymentRepository.js";
import CuentaCorrienteRepository from "../repositories/cuentaCorrienteRepository.js";
import ProveedorRepository from "../repositories/proveedorRepository.js";

export default class ComprobanteService {
  orderRepo     = new OrderRepository();
  itemRepo      = new OrderItemRepository();
  paymentRepo   = new PaymentRepository();
  ccRepo        = new CuentaCorrienteRepository();
  proveedorRepo = new ProveedorRepository();

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
      const esReposicion = tipoFinal === "Reposicion";
      let warehouseId = null;

      if (esReposicion) {
        warehouseId = data.warehouse_id || null;
      } else if (data.user_id) {
        const userRes = await client.query(
          `SELECT warehouse_id FROM users WHERE id = $1`,
          [data.user_id]
        );
        warehouseId = userRes.rows[0]?.warehouse_id || null;
      }

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
      // Usa debitarPorComprobante que convierte según la divisa de la cuenta
      const esPresupuesto = tipoFinal === "Presupuesto" || tipoFinal === "Presupuesto Web";
      if (esPresupuesto && esCuentaCorriente && data.customer_id) {
        await this.ccRepo.debitarPorComprobante(
          data.customer_id,
          {
            total,
            orderId:  order.id,
            concepto: `${tipoFinal} — ${order.id.slice(0, 8)}`,
          },
          client
        );
      }

      // ── Vincular pedido web ───────────────────────────────────────────────
      if (data.web_order_id) {
        await client.query(
          `UPDATE web_orders SET order_id = $1, updated_at = now() WHERE id = $2`,
          [order.id, data.web_order_id]
        );
      }

      // ── Nota de Pedido → Presupuesto: descontar stock ────────────────────
      if (data.source_nota_id && esPresupuesto) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          await client.query(
            `UPDATE products
             SET stock_reserva = GREATEST(0, stock_reserva - $1)
             WHERE id = $2`,
            [item.quantity, item.product_id]
          );
          await this._deductStock(client, item.product_id, item.quantity, warehouseId);
        }

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

        await client.query(`DELETE FROM order_items WHERE order_id = $1`, [data.source_nota_id]);
        await client.query(`DELETE FROM orders WHERE id = $1`, [data.source_nota_id]);
      }

      // ── Presupuesto nuevo → descontar stock ──────────────────────────────
      if (esPresupuesto && !data.source_nota_id) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          await this._deductStock(client, item.product_id, item.quantity, warehouseId);
        }
      }

      // ── Nota de Pedido nueva → sumar stock_reserva ───────────────────────
      if ((tipoFinal === "Nota de Pedido" || tipoFinal === "Nota de Pedido Web") && !data.source_nota_id) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          await client.query(
            `UPDATE products SET stock_reserva = stock_reserva + $1 WHERE id = $2`,
            [item.quantity, item.product_id]
          );
        }
      }

      // ── Reposición → sumar stock al warehouse ────────────────────────────
      if (esReposicion && warehouseId) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          await client.query(
            `INSERT INTO stock (product_id, warehouse_id, quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT (product_id, warehouse_id)
             DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
            [item.product_id, warehouseId, item.quantity]
          );
        }
      }

      // ── Acreditar saldo al proveedor por reposición ───────────────────────
      // proveedorRepo.acreditarReposicion ya convierte según divisa del proveedor
      if (esReposicion && data.supplier_id && total > 0) {
        await this.proveedorRepo.acreditarReposicion(
          data.supplier_id,
          { monto: total, orderId: order.id },
          client
        );
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

  async _deductStock(client, productId, quantity, warehouseId) {
    if (warehouseId) {
      await client.query(
        `INSERT INTO stock (product_id, warehouse_id, quantity)
         VALUES ($1, $2, $3 * -1)
         ON CONFLICT (product_id, warehouse_id)
         DO UPDATE SET quantity = stock.quantity - $3`,
        [productId, warehouseId, quantity]
      );
    } else {
      const { rows } = await client.query(
        `SELECT id, quantity FROM stock
         WHERE product_id = $1
         ORDER BY quantity DESC`,
        [productId]
      );
      if (rows.length === 0) return;

      let remaining = quantity;
      for (const row of rows) {
        if (remaining <= 0) break;
        const available = Math.max(0, row.quantity);
        const deduct    = Math.min(remaining, available);
        if (deduct > 0) {
          await client.query(
            `UPDATE stock SET quantity = quantity - $1 WHERE id = $2`,
            [deduct, row.id]
          );
          remaining -= deduct;
        }
      }
      if (remaining > 0) {
        await client.query(
          `UPDATE stock SET quantity = quantity - $1 WHERE id = $2`,
          [remaining, rows[0].id]
        );
      }
    }
  }

  getById(id)     { return this.orderRepo.getById(id); }
  getAll(filters) { return this.orderRepo.getAll(filters); }

async getListado({ from, to } = {}) {
  const client = await pool.connect();
  try {
    const dateFrom = from ? `${from} 00:00:00` : "1970-01-01";
    const dateTo   = to   ? `${to} 23:59:59`   : "2099-12-31";

    // ── Cotización dólar vigente ─────────────────────────────────
    const cotizRes = await client.query(
      `SELECT cotizacion_dolar FROM price_config ORDER BY updated_at DESC LIMIT 1`
    );
    const cotizacion = Number(cotizRes.rows[0]?.cotizacion_dolar || 1);

    // ── Presupuestos ─────────────────────────────────────────────
    const presRes = await client.query(`
      SELECT
        o.id, o.tipo, o.created_at, o.total, o.vendedor, o.texto_libre,
        COALESCE(c.name, pr.name) AS customer_name,
        p.method AS payment_method
      FROM orders o
      LEFT JOIN customers   c  ON c.id  = o.customer_id
      LEFT JOIN proveedores pr ON pr.id = o.supplier_id
      LEFT JOIN payments    p  ON p.order_id = o.id
      WHERE o.tipo IN ('Presupuesto', 'Presupuesto Web')
        AND o.created_at BETWEEN $1 AND $2
      ORDER BY o.created_at DESC
    `, [dateFrom, dateTo]);

    // ── Reposiciones — total convertido a USD si corresponde ─────
    const reposRes = await client.query(`
      SELECT
        o.id, o.tipo, o.created_at, o.vendedor, o.texto_libre,
        o.supplier_id, o.warehouse_id,
        pr.name  AS supplier_name,
        w.name   AS warehouse_name,
        COALESCE(pr.divisa, 'ARS') AS divisa,
        CASE
          WHEN COALESCE(pr.divisa, 'ARS') = 'USD'
          THEN ROUND((o.total / $3)::numeric, 2)
          ELSE o.total
        END AS total
      FROM orders o
      LEFT JOIN proveedores pr ON pr.id = o.supplier_id
      LEFT JOIN warehouses  w  ON w.id  = o.warehouse_id
      WHERE o.tipo = 'Reposicion'
        AND o.created_at BETWEEN $1 AND $2
      ORDER BY o.created_at DESC
    `, [dateFrom, dateTo, cotizacion]);

    const reposConItems = await Promise.all(
      reposRes.rows.map(async (r) => {
        const itemsRes = await client.query(`
          SELECT oi.*, p.name, p.code
          FROM order_items oi
          LEFT JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = $1
        `, [r.id]);
        return { ...r, items: itemsRes.rows };
      })
    );

    // ── Notas de Pedido — SIN filtro de fecha, siempre todas ─────
    const notasRes = await client.query(`
      SELECT
        o.id, o.tipo, o.created_at, o.total, o.vendedor, o.texto_libre,
        o.customer_id, c.name AS customer_name
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.tipo IN ('Nota de Pedido', 'Nota de Pedido Web')
      ORDER BY o.created_at DESC
    `);

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

    // ── Remitos ──────────────────────────────────────────────────
    const remitosRes = await client.query(`
      SELECT o.id, o.created_at, o.total, o.vendedor, o.origen, o.destino
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
      reposiciones: reposConItems,
      notasPedido:  notasConItems,
      remitos:      remitosConItems,
    };
  } finally {
    client.release();
  }
}

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

  async getLastSalePrice(customerId, productId) {
    return this.orderRepo.getLastSalePrice(customerId, productId);
  }
}
