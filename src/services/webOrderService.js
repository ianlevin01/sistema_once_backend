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

  // Crear pedido web
  // - Si viene customer_id: lo usa directamente
  // - Si no viene: crea un customer nuevo y lo asigna
  async create(data) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      let customerId = data.customer_id || null;
      let newCustomer = null;

      if (!customerId) {
        // Crear customer nuevo con los datos del formulario
        if (!data.customer_name) throw new Error("Se requiere nombre del cliente");
        newCustomer = await this.repo.createCustomer({
          name:  data.customer_name,
          email: data.customer_email,
          phone: data.customer_phone,
        }, client);
        customerId = newCustomer.id;
      }

      const total = (data.items || []).reduce(
        (acc, i) => acc + (i.unit_price || 0) * i.quantity, 0
      );

      const order = await this.repo.create({
        customer_id:   customerId,
        observaciones: data.observaciones,
        total,
        color:         data.color,
      }, client);

      await this.repo.replaceItems(order.id, data.items || [], client);

      await client.query("COMMIT");

      const result = await this.repo.getById(order.id);

      // Si se creó un customer nuevo, lo incluimos en la respuesta
      // para que el front pueda informarle al cliente su nuevo ID
      if (newCustomer) {
        return { ...result, new_customer: newCustomer };
      }
      return result;

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
