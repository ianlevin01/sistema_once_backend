import pool from "../database/db.js";
import WebOrderRepository from "../repositories/webOrderRepository.js";
import ComprobanteService from "./comprobanteService.js";

export default class WebOrderService {
  repo        = new WebOrderRepository();
  comproSvc   = new ComprobanteService();

  getAll(filters)     { return this.repo.getAll(filters); }
  getById(id)         { return this.repo.getById(id); }
  setColor(id, color) { return this.repo.setColor(id, color); }
  delete(id)          { return this.repo.delete(id); }

  // ─────────────────────────────────────────────────────────────────────────
  // SET RESERVADO
  // Cuando reservado pasa a TRUE → crea una Nota de Pedido automáticamente
  // ─────────────────────────────────────────────────────────────────────────
  async setReservado(id, reservado, warehouseId = null) {
    const result = await this.repo.setReservado(id, reservado);

    if (reservado) {
      // Cargar el pedido completo para tener items y cliente
      const webOrder = await this.repo.getById(id);

      if (webOrder && webOrder.items && webOrder.items.length > 0) {
        // Determinar customer_id: si el pedido web tiene uno, usarlo
        const customerId = webOrder.customer_id || null;

        // Mapear items del pedido web al formato de comprobante
        const items = webOrder.items.map((i) => ({
          product_id: i.product_id || null,
          quantity:   i.quantity,
          unit_price: Number(i.unit_price || 0),
        }));

        try {
          // Crear la Nota de Pedido (también suma stock_reserva automáticamente)
          await this.comproSvc.create({
            customer_id:    customerId,
            user_id:        null,
            warehouse_id:   warehouseId,
            payment_method: "Contado",
            tipo:           "Nota de Pedido Web",
            vendedor:       null,
            price_type:     "precio_1",
            texto_libre:    webOrder.observaciones || null,
            escenario:      null,
            web_order_id:   id,
            items,
          });
        } catch (err) {
          console.error("Error creando Nota de Pedido desde pedido web:", err);
          // No propagar: el reservado ya se marcó, solo loguear el error
        }
      }
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE
  // ─────────────────────────────────────────────────────────────────────────
  async create(data) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      let customerId = data.customer_id || null;
      let newCustomer = null;

      if (!customerId) {
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

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE
  // ─────────────────────────────────────────────────────────────────────────
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
