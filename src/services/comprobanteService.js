import pool from "../database/db.js"
import OrderRepository from "../repositories/orderRepository.js";
import OrderItemRepository from "../repositories/orderItemRepository.js";
import PaymentRepository from "../repositories/paymentRepository.js";

export default class ComprobanteService {
  orderRepo = new OrderRepository();
  itemRepo = new OrderItemRepository();
  paymentRepo = new PaymentRepository();

  async create(data) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      let total = 0;

      data.items.forEach(i => {
        total += i.unit_price * i.quantity;
      });

      const order = await this.orderRepo.create({
        customer_id: data.customer_id,
        user_id: data.user_id,
        total,
        profit: 0,
        status: "completed"
      }, client);

      for (let item of data.items) {
        await this.itemRepo.create(item, order.id, client);
      }

      await this.paymentRepo.create({
        method: data.payment_method,
        amount: total
      }, order.id, client);

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

  getAll(filters) {
    return this.orderRepo.getAll(filters);
  }

  delete(id) {
    // opcional
  }
}