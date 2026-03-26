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

  async create(data) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const total = data.items.reduce((acc, i) => acc + i.unit_price * i.quantity, 0);

      // Crear la orden
      const order = await this.orderRepo.create({
        customer_id:  data.customer_id,
        user_id:      data.user_id,
        total,
        profit:       0,
        status:       "completed",
        tipo:         data.tipo        || "Presupuesto",
        vendedor:     data.vendedor    || null,
        price_type:   data.price_type  || "precio_1",
        texto_libre:  data.texto_libre || null,
        escenario:    data.escenario   || null,
      }, client);

      // Crear items
      for (const item of data.items) {
        await this.itemRepo.create(item, order.id, client);
      }

      // Crear pago solo si el método NO es cuenta corriente
      const esCuentaCorriente = data.payment_method === "Cta Cte";

      if (!esCuentaCorriente) {
        await this.paymentRepo.create({
          method: data.payment_method,
          amount: total,
        }, order.id, client);
      }

      // Si el tipo es "Presupuesto" o "Presupuesto Web" y el pago es cuenta corriente
      // → generar débito en la cuenta corriente del cliente
      const esPresupuesto = data.tipo === "Presupuesto" || data.tipo === "Presupuesto Web";

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

      // Si viene de un pedido web, vincular la orden al web_order
      if (data.web_order_id) {
        await client.query(
          `UPDATE web_orders SET order_id = $1, updated_at = now() WHERE id = $2`,
          [order.id, data.web_order_id]
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

  getById(id)     { return this.orderRepo.getById(id); }
  getAll(filters) { return this.orderRepo.getAll(filters); }

  /**
   * Listado agrupado para la vista CajaListado.
   * Devuelve: { presupuestos, notasPedido, remitos }
   * filtrado por rango de fecha (from/to).
   */
  async getListado({ from, to } = {}) {
    const client = await pool.connect();
    try {
      const dateFrom = from ? `${from} 00:00:00` : "1970-01-01";
      const dateTo   = to   ? `${to} 23:59:59`   : "2099-12-31";

      // Presupuestos y Presupuestos Web
      const presRes = await client.query(`
        SELECT
          o.id,
          o.tipo,
          o.created_at,
          o.total,
          o.vendedor,
          o.texto_libre,
          c.name AS customer_name,
          p.method AS payment_method
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN payments  p ON p.order_id = o.id
        WHERE o.tipo IN ('Presupuesto', 'Presupuesto Web')
          AND o.created_at BETWEEN $1 AND $2
        ORDER BY o.created_at DESC
      `, [dateFrom, dateTo]);

      // Notas de Pedido (reservas) — con sus items para poder presupuestar
      const notasRes = await client.query(`
        SELECT
          o.id,
          o.tipo,
          o.created_at,
          o.total,
          o.vendedor,
          o.texto_libre,
          o.customer_id,
          c.name AS customer_name
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.tipo = 'Nota de Pedido'
          AND o.created_at BETWEEN $1 AND $2
        ORDER BY o.created_at DESC
      `, [dateFrom, dateTo]);

      // Cargar items de las notas de pedido
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

      // Remitos
      const remitosRes = await client.query(`
        SELECT
          o.id,
          o.created_at,
          o.total,
          o.vendedor,
          o.origen,
          o.destino
        FROM orders o
        WHERE o.tipo = 'Remito'
          AND o.created_at BETWEEN $1 AND $2
        ORDER BY o.created_at DESC
      `, [dateFrom, dateTo]);

      return {
        presupuestos: presRes.rows,
        notasPedido:  notasConItems,
        remitos:      remitosRes.rows,
      };
    } finally {
      client.release();
    }
  }

  delete(id) { /* opcional */ }
}
