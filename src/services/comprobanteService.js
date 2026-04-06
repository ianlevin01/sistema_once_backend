import pool from "../database/db.js";
import OrderRepository from "../repositories/orderRepository.js";
import OrderItemRepository from "../repositories/orderItemRepository.js";
import PaymentRepository from "../repositories/paymentRepository.js";
import CuentaCorrienteRepository from "../repositories/cuentaCorrienteRepository.js";

export default class ComprobanteService {
  orderRepo   = new OrderRepository();
  itemRepo    = new OrderItemRepository();
  paymentRepo = new PaymentRepository();
  ccRepo      = new CuentaCorrienteRepository();

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE
  // Parámetros extra respecto al original:
  //   data.source_nota_id   — si viene de una Nota de Pedido, su ID (para eliminarla y mover reserva)
  //   data.removed_items    — items que se quitaron al presupuestar (para crear nota paralela)
  // ─────────────────────────────────────────────────────────────────────────
  async create(data) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const total = data.items.reduce((acc, i) => acc + i.unit_price * i.quantity, 0);

      // ── Si viene de una Nota de Pedido Web, el presupuesto es "Presupuesto Web" ──
      let tipoFinal = data.tipo || "Presupuesto";
      if (data.source_nota_id && (tipoFinal === "Presupuesto" || tipoFinal === "Presupuesto Web")) {
        const notaOrig = await client.query(
          "SELECT tipo FROM orders WHERE id = $1",
          [data.source_nota_id]
        );
        if (notaOrig.rows[0]?.tipo === "Nota de Pedido Web") {
          tipoFinal = "Presupuesto Web";
          // Buscar el web_order que apunta a esta nota para actualizarlo después
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

      // ── Crear la orden principal ─────────────────────────────────────────
      const order = await this.orderRepo.create({
        customer_id:  data.customer_id,
        user_id:      data.user_id,
        total,
        profit:       0,
        status:       "completed",
        tipo:         tipoFinal,
        vendedor:     data.vendedor    || null,
        price_type:   data.price_type  || "precio_1",
        texto_libre:  data.texto_libre || null,
        escenario:    data.escenario   || null,
      }, client);

      for (const item of data.items) {
        await this.itemRepo.create(item, order.id, client);
      }

      // ── Pago ─────────────────────────────────────────────────────────────
      // Siempre guardamos el registro en payments para que el LEFT JOIN en
      // getListado siempre encuentre el método de pago.
      // Para Cta Cte el amount es 0 (el dinero se mueve por cuenta corriente).
      const esCuentaCorriente = data.payment_method === "Cta Cte";
      await this.paymentRepo.create({
        method: data.payment_method,
        amount: esCuentaCorriente ? 0 : total,
      }, order.id, client);

      // ── Cuenta corriente ─────────────────────────────────────────────────
      const esPresupuesto = tipoFinal === "Presupuesto" || tipoFinal === "Presupuesto Web";
      if (esPresupuesto && esCuentaCorriente && data.customer_id) {
        const cuenta = await this.ccRepo.getOrCreate(data.customer_id, client);
        await this.ccRepo.addMovimiento({
          cuentaId: cuenta.id,
          tipo:     "debito",
          concepto: `${data.tipo} — ${order.id.slice(0, 8)}`,
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
      // LÓGICA DE NOTA DE PEDIDO → PRESUPUESTO
      // Si se está convirtiendo una Nota de Pedido a Presupuesto:
      //   1. Descontar stock_reserva de los items presupuestados
      //   2. Descontar stock real (suma de todos los warehouses) de los items presupuestados
      //   3. Crear nota paralela con los items que se eliminaron (si los hay)
      //   4. Eliminar la nota de pedido original
      // ─────────────────────────────────────────────────────────────────────
      if (data.source_nota_id && esPresupuesto) {

        // 1 & 2: Por cada item del presupuesto, ajustar stock_reserva y stock real
        for (const item of data.items) {
          if (!item.product_id) continue;

          // Descontar de stock_reserva
          await client.query(
            `UPDATE products
             SET stock_reserva = GREATEST(0, stock_reserva - $1)
             WHERE id = $2`,
            [item.quantity, item.product_id]
          );

          // Descontar del stock real (primer warehouse que tenga suficiente, o distribuido)
          // Estrategia: descontar del warehouse con más stock primero
          const stockRows = await client.query(
            `SELECT s.id, s.quantity, w.name
             FROM stock s
             JOIN warehouses w ON w.id = s.warehouse_id
             WHERE s.product_id = $1
             ORDER BY s.quantity DESC`,
            [item.product_id]
          );

          let remaining = item.quantity;
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

        // 3: Crear nota paralela con items eliminados (si los hay)
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
            escenario:    data.escenario   || null,
          }, client);

          for (const item of data.removed_items) {
            await this.itemRepo.create(item, notaParalela.id, client);
          }

          // Los items de la nota paralela suman a stock_reserva
          for (const item of data.removed_items) {
            if (!item.product_id) continue;
            await client.query(
              `UPDATE products SET stock_reserva = stock_reserva + $1 WHERE id = $2`,
              [item.quantity, item.product_id]
            );
          }
        }

        // 4: Eliminar la nota de pedido original
        await client.query(
          `DELETE FROM order_items WHERE order_id = $1`,
          [data.source_nota_id]
        );
        await client.query(
          `DELETE FROM orders WHERE id = $1`,
          [data.source_nota_id]
        );
      }

      // ─────────────────────────────────────────────────────────────────────
      // Si se crea una NOTA DE PEDIDO nueva (no desde otra nota),
      // sumar los items a stock_reserva
      // ─────────────────────────────────────────────────────────────────────
      if ((data.tipo === "Nota de Pedido" || data.tipo === "Nota de Pedido Web") && !data.source_nota_id) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          await client.query(
            `UPDATE products SET stock_reserva = stock_reserva + $1 WHERE id = $2`,
            [item.quantity, item.product_id]
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
          c.name AS customer_name,
          p.method AS payment_method
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN payments  p ON p.order_id = o.id
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

      // También cargar items de remitos para imprimir
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

  async delete(id) {
    // Al eliminar una Nota de Pedido, liberar stock_reserva
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Verificar si es nota de pedido
      const orderRes = await client.query(
        `SELECT tipo FROM orders WHERE id = $1`, [id]
      );
      if (orderRes.rows[0]?.tipo === "Nota de Pedido" || orderRes.rows[0]?.tipo === "Nota de Pedido Web") {
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
}
