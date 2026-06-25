import pool from "../database/db.js";
import { sendOrderCompletedEmail } from "./emailService.js";
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

  // ─────────────────────────────────────────────────────────────
  // CREAR
  // ─────────────────────────────────────────────────────────────
  async create(data) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Total raw desde el frontend (puede estar en ARS o en USD según divisa del comprobante)
      const totalRaw = data.items.reduce((acc, i) => acc + i.unit_price * i.quantity, 0);

      // ── Tipo final ──────────────────────────────────────────
      let tipoFinal = data.tipo || "Presupuesto";
      if (data.source_nota_id && (tipoFinal === "Presupuesto" || tipoFinal === "Presupuesto Web")) {
        const notaOrig = await client.query(
          "SELECT tipo FROM orders WHERE id = $1", [data.source_nota_id]
        );
        if (notaOrig.rows[0]?.tipo === "Nota de Pedido Web") {
          tipoFinal = "Presupuesto Web";
          if (!data.web_order_id) {
            const webOrderRes = await client.query(
              "SELECT id FROM web_orders WHERE order_id = $1 LIMIT 1", [data.source_nota_id]
            );
            if (webOrderRes.rows[0]) data = { ...data, web_order_id: webOrderRes.rows[0].id };
          }
        }
      }

      const esReposicion   = tipoFinal === "Reposicion";
      const esDevolucion   = tipoFinal === "Devolucion";
      const esDevolProv    = tipoFinal === "Devol a proveedor";
      const esPresupuesto  = tipoFinal === "Presupuesto" || tipoFinal === "Presupuesto Web";
      const esNota         = tipoFinal === "Nota de Pedido" || tipoFinal === "Nota de Pedido Web";

      // ── Warehouse ───────────────────────────────────────────
      // warehouseId  → se guarda en orders.warehouse_id (warehouse del creador → filtrado/visibilidad)
      // stockWarehouseId → donde realmente se mueve el stock (destino para repos, origen para devolProv)
      let warehouseId = null;
      if (data.user_id) {
        const userRes = await client.query(
          `SELECT warehouse_id FROM users WHERE id = $1`, [data.user_id]
        );
        warehouseId = userRes.rows[0]?.warehouse_id || null;
      }
      if (!warehouseId) warehouseId = data.warehouse_id || null;

      const stockWarehouseId = (esReposicion || esDevolProv)
        ? (data.destino_warehouse_id || null)
        : warehouseId;

      // ── Divisa ──────────────────────────────────────────────
      let divisa = "ARS";
      if ((esReposicion || esDevolProv) && data.supplier_id) {
        const provRes = await client.query(
          `SELECT divisa FROM proveedores WHERE id = $1`, [data.supplier_id]
        );
        divisa = provRes.rows[0]?.divisa ?? "ARS";
      } else if (!esReposicion && !esDevolProv && data.customer_id && !data.es_consumidor_final) {
        const custRes = await client.query(
          `SELECT divisa FROM customers WHERE id = $1`, [data.customer_id]
        );
        divisa = custRes.rows[0]?.divisa ?? "ARS";
      } else if (data.divisa) {
        divisa = data.divisa;
      }

      // ── Cotización y total en divisa del comprobante ────────
      // Cuando divisa=USD el frontend envía precios en USD (price_usd).
      // Necesitamos convertirlos a ARS para almacenamiento y lógica interna.
      const cotizRes = await client.query(
        `SELECT cotizacion_dolar FROM price_config WHERE negocio_id = $1 LIMIT 1`,
        [data.negocio_id]
      );
      const cotizacion = Number(cotizRes.rows[0]?.cotizacion_dolar || 1000);

      const preciosEnUSD = divisa === "USD";
      const totalARSBruto = preciosEnUSD
        ? Math.round(totalRaw * cotizacion * 100) / 100
        : totalRaw;
      const itemsParaGuardar = preciosEnUSD
        ? data.items.map((i) => ({ ...i, unit_price: Math.round(i.unit_price * cotizacion * 100) / 100 }))
        : data.items;

      const descuentoPct    = Number(data.descuento_pct ?? 0) || 0;
      const descuentoFactor = 1 - descuentoPct / 100;
      const totalARS = Math.round(totalARSBruto * descuentoFactor * 100) / 100;
      const total = divisa === "USD"
        ? Math.round((totalARS / cotizacion) * 100) / 100
        : totalARS;
      // ── Crear orden ─────────────────────────────────────────
      // Para repos/devolProv: destino guarda el stockWarehouseId (UUID) para
      // que edit/delete sepan dónde revertir el stock sin tocar warehouse_id.
      const order = await client.query(`
        INSERT INTO orders (
          customer_id, supplier_id, user_id, warehouse_id,
          total, profit, status, tipo, vendedor, price_type, texto_libre,
          es_consumidor_final, consumidor_final_nombre, divisa, destino, negocio_id,
          created_by_user_id, created_by_name, descuento_pct, cotizacion_dolar
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        RETURNING *
      `, [
        data.customer_id  || null,
        data.supplier_id  || null,
        data.user_id      || null,
        warehouseId,
        total, 0, "completed",
        tipoFinal,
        data.vendedor    || null,
        data.price_type  || "precio_1",
        data.texto_libre || null,
        data.es_consumidor_final     ? true  : false,
        data.consumidor_final_nombre || null,
        divisa,
        (esReposicion || esDevolProv) ? (stockWarehouseId || null) : null,
        data.negocio_id  || null,
        data.created_by_user_id || null,
        data.created_by_name    || null,
        descuentoPct,
        preciosEnUSD ? cotizacion : null,
      ]);
      const orderRow = order.rows[0];

      for (const item of itemsParaGuardar) {
        await this.itemRepo.create(item, orderRow.id, client);
      }

      // ── Pago ────────────────────────────────────────────────
      const esCuentaCorriente = data.payment_method === "Cta Cte";
      await this.paymentRepo.create({
        method: data.payment_method,
        amount: esCuentaCorriente ? 0 : total,
      }, orderRow.id, client);

      // ── CC cliente: presupuesto con Cta Cte → debitar ───────
      // Auto-crear la CC si el cliente aún no tiene una
      if (esCuentaCorriente && data.customer_id && !data.es_consumidor_final) {
        await this.ccRepo.createCC(data.customer_id, client);
      }

      // debitarPorComprobante espera el total en ARS (hace la conversión internamente)
      if (esPresupuesto && esCuentaCorriente && data.customer_id && !data.es_consumidor_final) {
        await this.ccRepo.debitarPorComprobante(
          data.customer_id,
          { total: totalARS, orderId: orderRow.id, concepto: `${tipoFinal} — ${orderRow.id.slice(0, 8)}` },
          client,
          data.negocio_id
        );
      }

      // ── CC cliente: devolución → acreditar (reducir deuda) ──
      if (esDevolucion && esCuentaCorriente && data.customer_id && !data.es_consumidor_final) {
        const cc            = await this.ccRepo.getOrCreate(data.customer_id, client);
        const divisaCC      = cc.divisa ?? "ARS";
        const montoEnCuenta = divisaCC === "USD" ? totalARS / cotizacion : totalARS;

        await client.query(
          `INSERT INTO cc_movimientos
             (cuenta_corriente_id, tipo, concepto, monto, order_id,
              divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada)
           VALUES ($1,'pago',$2,$3,$4,$5,$6,$7,$8)`,
          [
            cc.id,
            `Devolución — ${orderRow.id.slice(0, 8)}`,
            montoEnCuenta, orderRow.id,
            divisaCC, "ARS", totalARS,
            divisaCC === "USD" ? cotizacion : null,
          ]
        );
        await client.query(
          `UPDATE cuentas_corrientes SET saldo = saldo - $1, updated_at = NOW() WHERE id = $2`,
          [montoEnCuenta, cc.id]
        );
      }

      // ── CC cliente: comprobante no-CC → solo visualización ──
      // Usa SAVEPOINT para que un fallo aquí (ej: columna afecta_saldo inexistente)
      // no aborte la transacción principal.
      if (!esCuentaCorriente && data.customer_id && !data.es_consumidor_final && (esPresupuesto || esDevolucion)) {
        try {
          await client.query("SAVEPOINT visual_entry");
          const cc = await this.ccRepo.getOrCreate(data.customer_id, client);
          if (cc) {
            const divisaCC      = cc.divisa ?? "ARS";
            const montoEnCuenta = divisaCC === "USD" ? totalARS / cotizacion : totalARS;
            await this.ccRepo.insertSoloVisualizacion({
              cuentaId:        cc.id,
              tipo:            esDevolucion ? "pago" : "debito",
              concepto:        `${tipoFinal} — ${orderRow.id.slice(0, 8)}`,
              monto:           montoEnCuenta,
              orderId:         orderRow.id,
              metodo_pago:     data.payment_method,
              divisa_cuenta:   divisaCC,
              divisa_cobro:    "ARS",
              monto_original:  totalARS,
              cotizacion_usada: divisaCC === "USD" ? cotizacion : null,
            }, client);
          }
          await client.query("RELEASE SAVEPOINT visual_entry");
        } catch (err) {
          console.warn("CC visual entry failed (non-blocking):", err.message);
          await client.query("ROLLBACK TO SAVEPOINT visual_entry");
        }
      }

      // ── Web order ───────────────────────────────────────────
      let _completionEmail = null;
      if (data.web_order_id) {
        await client.query(
          `UPDATE web_orders SET order_id = $1, updated_at = now() WHERE id = $2`,
          [orderRow.id, data.web_order_id]
        );
        if (esPresupuesto) {
          const woRes = await client.query(
            `SELECT COALESCE(c.email, w.customer_email) AS email,
                    COALESCE(c.name,  w.customer_name)  AS name,
                    w.total, w.id
             FROM web_orders w
             LEFT JOIN customers c ON c.id = w.customer_id
             WHERE w.id = $1`,
            [data.web_order_id]
          );
          _completionEmail = woRes.rows[0] || null;
        }
      }

      // ── Nota → Presupuesto: descontar stock ─────────────────
      if (data.source_nota_id && esPresupuesto) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          await client.query(
            `UPDATE products SET stock_reserva = GREATEST(0, stock_reserva - $1) WHERE id = $2`,
            [item.quantity, item.product_id]
          );
          await this._deductStock(client, item.product_id, item.quantity, warehouseId);
        }

        if (data.removed_items?.length > 0) {
          const removedTotal = data.removed_items.reduce(
            (acc, i) => acc + (i.unit_price || 0) * i.quantity, 0
          );
          const notaParalelaRes = await client.query(`
            INSERT INTO orders (
              customer_id, user_id, total, profit, status, tipo,
              vendedor, price_type, texto_libre, es_consumidor_final, divisa, negocio_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
          `, [
            data.customer_id, null, removedTotal, 0, "completed",
            tipoFinal === "Presupuesto Web" ? "Nota de Pedido Web" : "Nota de Pedido",
            data.vendedor || null, data.price_type || "precio_1",
            data.texto_libre || null, false, divisa, data.negocio_id || null,
          ]);
          const notaParalela = notaParalelaRes.rows[0];
          for (const item of data.removed_items) {
            await this.itemRepo.create(item, notaParalela.id, client);
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

      // ── Presupuesto nuevo → descontar stock ─────────────────
      if (esPresupuesto && !data.source_nota_id) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          await this._deductStock(client, item.product_id, item.quantity, warehouseId);
        }
      }

      // ── Nota nueva → sumar stock_reserva ────────────────────
      if (esNota && !data.source_nota_id) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          await client.query(
            `UPDATE products SET stock_reserva = stock_reserva + $1 WHERE id = $2`,
            [item.quantity, item.product_id]
          );
        }
      }

      // ── Reposición → sumar stock en el depósito DESTINO ────────
      if (esReposicion && stockWarehouseId) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          await client.query(
            `INSERT INTO stock (product_id, warehouse_id, quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT (product_id, warehouse_id)
             DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
            [item.product_id, stockWarehouseId, item.quantity]
          );
        }
      }

      // ── Reposición → acreditar CC proveedor (solo si Cta Cte) ──
      if (esReposicion && esCuentaCorriente && data.supplier_id && totalARS > 0) {
        await this.proveedorRepo.acreditarReposicion(
          data.supplier_id, { monto: totalARS, orderId: orderRow.id, negocio_id: data.negocio_id }, client
        );
      }

      // ── Reposición no-CC → solo visualización (como en clientes) ──
      if (esReposicion && !esCuentaCorriente && data.supplier_id && totalARS > 0) {
        try {
          await client.query("SAVEPOINT visual_entry_prov");
          const ccProv = await this.proveedorRepo.getOrCreateCC(data.supplier_id, client);
          if (ccProv) {
            const divisaCC      = ccProv.divisa ?? "ARS";
            const montoEnCuenta = divisaCC === "USD" ? totalARS / cotizacion : totalARS;
            await this.proveedorRepo.insertSoloVisualizacion({
              cuentaId:        ccProv.id,
              tipo:            "pago",
              concepto:        `Reposición — ${orderRow.id.slice(0, 8)}`,
              monto:           montoEnCuenta,
              orderId:         orderRow.id,
              metodo_pago:     data.payment_method,
              divisa_cuenta:   divisaCC,
              divisa_cobro:    "ARS",
              monto_original:  totalARS,
              cotizacion_usada: divisaCC === "USD" ? cotizacion : null,
            }, client);
          }
          await client.query("RELEASE SAVEPOINT visual_entry_prov");
        } catch (err) {
          console.warn("CC provider visual entry failed (non-blocking):", err.message);
          try { await client.query("ROLLBACK TO SAVEPOINT visual_entry_prov"); } catch {}
        }
      }

      // ── Devolución → sumar stock al warehouse ───────────────
      if (esDevolucion && warehouseId) {
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
      if (esDevolucion && !warehouseId) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          await this._returnStock(client, item.product_id, item.quantity, null);
        }
      }

      // ── Devol a proveedor → restar stock del depósito ORIGEN ──
      if (esDevolProv && stockWarehouseId) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          await client.query(
            `UPDATE stock SET quantity = quantity - $1
             WHERE product_id = $2 AND warehouse_id = $3`,
            [item.quantity, item.product_id, stockWarehouseId]
          );
        }
      }
      if (esDevolProv && !stockWarehouseId) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          await this._deductStock(client, item.product_id, item.quantity, null);
        }
      }
      // Debitar CC proveedor (le debemos menos)
      if (esDevolProv && data.supplier_id && totalARS > 0) {
        const ccProv        = await this.proveedorRepo.getOrCreateCC(data.supplier_id, client);
        const divisaCC      = ccProv.divisa ?? "ARS";
        const montoEnCuenta = divisaCC === "USD" ? totalARS / cotizacion : totalARS;

        await client.query(
          `UPDATE cuentas_corrientes_prov SET saldo = saldo - $1, updated_at = NOW() WHERE id = $2`,
          [montoEnCuenta, ccProv.id]
        );
        await client.query(
          `INSERT INTO cc_movimientos_prov
             (cuenta_corriente_id, tipo, concepto, monto, order_id,
              divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada)
           VALUES ($1,'debito',$2,$3,$4,$5,$6,$7,$8)`,
          [
            ccProv.id,
            `Devolución a proveedor — ${orderRow.id.slice(0, 8)}`,
            montoEnCuenta, orderRow.id,
            divisaCC, "ARS", totalARS,
            divisaCC === "USD" ? cotizacion : null,
          ]
        );
      }

      await client.query("COMMIT");

      if (_completionEmail?.email) {
        sendOrderCompletedEmail({
          to:           _completionEmail.email,
          customerName: _completionEmail.name,
          orderId:      _completionEmail.id,
          total:        _completionEmail.total,
        }).catch(() => {});
      }

      return orderRow;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // EDITAR
  // ─────────────────────────────────────────────────────────────
  async update(id, data) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const orderRes = await client.query(
        `SELECT * FROM orders WHERE id = $1`, [id]
      );
      const order = orderRes.rows[0];
      if (!order) throw new Error("Comprobante no encontrado");
      if (order.deleted_at) throw new Error("No se puede editar un comprobante eliminado");

      const tipo            = order.tipo;
      const warehouseId     = order.warehouse_id;
      const esPresupuesto   = tipo === "Presupuesto" || tipo === "Presupuesto Web";
      const esNota          = tipo === "Nota de Pedido" || tipo === "Nota de Pedido Web";
      const esReposicion    = tipo === "Reposicion";
      const esDevolucion    = tipo === "Devolucion";
      const esDevolProv     = tipo === "Devol a proveedor";
      // Para repos/devolProv el stock vive en el warehouse guardado en `destino`
      const stockWarehouseId = (esReposicion || esDevolProv)
        ? (order.destino || order.warehouse_id)
        : warehouseId;

      const oldItemsRes = await client.query(
        `SELECT oi.*, p.name, p.code FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = $1`, [id]
      );
      const oldItems = oldItemsRes.rows;
      const newItemsRaw = data.items || [];

      // Para órdenes en USD: items llegan en USD desde el frontend, convertir a ARS para almacenamiento
      const divisaOrder = order.divisa || "ARS";
      let cotizUSD = null;
      if (divisaOrder === "USD") {
        const cotizResEarly = await client.query(
          `SELECT cotizacion_dolar FROM price_config WHERE negocio_id = $1 LIMIT 1`,
          [order.negocio_id]
        );
        cotizUSD = Number(cotizResEarly.rows[0]?.cotizacion_dolar || 1000);
      }
      const newItems = cotizUSD
        ? newItemsRaw.map(i => ({ ...i, unit_price: Math.round(Number(i.unit_price) * cotizUSD * 100) / 100 }))
        : newItemsRaw;

      // ── Calcular diff de stock por producto ─────────────────
      const stockDiff = {};
      for (const oi of oldItems) {
        if (!oi.product_id) continue;
        if (!stockDiff[oi.product_id]) stockDiff[oi.product_id] = { old: 0, new: 0 };
        stockDiff[oi.product_id].old += oi.quantity;
      }
      for (const ni of newItems) {
        if (!ni.product_id) continue;
        if (!stockDiff[ni.product_id]) stockDiff[ni.product_id] = { old: 0, new: 0 };
        stockDiff[ni.product_id].new += ni.quantity;
      }

      for (const [productId, { old: oldQty, new: newQty }] of Object.entries(stockDiff)) {
        const delta = newQty - oldQty;
        if (delta === 0) continue;

        if (esPresupuesto) {
          if (delta > 0) await this._deductStock(client, productId, delta, warehouseId);
          else           await this._returnStock(client, productId, -delta, warehouseId);
        } else if (esNota) {
          await client.query(
            `UPDATE products SET stock_reserva = GREATEST(0, stock_reserva + $1) WHERE id = $2`,
            [delta, productId]
          );
        } else if (esReposicion) {
          if (stockWarehouseId) {
            await client.query(
              `INSERT INTO stock (product_id, warehouse_id, quantity) VALUES ($1,$2,$3)
               ON CONFLICT (product_id, warehouse_id)
               DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
              [productId, stockWarehouseId, delta]
            );
          }
        } else if (esDevolucion) {
          if (warehouseId) {
            await client.query(
              `INSERT INTO stock (product_id, warehouse_id, quantity) VALUES ($1,$2,$3)
               ON CONFLICT (product_id, warehouse_id)
               DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
              [productId, warehouseId, delta]
            );
          } else {
            if (delta > 0) await this._returnStock(client, productId, delta, null);
            else           await this._deductStock(client, productId, -delta, null);
          }
        } else if (esDevolProv) {
          if (stockWarehouseId) {
            await client.query(
              `UPDATE stock SET quantity = quantity - $1
               WHERE product_id = $2 AND warehouse_id = $3`,
              [delta, productId, stockWarehouseId]
            );
          }
        }
      }

      // ── Recalcular total y ajustar CC ────────────────────────
      // newItems ya están en ARS (se convirtió arriba si cotizUSD != null)
      const rawNewTotalARS  = Math.round(newItems.reduce((acc, i) => acc + Number(i.unit_price) * Number(i.quantity), 0) * 100) / 100;
      const descuentoPctUpd = data.descuento_pct !== undefined ? Number(data.descuento_pct ?? 0) : Number(order.descuento_pct ?? 0);
      const newTotalARS     = Math.round(rawNewTotalARS * (1 - descuentoPctUpd / 100) * 100) / 100;
      const newTotal        = cotizUSD
        ? Math.round((newTotalARS / cotizUSD) * 100) / 100  // guardar en USD
        : newTotalARS;
      const oldTotalStored = Number(order.total);
      const oldTotalARS    = cotizUSD ? Math.round(oldTotalStored * cotizUSD * 100) / 100 : oldTotalStored;
      const totalDelta     = newTotalARS - oldTotalARS; // siempre en ARS para lógica CC

      const paymentRes = await client.query(
        `SELECT method FROM payments WHERE order_id = $1 LIMIT 1`, [id]
      );
      const oldPaymentMethod     = paymentRes.rows[0]?.method || null;
      const newPaymentMethod     = data.payment_method !== undefined ? data.payment_method : oldPaymentMethod;
      const paymentMethodChanged = data.payment_method !== undefined && data.payment_method !== oldPaymentMethod;
      const wasCtaCte            = oldPaymentMethod === "Cta Cte";
      const isCtaCte             = newPaymentMethod === "Cta Cte";

      // Detectar cambio de cliente
      const newCustomerId        = data.customer_id !== undefined ? (data.customer_id || null) : order.customer_id;
      const newEsConsumidorFinal = data.es_consumidor_final !== undefined ? !!data.es_consumidor_final : !!order.es_consumidor_final;
      const oldCustomerId        = order.customer_id;
      const oldEsConsumidorFinal = !!order.es_consumidor_final;
      const customerChanged      = newCustomerId !== oldCustomerId || newEsConsumidorFinal !== oldEsConsumidorFinal;

      if ((esPresupuesto || esDevolucion) && (wasCtaCte || isCtaCte)) {
        const cotizRes = await client.query(
          `SELECT cotizacion_dolar FROM price_config WHERE negocio_id = $1 LIMIT 1`,
          [order.negocio_id]
        );
        const cotizacion = Number(cotizRes.rows[0]?.cotizacion_dolar || 1000);

        if (paymentMethodChanged && wasCtaCte && !isCtaCte) {
          // Cambio DE Cta Cte A otro método: eliminar entradas reales, revertir saldo, insertar visual
          if (oldCustomerId && !oldEsConsumidorFinal) {
            const cc = await this.ccRepo.getOrCreate(oldCustomerId, client);
            const divisaCC = cc.divisa ?? "ARS";
            // Eliminar entradas que afectan saldo y revertir su efecto
            const existingMovs = await client.query(
              `SELECT id, tipo, monto FROM cc_movimientos
               WHERE cuenta_corriente_id = $1 AND order_id = $2 AND afecta_saldo = TRUE`,
              [cc.id, id]
            );
            for (const mov of existingMovs.rows) {
              const saldoDelta = mov.tipo === "debito" ? -Number(mov.monto) : Number(mov.monto);
              if (saldoDelta !== 0) {
                await client.query(
                  `UPDATE cuentas_corrientes SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
                  [saldoDelta, cc.id]
                );
              }
              await client.query(`DELETE FROM cc_movimientos WHERE id = $1`, [mov.id]);
            }
            // Insertar entrada visual con el método nuevo y el concepto correcto
            const montoEnCuenta = divisaCC === "USD" ? newTotalARS / cotizacion : newTotalARS;
            if (montoEnCuenta !== 0) {
              await this.ccRepo.insertSoloVisualizacion({
                cuentaId:         cc.id,
                tipo:             esPresupuesto ? "debito" : "pago",
                concepto:         `${tipo} — ${id.slice(0, 8)}`,
                monto:            Math.abs(montoEnCuenta),
                orderId:          id,
                metodo_pago:      newPaymentMethod,
                divisa_cuenta:    divisaCC,
                divisa_cobro:     "ARS",
                monto_original:   newTotalARS,
                cotizacion_usada: divisaCC === "USD" ? cotizacion : null,
              }, client);
            }
          }
        } else if (paymentMethodChanged && !wasCtaCte && isCtaCte) {
          // Cambio A Cta Cte desde otro método: eliminar entrada visual previa, aplicar monto real
          if (newCustomerId && !newEsConsumidorFinal) {
            const cc = await this.ccRepo.getOrCreate(newCustomerId, client);
            // Eliminar entrada visual previa sin tocar el saldo
            await client.query(
              `DELETE FROM cc_movimientos WHERE order_id = $1 AND afecta_saldo = FALSE AND cuenta_corriente_id = $2`,
              [id, cc.id]
            );
            const divisaCC      = cc.divisa ?? "ARS";
            const montoEnCuenta = divisaCC === "USD" ? newTotalARS / cotizacion : newTotalARS;
            if (montoEnCuenta !== 0) {
              const tipoMov  = esPresupuesto ? "debito" : "pago";
              const saldoAdj = esPresupuesto ? montoEnCuenta : -montoEnCuenta;
              await client.query(
                `INSERT INTO cc_movimientos
                   (cuenta_corriente_id, tipo, concepto, monto, order_id, metodo_pago,
                    divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [cc.id, tipoMov, `${tipo} — ${id.slice(0,8)}`,
                 Math.abs(montoEnCuenta), id, "Cuenta Corriente",
                 divisaCC, "ARS", newTotalARS,
                 divisaCC === "USD" ? cotizacion : null]
              );
              await client.query(
                `UPDATE cuentas_corrientes SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
                [saldoAdj, cc.id]
              );
            }
          }
        } else if (isCtaCte && customerChanged) {
          // Mismo método Cta Cte, cambio de cliente
          if (oldCustomerId && !oldEsConsumidorFinal) {
            const ccOld = await this.ccRepo.getOrCreate(oldCustomerId, client);
            const divisaCC = ccOld.divisa ?? "ARS";
            const montoEnCuenta = divisaCC === "USD" ? oldTotalARS / cotizacion : oldTotalARS;
            if (montoEnCuenta !== 0) {
              const tipoMov  = esPresupuesto ? "pago" : "debito";
              const saldoAdj = esPresupuesto ? -montoEnCuenta : montoEnCuenta;
              await client.query(
                `INSERT INTO cc_movimientos
                   (cuenta_corriente_id, tipo, concepto, monto, order_id,
                    divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [ccOld.id, tipoMov, `Reversión cliente — ${id.slice(0,8)}`,
                 Math.abs(montoEnCuenta), id, divisaCC, "ARS", oldTotalARS,
                 divisaCC === "USD" ? cotizacion : null]
              );
              await client.query(
                `UPDATE cuentas_corrientes SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
                [saldoAdj, ccOld.id]
              );
            }
          }
          if (newCustomerId && !newEsConsumidorFinal) {
            const ccNew = await this.ccRepo.getOrCreate(newCustomerId, client);
            const divisaCC = ccNew.divisa ?? "ARS";
            const montoEnCuenta = divisaCC === "USD" ? newTotalARS / cotizacion : newTotalARS;
            if (montoEnCuenta !== 0) {
              const tipoMov  = esPresupuesto ? "debito" : "pago";
              const saldoAdj = esPresupuesto ? montoEnCuenta : -montoEnCuenta;
              await client.query(
                `INSERT INTO cc_movimientos
                   (cuenta_corriente_id, tipo, concepto, monto, order_id,
                    divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [ccNew.id, tipoMov, `Asignación cliente — ${id.slice(0,8)}`,
                 Math.abs(montoEnCuenta), id, divisaCC, "ARS", newTotalARS,
                 divisaCC === "USD" ? cotizacion : null]
              );
              await client.query(
                `UPDATE cuentas_corrientes SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
                [saldoAdj, ccNew.id]
              );
            }
          }
        } else if (isCtaCte && totalDelta !== 0 && oldCustomerId && !oldEsConsumidorFinal) {
          // Mismo método Cta Cte, mismo cliente, solo ajuste de monto.
          // En lugar de acumular movimientos de ajuste (que complican el delete),
          // reemplazamos todos los movimientos existentes del comprobante con uno
          // solo que refleja el total actual. El saldo sigue ajustándose por delta.
          const cc = await this.ccRepo.getOrCreate(oldCustomerId, client);
          const divisaCC         = cc.divisa ?? "ARS";
          const deltaEnCuenta    = divisaCC === "USD" ? totalDelta / cotizacion : totalDelta;
          const newMontoEnCuenta = divisaCC === "USD" ? newTotalARS / cotizacion : newTotalARS;

          if (deltaEnCuenta !== 0) {
            const tipoMov    = esPresupuesto ? "debito" : "pago";
            const saldoDelta = esPresupuesto ? deltaEnCuenta : -deltaEnCuenta;

            // Preservar la fecha original del movimiento antes de borrarlo
            const existingMov = await client.query(
              `SELECT created_at FROM cc_movimientos
               WHERE cuenta_corriente_id = $1
                 AND (order_id = $2 OR concepto LIKE '% — ' || LEFT($2::text, 8))
               ORDER BY created_at ASC LIMIT 1`,
              [cc.id, id]
            );
            const originalCreatedAt = existingMov.rows[0]?.created_at ?? order.created_at;

            await client.query(
              `DELETE FROM cc_movimientos
               WHERE cuenta_corriente_id = $1
                 AND (order_id = $2 OR concepto LIKE '% — ' || LEFT($2::text, 8))`,
              [cc.id, id]
            );
            await client.query(
              `INSERT INTO cc_movimientos
                 (cuenta_corriente_id, tipo, concepto, monto, order_id,
                  divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [cc.id, tipoMov, `${tipo} — ${id.slice(0, 8)}`,
               Math.abs(newMontoEnCuenta), id,
               divisaCC, "ARS", Math.abs(newTotalARS),
               divisaCC === "USD" ? cotizacion : null,
               originalCreatedAt]
            );
            await client.query(
              `UPDATE cuentas_corrientes SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
              [saldoDelta, cc.id]
            );
          }
        }
      }

      // CC proveedor (reposición o devol a proveedor) — maneja cambio de método de pago
      if ((esReposicion || esDevolProv) && order.supplier_id && (wasCtaCte || isCtaCte)) {
        const cotizRes = await client.query(
          `SELECT cotizacion_dolar FROM price_config WHERE negocio_id = $1 LIMIT 1`,
          [order.negocio_id]
        );
        const cotizacion = Number(cotizRes.rows[0]?.cotizacion_dolar || 1000);
        const ccProv   = await this.proveedorRepo.getOrCreateCC(order.supplier_id, client);
        const divisaCC = ccProv.divisa ?? "ARS";

        if (paymentMethodChanged && wasCtaCte && !isCtaCte) {
          // Cambio DE Cta Cte A otro método: revertir todos los movimientos de este comprobante
          const movsProv = await client.query(
            `SELECT id, tipo, monto FROM cc_movimientos_prov WHERE order_id = $1`, [id]
          );
          for (const mov of movsProv.rows) {
            const saldoDelta = mov.tipo === "pago" ? -Number(mov.monto) : Number(mov.monto);
            if (saldoDelta !== 0) {
              await client.query(
                `UPDATE cuentas_corrientes_prov SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
                [saldoDelta, ccProv.id]
              );
            }
            await client.query(`DELETE FROM cc_movimientos_prov WHERE id = $1`, [mov.id]);
          }
        } else if (paymentMethodChanged && !wasCtaCte && isCtaCte) {
          // Cambio A Cta Cte desde otro método: aplicar monto completo
          const montoEnCuenta = divisaCC === "USD" ? newTotalARS / cotizacion : newTotalARS;
          if (montoEnCuenta !== 0) {
            const saldoDelta = esReposicion ? montoEnCuenta : -montoEnCuenta;
            await client.query(
              `INSERT INTO cc_movimientos_prov
                 (cuenta_corriente_id, tipo, concepto, monto, order_id,
                  divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [ccProv.id, saldoDelta > 0 ? "pago" : "debito",
               `Aplicación Cta Cte — ${id.slice(0, 8)}`,
               Math.abs(montoEnCuenta), id,
               divisaCC, "ARS", Math.abs(newTotalARS),
               divisaCC === "USD" ? cotizacion : null]
            );
            await client.query(
              `UPDATE cuentas_corrientes_prov SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
              [saldoDelta, ccProv.id]
            );
          }
        } else if (isCtaCte && totalDelta !== 0) {
          // Mismo método Cta Cte, solo cambió el monto
          const deltaEnCuenta = divisaCC === "USD" ? totalDelta / cotizacion : totalDelta;
          if (deltaEnCuenta !== 0) {
            const saldoDelta = esReposicion ? deltaEnCuenta : -deltaEnCuenta;
            await client.query(
              `UPDATE cuentas_corrientes_prov SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
              [saldoDelta, ccProv.id]
            );
            await client.query(
              `INSERT INTO cc_movimientos_prov
                 (cuenta_corriente_id, tipo, concepto, monto, order_id,
                  divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [ccProv.id, saldoDelta > 0 ? "pago" : "debito",
               `Ajuste edición — ${id.slice(0, 8)}`,
               Math.abs(deltaEnCuenta), id,
               divisaCC, "ARS", Math.abs(totalDelta),
               divisaCC === "USD" ? cotizacion : null]
            );
          }
        }
      }

      // CC cliente: comprobante no-CC → actualizar entrada visual si cambió algo
      if ((esPresupuesto || esDevolucion) && !wasCtaCte && !isCtaCte &&
          (totalDelta !== 0 || paymentMethodChanged || customerChanged)) {
        try {
          const cotizRes = await client.query(
            `SELECT cotizacion_dolar FROM price_config WHERE negocio_id = $1 LIMIT 1`,
            [order.negocio_id]
          );
          const cotizacion = Number(cotizRes.rows[0]?.cotizacion_dolar || 1000);

          if (oldCustomerId && !oldEsConsumidorFinal) {
            const ccOld = await this.ccRepo.getOrCreate(oldCustomerId, client);
            if (ccOld) {
              const existingVis = await client.query(
                `SELECT created_at FROM cc_movimientos
                 WHERE cuenta_corriente_id = $1 AND order_id = $2 AND afecta_saldo = FALSE
                 ORDER BY created_at ASC LIMIT 1`,
                [ccOld.id, id]
              );
              const originalCreatedAt = existingVis.rows[0]?.created_at ?? order.created_at;
              await client.query(
                `DELETE FROM cc_movimientos WHERE cuenta_corriente_id = $1 AND order_id = $2 AND afecta_saldo = FALSE`,
                [ccOld.id, id]
              );
              if (!customerChanged && newTotalARS !== 0) {
                const divisaCC = ccOld.divisa ?? "ARS";
                const montoEnCuenta = divisaCC === "USD" ? newTotalARS / cotizacion : newTotalARS;
                await client.query(
                  `INSERT INTO cc_movimientos
                     (cuenta_corriente_id, tipo, concepto, monto, order_id, metodo_pago,
                      divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada, afecta_saldo, created_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, FALSE, $11)`,
                  [ccOld.id, esPresupuesto ? "debito" : "pago",
                   `${tipo} — ${id.slice(0, 8)}`,
                   Math.abs(montoEnCuenta), id, newPaymentMethod,
                   divisaCC, "ARS", Math.abs(newTotalARS),
                   divisaCC === "USD" ? cotizacion : null,
                   originalCreatedAt]
                );
              }
            }
          }
          if (customerChanged && newCustomerId && !newEsConsumidorFinal && newTotalARS !== 0) {
            const ccNew = await this.ccRepo.getOrCreate(newCustomerId, client);
            if (ccNew) {
              const divisaCC = ccNew.divisa ?? "ARS";
              const montoEnCuenta = divisaCC === "USD" ? newTotalARS / cotizacion : newTotalARS;
              await client.query(
                `INSERT INTO cc_movimientos
                   (cuenta_corriente_id, tipo, concepto, monto, order_id, metodo_pago,
                    divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada, afecta_saldo)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, FALSE)`,
                [ccNew.id, esPresupuesto ? "debito" : "pago",
                 `${tipo} — ${id.slice(0, 8)}`,
                 Math.abs(montoEnCuenta), id, newPaymentMethod,
                 divisaCC, "ARS", Math.abs(newTotalARS),
                 divisaCC === "USD" ? cotizacion : null]
              );
            }
          }
        } catch (err) {
          console.warn("CC visual update (cliente) failed (non-blocking):", err.message);
        }
      }

      // CC proveedor: reposición/devol no-CC → actualizar entrada visual si cambió algo
      if ((esReposicion || esDevolProv) && !wasCtaCte && !isCtaCte &&
          order.supplier_id && (totalDelta !== 0 || paymentMethodChanged)) {
        try {
          const cotizRes = await client.query(
            `SELECT cotizacion_dolar FROM price_config WHERE negocio_id = $1 LIMIT 1`,
            [order.negocio_id]
          );
          const cotizacion = Number(cotizRes.rows[0]?.cotizacion_dolar || 1000);
          const ccProv = await this.proveedorRepo.getOrCreateCC(order.supplier_id, client);
          if (ccProv) {
            const divisaCC = ccProv.divisa ?? "ARS";
            const newMontoEnCuenta = divisaCC === "USD" ? newTotalARS / cotizacion : newTotalARS;
            const existingVis = await client.query(
              `SELECT created_at FROM cc_movimientos_prov
               WHERE cuenta_corriente_id = $1 AND order_id = $2 AND afecta_saldo = FALSE
               ORDER BY created_at ASC LIMIT 1`,
              [ccProv.id, id]
            );
            const originalCreatedAt = existingVis.rows[0]?.created_at ?? order.created_at;
            await client.query(
              `DELETE FROM cc_movimientos_prov WHERE cuenta_corriente_id = $1 AND order_id = $2 AND afecta_saldo = FALSE`,
              [ccProv.id, id]
            );
            if (newMontoEnCuenta !== 0) {
              await client.query(
                `INSERT INTO cc_movimientos_prov
                   (cuenta_corriente_id, tipo, concepto, monto, order_id, metodo_pago,
                    divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada, afecta_saldo, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, FALSE, $11)`,
                [ccProv.id, esReposicion ? "pago" : "debito",
                 `${esReposicion ? "Reposición" : "Devol a proveedor"} — ${id.slice(0, 8)}`,
                 Math.abs(newMontoEnCuenta), id, newPaymentMethod,
                 divisaCC, "ARS", Math.abs(newTotalARS),
                 divisaCC === "USD" ? cotizacion : null,
                 originalCreatedAt]
              );
            }
          }
        } catch (err) {
          console.warn("CC visual update (proveedor) failed (non-blocking):", err.message);
        }
      }

      // ── Reemplazar items ────────────────────────────────────
      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [id]);
      for (const item of newItems) {
        await this.itemRepo.create(item, id, client);
      }

      // ── Actualizar campos del order ─────────────────────────
      const updates = { total: newTotal };
      if (data.vendedor              !== undefined) updates.vendedor              = data.vendedor;
      if (data.texto_libre           !== undefined) updates.texto_libre           = data.texto_libre;
      if (data.price_type            !== undefined) updates.price_type            = data.price_type;
      if (data.customer_id           !== undefined) updates.customer_id           = data.customer_id || null;
      if (data.supplier_id           !== undefined) updates.supplier_id           = data.supplier_id || null;
      if (data.es_consumidor_final   !== undefined) updates.es_consumidor_final   = !!data.es_consumidor_final;
      if (data.consumidor_final_nombre !== undefined) updates.consumidor_final_nombre = data.consumidor_final_nombre || null;
      if (data.divisa                !== undefined) updates.divisa                = data.divisa;
      if (data.edited_by_user_id     !== undefined) updates.edited_by_user_id     = data.edited_by_user_id || null;
      if (data.edited_by_name        !== undefined) updates.edited_by_name        = data.edited_by_name    || null;
      if (data.descuento_pct         !== undefined) updates.descuento_pct         = descuentoPctUpd;

      const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
      await client.query(
        `UPDATE orders SET ${setClauses.join(", ")} WHERE id = $1`,
        [id, ...Object.values(updates)]
      );

      if (data.payment_method !== undefined && data.payment_method !== oldPaymentMethod) {
        await client.query(
          `UPDATE payments SET method = $1, amount = $2 WHERE order_id = $3`,
          [data.payment_method, isCtaCte ? 0 : newTotal, id]
        );
      }

      await client.query("COMMIT");
      return this.orderRepo.getById(id);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // ELIMINAR (soft delete)
  // El comprobante NO se borra: se marca como eliminado y se
  // revierte stock + CC al estado previo a su creación.
  // Items y payments se conservan para visualización histórica.
  // ─────────────────────────────────────────────────────────────
  async delete(id, audit = {}) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const orderRes = await client.query(
        `SELECT * FROM orders WHERE id = $1`, [id]
      );
      const order = orderRes.rows[0];
      if (!order) throw new Error("Comprobante no encontrado");
      if (order.deleted_at) throw new Error("El comprobante ya está eliminado");

      const tipo            = order.tipo;
      const warehouseId     = order.warehouse_id;
      const esPresupuesto   = tipo === "Presupuesto" || tipo === "Presupuesto Web";
      const esNota          = tipo === "Nota de Pedido" || tipo === "Nota de Pedido Web";
      const esReposicion    = tipo === "Reposicion";
      const esDevolucion    = tipo === "Devolucion";
      const esDevolProv     = tipo === "Devol a proveedor";
      const stockWarehouseId = (esReposicion || esDevolProv)
        ? (order.destino || order.warehouse_id)
        : warehouseId;

      const itemsRes = await client.query(
        `SELECT product_id, quantity FROM order_items WHERE order_id = $1`, [id]
      );
      const items = itemsRes.rows;

      const paymentRes = await client.query(
        `SELECT method FROM payments WHERE order_id = $1 LIMIT 1`, [id]
      );
      const esCuentaCorriente = paymentRes.rows[0]?.method === "Cta Cte";

      // ── Revertir stock ──────────────────────────────────────
      // Usa los items vigentes (post-ediciones), igual que antes.
      for (const item of items) {
        if (!item.product_id) continue;

        if (esPresupuesto) {
          await this._returnStock(client, item.product_id, item.quantity, warehouseId);
        } else if (esNota) {
          await client.query(
            `UPDATE products SET stock_reserva = GREATEST(0, stock_reserva - $1) WHERE id = $2`,
            [item.quantity, item.product_id]
          );
        } else if (esReposicion && stockWarehouseId) {
          await client.query(
            `UPDATE stock SET quantity = quantity - $1
             WHERE product_id = $2 AND warehouse_id = $3`,
            [item.quantity, item.product_id, stockWarehouseId]
          );
        } else if (esDevolucion) {
          if (warehouseId) {
            await client.query(
              `UPDATE stock SET quantity = quantity - $1
               WHERE product_id = $2 AND warehouse_id = $3`,
              [item.quantity, item.product_id, warehouseId]
            );
          } else {
            await this._deductStock(client, item.product_id, item.quantity, null);
          }
        } else if (esDevolProv) {
          if (stockWarehouseId) {
            await client.query(
              `INSERT INTO stock (product_id, warehouse_id, quantity) VALUES ($1,$2,$3)
               ON CONFLICT (product_id, warehouse_id)
               DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
              [item.product_id, stockWarehouseId, item.quantity]
            );
          } else {
            await this._returnStock(client, item.product_id, item.quantity, null);
          }
        }
      }

      // ── Revertir CC cliente ─────────────────────────────────
      // Importante: revertir TODOS los movimientos creados por este order
      // (el original más cualquier ajuste posterior por edición). De lo
      // contrario, después de editar y eliminar quedan saldos colgados.
      // Una edición puede haber cambiado el cliente, así que los movs pueden
      // estar repartidos en más de una cuenta corriente.
      // Convención de signos en cc_movimientos:
      //   tipo='debito' sumó saldo al crearse → al revertir restamos
      //   tipo='pago'   restó saldo al crearse → al revertir sumamos
      const movsCli = await client.query(
        `SELECT id, cuenta_corriente_id, tipo, monto, afecta_saldo
         FROM cc_movimientos
         WHERE order_id = $1
            OR concepto LIKE '% — ' || LEFT($1::text, 8)`,
        [id]
      );
      for (const mov of movsCli.rows) {
        if (mov.afecta_saldo !== false) {
          const saldoDelta = mov.tipo === "debito"
            ? -Number(mov.monto)
            :  Number(mov.monto);
          if (saldoDelta !== 0) {
            await client.query(
              `UPDATE cuentas_corrientes SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
              [saldoDelta, mov.cuenta_corriente_id]
            );
          }
        }
        await client.query(`DELETE FROM cc_movimientos WHERE id = $1`, [mov.id]);
      }

      // ── Revertir CC proveedor ───────────────────────────────
      // En cuentas_corrientes_prov el signo es opuesto al de cliente:
      //   tipo='pago'   sumó saldo (reposición acreditó al proveedor)
      //   tipo='debito' restó saldo (devolución debitó saldo al proveedor)
      const movsProv = await client.query(
        `SELECT id, cuenta_corriente_id, tipo, monto
         FROM cc_movimientos_prov
         WHERE order_id = $1
            OR concepto LIKE '% — ' || LEFT($1::text, 8)`,
        [id]
      );
      for (const mov of movsProv.rows) {
        const saldoDelta = mov.tipo === "pago"
          ? -Number(mov.monto)
          :  Number(mov.monto);
        if (saldoDelta !== 0) {
          await client.query(
            `UPDATE cuentas_corrientes_prov SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
            [saldoDelta, mov.cuenta_corriente_id]
          );
        }
        await client.query(`DELETE FROM cc_movimientos_prov WHERE id = $1`, [mov.id]);
      }

      // ── Soft delete: el comprobante sigue existiendo ────────
      // Items y payments se conservan para que el detalle siga siendo visible.
      await client.query(
        `UPDATE web_orders SET order_id = NULL WHERE order_id = $1`,
        [id]
      );
      await client.query(
        `UPDATE orders
         SET deleted_at         = NOW(),
             deleted_by_user_id = $2,
             deleted_by_name    = $3
         WHERE id = $1`,
        [id, audit.deleted_by_user_id || null, audit.deleted_by_name || null]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // HELPERS DE STOCK
  // ─────────────────────────────────────────────────────────────
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
        `SELECT id, quantity FROM stock WHERE product_id = $1 ORDER BY quantity DESC`,
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

  async _returnStock(client, productId, quantity, warehouseId) {
    if (warehouseId) {
      await client.query(
        `INSERT INTO stock (product_id, warehouse_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (product_id, warehouse_id)
         DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
        [productId, warehouseId, quantity]
      );
    } else {
      const { rows } = await client.query(
        `SELECT id FROM stock WHERE product_id = $1 ORDER BY quantity ASC LIMIT 1`,
        [productId]
      );
      if (rows.length > 0) {
        await client.query(
          `UPDATE stock SET quantity = quantity + $1 WHERE id = $2`,
          [quantity, rows[0].id]
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // LECTURA
  // ─────────────────────────────────────────────────────────────
  getById(id)     { return this.orderRepo.getById(id); }
  getAll(filters) { return this.orderRepo.getAll(filters); }

  async getListado({ from, to, warehouseId, warehouseName, negocioId } = {}) {
    const client = await pool.connect();
    try {
      const dateFrom = from ? `${from} 00:00:00` : "1970-01-01";
      const dateTo   = to   ? `${to} 23:59:59`   : "2099-12-31";

      // ── Presupuestos ─────────────────────────────────────────
      // NO convertir el total — devolver en la divisa original del comprobante.
      // El frontend ya muestra el símbolo correcto según p.divisa.
      const presParams = [dateFrom, dateTo];
      const presNegocioFilter = negocioId ? ` AND o.negocio_id = $${presParams.push(negocioId)}` : "";
      const presWhFilter = warehouseId ? ` AND o.warehouse_id = $${presParams.push(warehouseId)}` : "";
      const presRes = await client.query(`
        SELECT
          o.id, o.tipo, o.created_at, o.vendedor, o.texto_libre, o.price_type,
          o.es_consumidor_final, o.consumidor_final_nombre,
          COALESCE(NULLIF(o.divisa, ''), 'ARS') AS divisa,
          o.total,
          o.created_by_name, o.edited_by_name,
          o.deleted_at, o.deleted_by_name,
          CASE
            WHEN o.es_consumidor_final THEN COALESCE(o.consumidor_final_nombre, 'Consumidor Final')
            ELSE COALESCE(c.name, pr.name)
          END AS customer_name,
          p.method AS payment_method
        FROM orders o
        LEFT JOIN customers   c  ON c.id  = o.customer_id
        LEFT JOIN proveedores pr ON pr.id = o.supplier_id
        LEFT JOIN payments    p  ON p.order_id = o.id
        WHERE o.tipo IN ('Presupuesto', 'Presupuesto Web', 'Devolucion')
          AND o.deleted_at IS NULL
          AND o.created_at BETWEEN $1 AND $2
          ${presNegocioFilter}
          ${presWhFilter}
        ORDER BY o.created_at DESC
      `, presParams);

      // ── Reposiciones y Devol a proveedor ─────────────────────
      // Tampoco convertir — devolver total en su divisa.
      const reposParams = [dateFrom, dateTo];
      const reposNegocioFilter = negocioId ? ` AND o.negocio_id = $${reposParams.push(negocioId)}` : "";
      const reposWhFilter = warehouseId ? ` AND o.warehouse_id = $${reposParams.push(warehouseId)}` : "";
      const reposRes = await client.query(`
        SELECT
          o.id, o.tipo, o.created_at, o.vendedor, o.texto_libre,
          o.supplier_id, o.warehouse_id,
          pr.name AS supplier_name,
          w.name  AS warehouse_name,
          COALESCE(NULLIF(o.divisa, ''), 'ARS') AS divisa,
          o.total,
          o.created_by_name, o.edited_by_name,
          o.deleted_at, o.deleted_by_name
        FROM orders o
        LEFT JOIN proveedores pr ON pr.id = o.supplier_id
        LEFT JOIN warehouses  w  ON w.id  = o.warehouse_id
        WHERE o.tipo IN ('Reposicion', 'Devol a proveedor')
          AND o.deleted_at IS NULL
          AND o.created_at BETWEEN $1 AND $2
          ${reposNegocioFilter}
          ${reposWhFilter}
        ORDER BY o.created_at DESC
      `, reposParams);

      const reposConItems = [];
      for (const r of reposRes.rows) {
        const itemsRes = await client.query(`
          SELECT oi.*, p.name, p.code
          FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = $1
        `, [r.id]);
        reposConItems.push({ ...r, items: itemsRes.rows });
      }

      // ── Notas de Pedido (sin filtro de fecha — siempre todas) ──
      const notasParams = [];
      const notasNegocioFilter = negocioId ? ` AND o.negocio_id = $${notasParams.push(negocioId)}` : "";
      const notasWhFilter = warehouseId ? ` AND (o.warehouse_id = $${notasParams.push(warehouseId)} OR o.tipo IN ('Nota de Pedido', 'Nota de Pedido Web'))` : "";
      const notasRes = await client.query(`
        SELECT o.id, o.tipo, o.created_at, o.total, o.vendedor, o.texto_libre,
               o.customer_id, o.price_type, c.name AS customer_name,
               pm.method AS payment_method,
               wo.numero AS web_order_numero,
               w.name AS warehouse_name,
               o.created_by_name, o.edited_by_name,
               o.deleted_at, o.deleted_by_name,
               COALESCE(NULLIF(o.divisa, ''), 'ARS') AS divisa,
               COALESCE(o.descuento_pct, 0) AS descuento_pct
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN payments pm ON pm.order_id = o.id
        LEFT JOIN web_orders wo ON wo.order_id = o.id
        LEFT JOIN warehouses w ON w.id = o.warehouse_id
        WHERE o.tipo IN ('Nota de Pedido', 'Nota de Pedido Web')
          AND o.deleted_at IS NULL
          ${notasNegocioFilter}
          ${notasWhFilter}
        ORDER BY o.created_at DESC
      `, notasParams);

      const notasConItems = [];
      for (const nota of notasRes.rows) {
        const itemsRes = await client.query(`
          SELECT oi.*, p.name, p.code
          FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = $1
        `, [nota.id]);
        notasConItems.push({ ...nota, items: itemsRes.rows });
      }

      // ── Remitos ──────────────────────────────────────────────
      const remitosParams = [dateFrom, dateTo];
      const remitosNegocioFilter = negocioId ? ` AND o.negocio_id = $${remitosParams.push(negocioId)}` : "";
      const remitosWhFilter = warehouseId
        ? ` AND o.warehouse_id = $${remitosParams.push(warehouseId)}`
        : "";
      const remitosRes = await client.query(`
        SELECT o.id, o.created_at, o.total, o.origen, o.destino,
               u.name AS vendedor
        FROM orders o
        LEFT JOIN users u ON u.id = o.recipient_user_id
        WHERE o.tipo = 'Remito'
          AND o.deleted_at IS NULL
          AND o.created_at BETWEEN $1 AND $2
          ${remitosNegocioFilter}
          ${remitosWhFilter}
        ORDER BY o.created_at DESC
      `, remitosParams);

      const remitosConItems = [];
      for (const r of remitosRes.rows) {
        const itemsRes = await client.query(`
          SELECT oi.*, p.name, p.code
          FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = $1
        `, [r.id]);
        remitosConItems.push({ ...r, items: itemsRes.rows });
      }

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

  async getUltimasCompras({ negocioId, from, to } = {}) {
    const params = [negocioId];
    let dateFilter = "";
    if (from) { params.push(`${from} 00:00:00`); dateFilter += ` AND o.created_at >= $${params.length}`; }
    if (to)   { params.push(`${to} 23:59:59`);   dateFilter += ` AND o.created_at <= $${params.length}`; }
    const { rows } = await pool.query(`
      SELECT
        o.created_at          AS fecha,
        p.code                AS codigo,
        p.name                AS descripcion,
        oi.quantity           AS cantidad,
        oi.unit_price         AS precio,
        pr.name               AS proveedor,
        o.id                  AS order_id
      FROM order_items oi
      JOIN orders o      ON o.id  = oi.order_id
      JOIN products p    ON p.id  = oi.product_id
      LEFT JOIN proveedores pr ON pr.id = o.supplier_id
      WHERE o.tipo = 'Reposicion'
        AND o.deleted_at IS NULL
        AND o.negocio_id = $1
        ${dateFilter}
      ORDER BY o.created_at DESC
      LIMIT 500
    `, params);
    return rows;
  }

  async getLastSalePrice(customerId, productId) {
    return this.orderRepo.getLastSalePrice(customerId, productId);
  }
}
