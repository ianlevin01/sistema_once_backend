import pool from "../database/db.js";
import WebOrderRepository from "../repositories/webOrderRepository.js";

export default class WebOrderService {
  repo = new WebOrderRepository();

  getAll(filters)     { return this.repo.getAll(filters); }
  getById(id)         { return this.repo.getById(id); }
  setColor(id, color) { return this.repo.setColor(id, color); }
  delete(id)          { return this.repo.delete(id); }

  async setReservado(id, reservado) {
    return this.repo.setReservado(id, reservado);
  }

  // Crear pedido con items en una transacción
  async create(data) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const total = (data.items || []).reduce(
        (acc, i) => acc + (i.unit_price || 0) * i.quantity, 0
      );

      const order = await this.repo.create({ ...data, total }, client);
      await this.repo.replaceItems(order.id, data.items || [], client);

      await client.query("COMMIT");
      return this.repo.getById(order.id);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // Editar pedido + reemplazar items
  async update(id, data) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const total = data.items
        ? data.items.reduce((acc, i) => acc + (i.unit_price || 0) * i.quantity, 0)
        : undefined;

      await this.repo.update(id, { ...data, total }, client);

      if (data.items) {
        await this.repo.replaceItems(id, data.items, client);
      }

      await client.query("COMMIT");
      return this.repo.getById(id);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
