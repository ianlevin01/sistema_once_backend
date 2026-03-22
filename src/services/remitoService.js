import pool from "../database/db.js"
import OrderRepository from "../repositories/orderRepository.js";
import OrderItemRepository from "../repositories/orderItemRepository.js";

export default class RemitoService {
  orderRepo = new OrderRepository();
  itemRepo = new OrderItemRepository();

  async createRemito(data) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const order = await this.orderRepo.create({
        customer_id: null,
        user_id: data.user_id,
        total: 0,
        profit: 0,
        status: "remito"
      }, client);

      for (let item of data.items) {
        await this.itemRepo.create(item, order.id, client);
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

  getAll() {
    return this.orderRepo.getAll({});
  }

  delete(id) {}
}