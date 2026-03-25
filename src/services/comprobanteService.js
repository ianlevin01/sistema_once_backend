import pool from "../database/db.js";
import OrderRepository from "../repositories/orderRepository.js";
import OrderItemRepository from "../repositories/orderItemRepository.js";
import PaymentRepository from "../repositories/paymentRepository.js";
import CuentaCorrienteRepository from "../repositories/cuentaCorrienteRepository.js";

export default class ComprobanteService {
  orderRepo = new OrderRepository();
  itemRepo  = new OrderItemRepository();
  paymentRepo = new PaymentRepository();
  ccRepo    = new CuentaCorrienteRepository();

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

      // Si el tipo es "Presupuesto" y el pago es cuenta corriente
      // → generar débito en la cuenta corriente del cliente
      if (data.tipo === "Presupuesto" && esCuentaCorriente && data.customer_id) {
        const cuenta = await this.ccRepo.getOrCreate(data.customer_id, client);
        await this.ccRepo.addMovimiento({
          cuentaId: cuenta.id,
          tipo:     "debito",
          concepto: `Presupuesto — ${order.id.slice(0, 8)}`,
          monto:    total,
          orderId:  order.id,
        }, client);
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

  getById(id)      { return this.orderRepo.getById(id); }
  getAll(filters)  { return this.orderRepo.getAll(filters); }
  delete(id)       { /* opcional */ }
}
