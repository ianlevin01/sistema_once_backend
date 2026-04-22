import pool from "../database/db.js";
import WebOrderRepository from "../repositories/webOrderRepository.js";
import ComprobanteService from "./comprobanteService.js";
import { sendOrderPreparationEmail } from "./emailService.js";

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
  async setReservado(id, reservado, warehouseId = null, negocioId = null) {
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
          const esGuest = !customerId;
          await this.comproSvc.create({
            customer_id:             esGuest ? null : customerId,
            es_consumidor_final:     esGuest,
            consumidor_final_nombre: esGuest ? (webOrder.customer_name || null) : null,
            user_id:                 null,
            warehouse_id:            warehouseId,
            payment_method:          "Contado",
            tipo:                    "Nota de Pedido Web",
            vendedor:                null,
            price_type:              "precio_1",
            texto_libre:             webOrder.observaciones || null,
            escenario:               null,
            web_order_id:            id,
            negocio_id:              negocioId,
            items,
          });
          // Enviar email "en preparación"
          const emailTo   = webOrder.customer_email;
          const emailName = webOrder.customer_name;
          if (emailTo) {
            sendOrderPreparationEmail({
              to:           emailTo,
              customerName: emailName,
              orderId:      id,
              items:        webOrder.items,
              total:        webOrder.total,
            }).catch(() => {});
          }
        } catch (err) {
          console.error("Error creando Nota de Pedido desde pedido web:", err);
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

      if (!customerId && !data.customer_name) {
        throw new Error("Se requiere nombre del cliente");
      }

      // Para pedidos de invitados, crear (o encontrar) el cliente en la BD
      if (!customerId && data.customer_name) {
        const customer = await this.repo.findOrCreateCustomer({
          name:      data.customer_name,
          email:     data.customer_email     || null,
          phone:     data.customer_phone     || null,
          localidad: data.customer_locality  || null,
        }, client);
        customerId = customer.id;
      }

      const total = (data.items || []).reduce(
        (acc, i) => acc + (i.unit_price || 0) * i.quantity, 0
      );

      const order = await this.repo.create({
        customer_id:    customerId,
        customer_name:  null,
        customer_email: null,
        customer_phone: null,
        observaciones:  data.observaciones,
        total,
        color:          data.color,
        negocio_id:     data.negocio_id || null,
      }, client);

      await this.repo.replaceItems(order.id, data.items || [], client);

      await client.query("COMMIT");

      return await this.repo.getById(order.id);

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
