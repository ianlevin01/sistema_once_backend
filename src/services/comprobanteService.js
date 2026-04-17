import pool from "../database/db.js";
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

      // total en ARS: siempre se calcula de los unit_price del frontend (que están en ARS)
      const totalARS = data.items.reduce((acc, i) => acc + i.unit_price * i.quantity, 0);

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
      let warehouseId = null;
      if (esReposicion || esDevolProv) {
        warehouseId = data.warehouse_id || null;
      } else if (data.user_id) {
        const userRes = await client.query(
          `SELECT warehouse_id FROM users WHERE id = $1`, [data.user_id]
        );
        warehouseId = userRes.rows[0]?.warehouse_id || null;
      } else {
        warehouseId = data.warehouse_id || null;
      }

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
      // Los unit_price del frontend siempre vienen en ARS.
      // Si la divisa del comprobante es USD, guardamos el total en USD.
      const cotizRes = await client.query(
        `SELECT cotizacion_dolar FROM price_config ORDER BY updated_at DESC LIMIT 1`
      );
      const cotizacion = Number(cotizRes.rows[0]?.cotizacion_dolar || 1000);
      const total = divisa === "USD"
        ? Math.round((totalARS / cotizacion) * 100) / 100
        : totalARS;

      // ── Crear orden ─────────────────────────────────────────
      const order = await client.query(`
        INSERT INTO orders (
          customer_id, supplier_id, user_id, warehouse_id,
          total, profit, status, tipo, vendedor, price_type, texto_libre,
          es_consumidor_final, consumidor_final_nombre, divisa
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
      ]);
      const orderRow = order.rows[0];

      for (const item of data.items) {
        await this.itemRepo.create(item, orderRow.id, client);
      }

      // ── Pago ────────────────────────────────────────────────
      const esCuentaCorriente = data.payment_method === "Cta Cte";
      await this.paymentRepo.create({
        method: data.payment_method,
        amount: esCuentaCorriente ? 0 : total,
      }, orderRow.id, client);

      // ── CC cliente: presupuesto con Cta Cte → debitar ───────
      // debitarPorComprobante espera el total en ARS (hace la conversión internamente)
      if (esPresupuesto && esCuentaCorriente && data.customer_id && !data.es_consumidor_final) {
        await this.ccRepo.debitarPorComprobante(
          data.customer_id,
          { total: totalARS, orderId: orderRow.id, concepto: `${tipoFinal} — ${orderRow.id.slice(0, 8)}` },
          client
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

      // ── Web order ───────────────────────────────────────────
      if (data.web_order_id) {
        await client.query(
          `UPDATE web_orders SET order_id = $1, updated_at = now() WHERE id = $2`,
          [orderRow.id, data.web_order_id]
        );
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
              vendedor, price_type, texto_libre, es_consumidor_final, divisa
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
          `, [
            data.customer_id, null, removedTotal, 0, "completed",
            tipoFinal === "Presupuesto Web" ? "Nota de Pedido Web" : "Nota de Pedido",
            data.vendedor || null, data.price_type || "precio_1",
            data.texto_libre || null, false, divisa,
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

      // ── Reposición → sumar stock ────────────────────────────
      if (esReposicion && warehouseId) {
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

      // ── Reposición → acreditar CC proveedor ─────────────────
      // acreditarReposicion espera el monto en ARS y hace la conversión internamente
      if (esReposicion && data.supplier_id && totalARS > 0) {
        await this.proveedorRepo.acreditarReposicion(
          data.supplier_id, { monto: totalARS, orderId: orderRow.id }, client
        );
      }

      // ── Devolución → sumar stock al warehouse ───────────────
      // Alguien devuelve mercadería → entra al depósito
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
      // Sin warehouse: devolver al pool general
      if (esDevolucion && !warehouseId) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          await this._returnStock(client, item.product_id, item.quantity, null);
        }
      }

      // ── Devol a proveedor → restar stock + debitar CC prov ──
      // Le devolvemos mercadería al proveedor → sale del depósito
      if (esDevolProv && warehouseId) {
        for (const item of data.items) {
          if (!item.product_id) continue;
          await client.query(
            `UPDATE stock SET quantity = quantity - $1
             WHERE product_id = $2 AND warehouse_id = $3`,
            [item.quantity, item.product_id, warehouseId]
          );
        }
      }
      if (esDevolProv && !warehouseId) {
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

      const tipo         = order.tipo;
      const warehouseId  = order.warehouse_id;
      const esPresupuesto = tipo === "Presupuesto" || tipo === "Presupuesto Web";
      const esNota        = tipo === "Nota de Pedido" || tipo === "Nota de Pedido Web";
      const esReposicion  = tipo === "Reposicion";
      const esDevolucion  = tipo === "Devolucion";
      const esDevolProv   = tipo === "Devol a proveedor";

      const oldItemsRes = await client.query(
        `SELECT oi.*, p.name, p.code FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = $1`, [id]
      );
      const oldItems = oldItemsRes.rows;
      const newItems = data.items || [];

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
          // más items → restar más stock; menos items → devolver stock
          if (delta > 0) await this._deductStock(client, productId, delta, warehouseId);
          else           await this._returnStock(client, productId, -delta, warehouseId);
        } else if (esNota) {
          await client.query(
            `UPDATE products SET stock_reserva = GREATEST(0, stock_reserva + $1) WHERE id = $2`,
            [delta, productId]
          );
        } else if (esReposicion) {
          if (warehouseId) {
            await client.query(
              `INSERT INTO stock (product_id, warehouse_id, quantity) VALUES ($1,$2,$3)
               ON CONFLICT (product_id, warehouse_id)
               DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
              [productId, warehouseId, delta]
            );
          }
        } else if (esDevolucion) {
          // más items devueltos → más stock; menos → menos stock
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
          // más devuelto al proveedor → más stock sale; menos → vuelve
          if (warehouseId) {
            await client.query(
              `UPDATE stock SET quantity = quantity - $1
               WHERE product_id = $2 AND warehouse_id = $3`,
              [delta, productId, warehouseId]
            );
          }
        }
      }

      // ── Recalcular total y ajustar CC ────────────────────────
      const newTotal   = newItems.reduce((acc, i) => acc + i.unit_price * i.quantity, 0);
      const oldTotal   = Number(order.total);
      const totalDelta = newTotal - oldTotal;

      const paymentRes = await client.query(
        `SELECT method FROM payments WHERE order_id = $1 LIMIT 1`, [id]
      );
      const paymentMethod     = paymentRes.rows[0]?.method;
      const esCuentaCorriente = paymentMethod === "Cta Cte";

      if (totalDelta !== 0) {
        const cotizRes = await client.query(
          `SELECT cotizacion_dolar FROM price_config ORDER BY updated_at DESC LIMIT 1`
        );
        const cotizacion = Number(cotizRes.rows[0]?.cotizacion_dolar || 1000);

        // CC cliente (presupuesto o devolución con Cta Cte)
        if ((esPresupuesto || esDevolucion) && esCuentaCorriente && order.customer_id && !order.es_consumidor_final) {
          const cc = await this.ccRepo.getOrCreate(order.customer_id, client);
          const divisaCC      = cc.divisa ?? "ARS";
          const deltaEnCuenta = divisaCC === "USD" ? totalDelta / cotizacion : totalDelta;

          if (deltaEnCuenta !== 0) {
            // Presupuesto: delta positivo = más deuda (debito)
            // Devolución: delta positivo = más crédito (pago), al revés
            let tipoMov, saldoDelta;
            if (esPresupuesto) {
              tipoMov    = deltaEnCuenta > 0 ? "debito" : "pago";
              saldoDelta = deltaEnCuenta > 0 ? Math.abs(deltaEnCuenta) : -Math.abs(deltaEnCuenta);
            } else {
              // devolución: más monto = más crédito al cliente
              tipoMov    = deltaEnCuenta > 0 ? "pago" : "debito";
              saldoDelta = deltaEnCuenta > 0 ? -Math.abs(deltaEnCuenta) : Math.abs(deltaEnCuenta);
            }

            await client.query(
              `INSERT INTO cc_movimientos
                 (cuenta_corriente_id, tipo, concepto, monto, order_id,
                  divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [cc.id, tipoMov, `Ajuste edición — ${id.slice(0,8)}`,
               Math.abs(deltaEnCuenta), id,
               divisaCC, "ARS", Math.abs(totalDelta),
               divisaCC === "USD" ? cotizacion : null]
            );
            await client.query(
              `UPDATE cuentas_corrientes SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
              [saldoDelta, cc.id]
            );
          }
        }

        // CC proveedor (reposición o devol a proveedor)
        if ((esReposicion || esDevolProv) && order.supplier_id) {
          const ccProv        = await this.proveedorRepo.getOrCreateCC(order.supplier_id, client);
          const divisaCC      = ccProv.divisa ?? "ARS";
          const deltaEnCuenta = divisaCC === "USD" ? totalDelta / cotizacion : totalDelta;

          if (deltaEnCuenta !== 0) {
            let saldoDelta;
            if (esReposicion) {
              // reposición acredita al proveedor; más monto = más saldo
              saldoDelta = deltaEnCuenta;
            } else {
              // devol a proveedor reduce deuda; más monto = menos saldo
              saldoDelta = -deltaEnCuenta;
            }

            await client.query(
              `UPDATE cuentas_corrientes_prov SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
              [saldoDelta, ccProv.id]
            );
            await client.query(
              `INSERT INTO cc_movimientos_prov
                 (cuenta_corriente_id, tipo, concepto, monto, order_id,
                  divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [ccProv.id,
               saldoDelta > 0 ? "pago" : "debito",
               `Ajuste edición — ${id.slice(0,8)}`,
               Math.abs(deltaEnCuenta), id,
               divisaCC, "ARS", Math.abs(totalDelta),
               divisaCC === "USD" ? cotizacion : null]
            );
          }
        }
      }

      // ── Reemplazar items ────────────────────────────────────
      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [id]);
      for (const item of newItems) {
        await this.itemRepo.create(item, id, client);
      }

      // ── Actualizar campos del order ─────────────────────────
      const updates = { total: newTotal };
      if (data.vendedor    !== undefined) updates.vendedor    = data.vendedor;
      if (data.texto_libre !== undefined) updates.texto_libre = data.texto_libre;
      if (data.price_type  !== undefined) updates.price_type  = data.price_type;

      const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
      await client.query(
        `UPDATE orders SET ${setClauses.join(", ")} WHERE id = $1`,
        [id, ...Object.values(updates)]
      );

      if (data.payment_method && data.payment_method !== paymentMethod) {
        const newIsCta = data.payment_method === "Cta Cte";
        await client.query(
          `UPDATE payments SET method = $1, amount = $2 WHERE order_id = $3`,
          [data.payment_method, newIsCta ? 0 : newTotal, id]
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
  // ELIMINAR
  // ─────────────────────────────────────────────────────────────
  async delete(id) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const orderRes = await client.query(
        `SELECT * FROM orders WHERE id = $1`, [id]
      );
      const order = orderRes.rows[0];
      if (!order) throw new Error("Comprobante no encontrado");

      const tipo          = order.tipo;
      const warehouseId   = order.warehouse_id;
      const esPresupuesto = tipo === "Presupuesto" || tipo === "Presupuesto Web";
      const esNota        = tipo === "Nota de Pedido" || tipo === "Nota de Pedido Web";
      const esReposicion  = tipo === "Reposicion";
      const esDevolucion  = tipo === "Devolucion";
      const esDevolProv   = tipo === "Devol a proveedor";

      const itemsRes = await client.query(
        `SELECT product_id, quantity FROM order_items WHERE order_id = $1`, [id]
      );
      const items = itemsRes.rows;

      const paymentRes = await client.query(
        `SELECT method FROM payments WHERE order_id = $1 LIMIT 1`, [id]
      );
      const esCuentaCorriente = paymentRes.rows[0]?.method === "Cta Cte";

      const cotizRes = await client.query(
        `SELECT cotizacion_dolar FROM price_config ORDER BY updated_at DESC LIMIT 1`
      );
      const cotizacion = Number(cotizRes.rows[0]?.cotizacion_dolar || 1000);

      // ── Revertir stock ──────────────────────────────────────
      for (const item of items) {
        if (!item.product_id) continue;

        if (esPresupuesto) {
          // Presupuesto restó → devolver
          await this._returnStock(client, item.product_id, item.quantity, warehouseId);
        } else if (esNota) {
          // Nota sumó reserva → restar
          await client.query(
            `UPDATE products SET stock_reserva = GREATEST(0, stock_reserva - $1) WHERE id = $2`,
            [item.quantity, item.product_id]
          );
        } else if (esReposicion && warehouseId) {
          // Reposición sumó → restar
          await client.query(
            `UPDATE stock SET quantity = quantity - $1
             WHERE product_id = $2 AND warehouse_id = $3`,
            [item.quantity, item.product_id, warehouseId]
          );
        } else if (esDevolucion) {
          // Devolución sumó stock → restar
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
          // Devol a proveedor restó stock → devolver
          if (warehouseId) {
            await client.query(
              `INSERT INTO stock (product_id, warehouse_id, quantity) VALUES ($1,$2,$3)
               ON CONFLICT (product_id, warehouse_id)
               DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
              [item.product_id, warehouseId, item.quantity]
            );
          } else {
            await this._returnStock(client, item.product_id, item.quantity, null);
          }
        }
      }

      // order.total está guardado en la divisa del comprobante (ARS o USD).
      // Para operar con CC necesitamos el monto en ARS.
      const totalGuardado = Number(order.total);
      const divisaOrder   = order.divisa || "ARS";
      const totalARS      = divisaOrder === "USD" ? totalGuardado * cotizacion : totalGuardado;

      // ── Revertir CC cliente ─────────────────────────────────
      if (esCuentaCorriente && order.customer_id && !order.es_consumidor_final) {
        if (esPresupuesto || esDevolucion) {
          const cc = await this.ccRepo.getOrCreate(order.customer_id, client);
          if (cc) {
            // Eliminar el movimiento original y revertir su efecto en el saldo.
            // Presupuesto creó un 'debito'; devolución creó un 'pago'.
            const tipoOriginal = esPresupuesto ? "debito" : "pago";
            const movsRes = await client.query(
              `SELECT id, monto FROM cc_movimientos
               WHERE order_id = $1 AND tipo = $2 AND cuenta_corriente_id = $3`,
              [id, tipoOriginal, cc.id]
            );
            for (const mov of movsRes.rows) {
              // Revertir: debito restaba saldo → al eliminar sumar; pago sumaba → restar
              const saldoDelta = esPresupuesto ? -Number(mov.monto) : Number(mov.monto);
              await client.query(
                `UPDATE cuentas_corrientes SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
                [saldoDelta, cc.id]
              );
              await client.query(`DELETE FROM cc_movimientos WHERE id = $1`, [mov.id]);
            }
          }
        }
      }

      // ── Revertir CC proveedor ───────────────────────────────
      if (order.supplier_id && (esReposicion || esDevolProv)) {
        const ccProv        = await this.proveedorRepo.getOrCreateCC(order.supplier_id, client);
        const divisaCC      = ccProv.divisa ?? "ARS";
        const montoEnCuenta = divisaCC === "USD" ? totalARS / cotizacion : totalARS;

        let saldoDelta, tipoMov;
        if (esReposicion) {
          // Reposición acreditó saldo al proveedor → al eliminar reducir saldo
          saldoDelta = -montoEnCuenta;
          tipoMov    = "debito";
        } else {
          // Devol a proveedor debitó saldo → al eliminar devolver saldo
          saldoDelta = montoEnCuenta;
          tipoMov    = "pago";
        }

        await client.query(
          `UPDATE cuentas_corrientes_prov SET saldo = saldo + $1, updated_at = NOW() WHERE id = $2`,
          [saldoDelta, ccProv.id]
        );
        await client.query(
          `INSERT INTO cc_movimientos_prov
             (cuenta_corriente_id, tipo, concepto, monto, order_id,
              divisa_cuenta, divisa_cobro, monto_original, cotizacion_usada)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [ccProv.id, tipoMov, `Anulación — ${id.slice(0,8)}`,
           montoEnCuenta, id, divisaCC, "ARS", totalARS,
           divisaCC === "USD" ? cotizacion : null]
        );
      }

      // ── Borrar ──────────────────────────────────────────────
      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [id]);
      await client.query(`DELETE FROM payments WHERE order_id = $1`, [id]);
      await client.query(`UPDATE web_orders SET order_id = NULL WHERE order_id = $1`, [id]);
      await client.query(`DELETE FROM orders WHERE id = $1`, [id]);

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

  async getListado({ from, to, warehouseId, warehouseName } = {}) {
    const client = await pool.connect();
    try {
      const dateFrom = from ? `${from} 00:00:00` : "1970-01-01";
      const dateTo   = to   ? `${to} 23:59:59`   : "2099-12-31";

      // ── Presupuestos ─────────────────────────────────────────
      // NO convertir el total — devolver en la divisa original del comprobante.
      // El frontend ya muestra el símbolo correcto según p.divisa.
      const presParams = [dateFrom, dateTo];
      const presWhFilter = warehouseId ? ` AND o.warehouse_id = $${presParams.push(warehouseId)}` : "";
      const presRes = await client.query(`
        SELECT
          o.id, o.tipo, o.created_at, o.vendedor, o.texto_libre, o.price_type,
          o.es_consumidor_final, o.consumidor_final_nombre,
          COALESCE(NULLIF(o.divisa, ''), 'ARS') AS divisa,
          o.total,
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
          AND o.created_at BETWEEN $1 AND $2
          ${presWhFilter}
        ORDER BY o.created_at DESC
      `, presParams);

      // ── Reposiciones y Devol a proveedor ─────────────────────
      // Tampoco convertir — devolver total en su divisa.
      const reposParams = [dateFrom, dateTo];
      const reposWhFilter = warehouseId ? ` AND o.warehouse_id = $${reposParams.push(warehouseId)}` : "";
      const reposRes = await client.query(`
        SELECT
          o.id, o.tipo, o.created_at, o.vendedor, o.texto_libre,
          o.supplier_id, o.warehouse_id,
          pr.name AS supplier_name,
          w.name  AS warehouse_name,
          COALESCE(NULLIF(o.divisa, ''), 'ARS') AS divisa,
          o.total
        FROM orders o
        LEFT JOIN proveedores pr ON pr.id = o.supplier_id
        LEFT JOIN warehouses  w  ON w.id  = o.warehouse_id
        WHERE o.tipo IN ('Reposicion', 'Devol a proveedor')
          AND o.created_at BETWEEN $1 AND $2
          ${reposWhFilter}
        ORDER BY o.created_at DESC
      `, reposParams);

      const reposConItems = await Promise.all(
        reposRes.rows.map(async (r) => {
          const itemsRes = await client.query(`
            SELECT oi.*, p.name, p.code
            FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = $1
          `, [r.id]);
          return { ...r, items: itemsRes.rows };
        })
      );

      // ── Notas de Pedido ──────────────────────────────────────
      const notasParams = [dateFrom, dateTo];
      const notasWhFilter = warehouseId ? ` AND o.warehouse_id = $${notasParams.push(warehouseId)}` : "";
      const notasRes = await client.query(`
        SELECT o.id, o.tipo, o.created_at, o.total, o.vendedor, o.texto_libre,
               o.customer_id, o.price_type, c.name AS customer_name,
               pm.method AS payment_method
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN payments pm ON pm.order_id = o.id
        WHERE o.tipo IN ('Nota de Pedido', 'Nota de Pedido Web')
          AND o.created_at BETWEEN $1 AND $2
          ${notasWhFilter}
        ORDER BY o.created_at DESC
      `, notasParams);

      const notasConItems = await Promise.all(
        notasRes.rows.map(async (nota) => {
          const itemsRes = await client.query(`
            SELECT oi.*, p.name, p.code
            FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = $1
          `, [nota.id]);
          return { ...nota, items: itemsRes.rows };
        })
      );

      // ── Remitos ──────────────────────────────────────────────
      const remitosParams = [dateFrom, dateTo];
      const remitosWhFilter = warehouseName
        ? ` AND (o.origen = $${remitosParams.push(warehouseName)} OR o.destino = $${remitosParams.length})`
        : "";
      const remitosRes = await client.query(`
        SELECT o.id, o.created_at, o.total, o.vendedor, o.origen, o.destino
        FROM orders o
        WHERE o.tipo = 'Remito' AND o.created_at BETWEEN $1 AND $2
          ${remitosWhFilter}
        ORDER BY o.created_at DESC
      `, remitosParams);

      const remitosConItems = await Promise.all(
        remitosRes.rows.map(async (r) => {
          const itemsRes = await client.query(`
            SELECT oi.*, p.name, p.code
            FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = $1
          `, [r.id]);
          return { ...r, items: itemsRes.rows };
        })
      );

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

  async getLastSalePrice(customerId, productId) {
    return this.orderRepo.getLastSalePrice(customerId, productId);
  }
}
