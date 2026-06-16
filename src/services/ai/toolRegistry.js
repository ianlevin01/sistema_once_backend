import pool from "../../database/db.js";
import CustomerRepository from "../../repositories/customerRepository.js";
import CuentaCorrienteRepository from "../../repositories/cuentaCorrienteRepository.js";
import CuentaCorrienteService from "../cuentaCorrienteService.js";
import CustomerService from "../customerService.js";
import ProductRepository from "../../repositories/productRepository.js";
import OrderRepository from "../../repositories/orderRepository.js";
import ProveedorRepository from "../../repositories/proveedorRepository.js";

const customerRepo  = new CustomerRepository();
const customerSvc   = new CustomerService();
const ccRepo        = new CuentaCorrienteRepository();
const ccSvc         = new CuentaCorrienteService();
const productRepo   = new ProductRepository();
const orderRepo     = new OrderRepository();
const proveedorRepo = new ProveedorRepository();

// Resuelve un warehouse_id: si ya es UUID lo devuelve, si no busca por nombre
async function resolveWarehouse(warehouseInput, negocioId) {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(warehouseInput);
  if (isUUID) {
    const { rows } = await pool.query(`SELECT id, name FROM warehouses WHERE id = $1`, [warehouseInput]);
    return rows[0] || null;
  }
  const { rows } = await pool.query(
    `SELECT id, name FROM warehouses WHERE name ILIKE $1 AND negocio_id = $2 LIMIT 1`,
    [warehouseInput, negocioId]
  );
  return rows[0] || null;
}

// ctx = { negocioId, warehouseId, userName }

const ALL_TOOLS = [

  // ── READ: Clientes ────────────────────────────────────────────

  {
    name: "buscar_cliente",
    section: "clientes",
    action: "read",
    definition: {
      name: "buscar_cliente",
      description: "Busca clientes por nombre o número de documento. Usar antes de operar sobre la cuenta corriente de un cliente.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre, apellido o número de documento del cliente" },
        },
        required: ["nombre"],
      },
    },
    async execute({ nombre }, { negocioId }) {
      const results = await customerRepo.searchByName(nombre, negocioId);
      if (results.length === 0) return { encontrados: 0, clientes: [] };
      return {
        encontrados: results.length,
        clientes: results.slice(0, 10).map((c) => ({
          id:                     c.id,
          nombre:                 c.name,
          documento:              c.document || null,
          telefono:               c.phone    || null,
          email:                  c.email    || null,
          tiene_cuenta_corriente: !!c.tiene_cc,
        })),
      };
    },
  },

  // ── WRITE: Clientes ───────────────────────────────────────────

  {
    name: "crear_cliente",
    section: "clientes",
    action: "create",
    definition: {
      name: "crear_cliente",
      description: "Crea un nuevo cliente en el sistema. Siempre pedí confirmación antes de llamar con confirmado=true.",
      parameters: {
        type: "object",
        properties: {
          nombre:     { type: "string",  description: "Nombre completo del cliente (obligatorio)" },
          documento:  { type: "string",  description: "CUIT, DNI u otro documento (opcional)" },
          telefono:   { type: "string",  description: "Teléfono de contacto (opcional)" },
          email:      { type: "string",  description: "Email de contacto (opcional)" },
          divisa:     { type: "string",  description: "Divisa de la cuenta: ARS o USD (por defecto ARS)" },
          confirmado: { type: "boolean", description: "Debe ser true para ejecutar. Si es false retorna resumen para confirmar." },
        },
        required: ["nombre", "confirmado"],
      },
    },
    async execute({ nombre, documento, telefono, email, divisa, confirmado }, { negocioId }) {
      if (!confirmado) {
        return {
          requiere_confirmacion: true,
          resumen: `Crear cliente "${nombre}"${documento ? ` · Doc: ${documento}` : ""}${telefono ? ` · Tel: ${telefono}` : ""}${email ? ` · Email: ${email}` : ""} · Divisa: ${divisa || "ARS"}`,
          instruccion: "Confirmá con 'sí' para crear el cliente.",
        };
      }
      const result = await customerSvc.create({ name: nombre, document: documento || null, phone: telefono || null, email: email || null, divisa: divisa || "ARS", negocio_id: negocioId });
      return { ok: true, mensaje: `Cliente "${result.name}" creado correctamente.`, id: result.id };
    },
  },

  // ── READ: Cuenta corriente ────────────────────────────────────

  {
    name: "consultar_cuenta_corriente",
    section: "cuenta_corriente",
    action: "read",
    definition: {
      name: "consultar_cuenta_corriente",
      description: "Consulta el saldo y los movimientos de la cuenta corriente de un cliente. Cada movimiento incluye saldo_acumulado (saldo exacto después de ese movimiento) para responder preguntas históricas sin necesidad de calcular.",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "ID UUID del cliente (obtenelo con buscar_cliente primero)" },
        },
        required: ["customer_id"],
      },
    },
    async execute({ customer_id }) {
      const cuentaRes = await pool.query(
        `SELECT cc.id, cc.saldo, cc.divisa, c.name AS customer_name
         FROM cuentas_corrientes cc
         JOIN customers c ON c.id = cc.customer_id
         WHERE cc.customer_id = $1`,
        [customer_id]
      );
      if (!cuentaRes.rows[0]) return { error: "El cliente no tiene cuenta corriente abierta" };
      const cuenta = cuentaRes.rows[0];

      const movRes = await pool.query(
        `SELECT
           m.tipo,
           m.concepto,
           m.monto,
           m.monto_original,
           m.divisa_cobro,
           m.metodo_pago,
           m.created_at,
           o.tipo AS order_tipo,
           SUM(
             CASE
               WHEN m.tipo = 'debito' AND COALESCE(m.afecta_saldo, true) THEN m.monto
               WHEN m.tipo = 'pago'   AND COALESCE(m.afecta_saldo, true) THEN -m.monto
               ELSE 0
             END
           ) OVER (ORDER BY m.created_at ASC, m.id ASC) AS saldo_acumulado
         FROM cc_movimientos m
         LEFT JOIN orders o ON o.id = m.order_id
         WHERE m.cuenta_corriente_id = $1
         ORDER BY m.created_at DESC
         LIMIT 50`,
        [cuenta.id]
      );

      const movimientos = movRes.rows.map((m) => ({
        fecha:           m.created_at,
        categoria:       m.tipo === "pago" ? "cobranza" : "debito",
        concepto:        m.concepto    || null,
        comprobante:     m.order_tipo  || null,
        monto:           Number(m.monto),
        monto_original:  Number(m.monto_original ?? m.monto),
        divisa_original: m.divisa_cobro,
        metodo_pago:     m.metodo_pago || null,
        saldo_acumulado: Number(m.saldo_acumulado),
      }));

      const cobranzas = movimientos.filter((m) => m.categoria === "cobranza");

      return {
        cliente:          cuenta.customer_name,
        saldo_actual:     Number(cuenta.saldo),
        divisa:           cuenta.divisa,
        total_movimientos: movimientos.length,
        hay_cobranzas:    cobranzas.length > 0,
        ultima_cobranza:  cobranzas.length > 0 ? cobranzas[0] : null,
        movimientos,
      };
    },
  },

  // ── WRITE: Cuenta corriente — abrir ───────────────────────────

  {
    name: "abrir_cuenta_corriente",
    section: "cuenta_corriente",
    action: "create",
    definition: {
      name: "abrir_cuenta_corriente",
      description: "Abre una cuenta corriente para un cliente que aún no tiene una. Pedí confirmación antes de ejecutar.",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string",  description: "ID UUID del cliente" },
          confirmado:  { type: "boolean", description: "Debe ser true para ejecutar." },
        },
        required: ["customer_id", "confirmado"],
      },
    },
    async execute({ customer_id, confirmado }) {
      const clienteRes = await pool.query(`SELECT name FROM customers WHERE id = $1`, [customer_id]);
      const nombreCliente = clienteRes.rows[0]?.name || customer_id;

      const { rows: ccRows } = await pool.query(
        `SELECT id, saldo, divisa FROM cuentas_corrientes WHERE customer_id = $1 LIMIT 1`,
        [customer_id]
      );
      if (ccRows[0]) {
        return { error: `El cliente "${nombreCliente}" ya tiene una cuenta corriente abierta. Saldo: ${ccRows[0].saldo} ${ccRows[0].divisa}.` };
      }

      if (!confirmado) {
        return {
          requiere_confirmacion: true,
          resumen: `Abrir cuenta corriente para "${nombreCliente}"`,
          instruccion: "Presentá este resumen al usuario y preguntá: '¿Confirmás? (sí / no)'",
        };
      }

      const nueva = await ccRepo.createCC(customer_id);
      return { ok: true, mensaje: `Cuenta corriente abierta correctamente para "${nombreCliente}". Saldo inicial: ${nueva.saldo} ${nueva.divisa}.` };
    },
  },

  // ── WRITE: Cuenta corriente — cobranza ───────────────────────

  {
    name: "registrar_cobranza",
    section: "cuenta_corriente",
    action: "create",
    definition: {
      name: "registrar_cobranza",
      description: "Registra un cobro o cargo en la cuenta corriente de un cliente. Para cobros (haber) metodo_pago es obligatorio. Si divisa_cobro difiere de la divisa de la cuenta, cotizacion_manual es obligatorio. Llamá siempre con confirmado=false primero para ver el resumen, luego con confirmado=true tras el 'sí' del usuario.",
      parameters: {
        type: "object",
        properties: {
          customer_id:       { type: "string",  description: "ID UUID del cliente" },
          monto:             { type: "number",  description: "Monto a registrar (positivo)" },
          tipo_mov:          { type: "string",  description: "'haber' = cliente paga, saldo baja | 'debe' = cargo manual, saldo sube" },
          divisa_cobro:      { type: "string",  description: "Divisa del pago: 'ARS' o 'USD'" },
          metodo_pago:       { type: "string",  description: "Método de pago (obligatorio para 'haber'): Efectivo, Transferencia, Cheque, Tarjeta" },
          cotizacion_manual: { type: "number",  description: "Pesos por dólar. Obligatorio cuando divisa_cobro difiere de la divisa de la cuenta corriente." },
          concepto:          { type: "string",  description: "Descripción opcional" },
          confirmado:        { type: "boolean", description: "false = mostrar resumen | true = ejecutar (solo tras confirmación del usuario)" },
        },
        required: ["customer_id", "monto", "tipo_mov", "divisa_cobro", "confirmado"],
      },
    },
    async execute({ customer_id, monto, tipo_mov, divisa_cobro, metodo_pago, cotizacion_manual, concepto, confirmado }, { negocioId, warehouseId }) {
      if (Number(monto) <= 0) return { error: "El monto debe ser mayor a 0." };
      if (tipo_mov !== "haber" && tipo_mov !== "debe") return { error: "tipo_mov debe ser 'haber' o 'debe'." };
      if (tipo_mov === "haber" && !metodo_pago) {
        return { error: "Falta el método de pago. Preguntale al usuario con qué método paga (Efectivo, Transferencia, Cheque, Tarjeta, etc.) y volvé a llamar al tool con ese valor." };
      }

      const [clienteRes, ccRes] = await Promise.all([
        pool.query(`SELECT name FROM customers WHERE id = $1`, [customer_id]),
        pool.query(`SELECT divisa FROM cuentas_corrientes WHERE customer_id = $1 LIMIT 1`, [customer_id]),
      ]);
      const nombreCliente = clienteRes.rows[0]?.name || customer_id;

      if (ccRes.rows.length === 0) {
        return { error: `El cliente "${nombreCliente}" no tiene cuenta corriente. Podés abrirle una con abrir_cuenta_corriente.` };
      }

      const divisaCuenta = ccRes.rows[0].divisa ?? "ARS";

      if (divisa_cobro !== divisaCuenta && !cotizacion_manual) {
        return {
          error: `La cuenta corriente de "${nombreCliente}" está en ${divisaCuenta}, pero el pago es en ${divisa_cobro}. Para hacer la conversión necesito la cotización. Preguntale al usuario: "¿A cuántos ${divisaCuenta} equivale 1 ${divisa_cobro} para esta operación?" y volvé a llamar al tool con ese valor en cotizacion_manual.`,
        };
      }

      if (!confirmado) {
        const divisaInfo = (divisa_cobro !== divisaCuenta && cotizacion_manual)
          ? ` (cotización: ${cotizacion_manual} ARS/USD)`
          : "";
        const accion = tipo_mov === "haber"
          ? `Cobro de ${monto} ${divisa_cobro} a "${nombreCliente}" por ${metodo_pago}${divisaInfo}`
          : `Cargo manual de ${monto} ${divisa_cobro} a "${nombreCliente}"${divisaInfo}`;
        return {
          requiere_confirmacion: true,
          resumen: accion + (concepto ? ` — "${concepto}"` : ""),
          instruccion: "Presentá este resumen al usuario y preguntá: '¿Confirmás? (sí / no)'",
        };
      }

      await ccSvc.registrarCobranza(customer_id, {
        monto:             Number(monto),
        concepto:          concepto || (tipo_mov === "haber" ? "Cobranza" : "Cargo manual"),
        metodo_pago:       metodo_pago || null,
        divisa_cobro:      divisa_cobro,
        cotizacion_manual: cotizacion_manual ? Number(cotizacion_manual) : null,
        negocio_id:        negocioId,
        warehouse_id:      warehouseId || null,
        tipo_mov,
      });

      const ccActualizada = await ccRepo.getByCustomer(customer_id);
      return {
        ok:          true,
        mensaje:     `Movimiento registrado correctamente para "${nombreCliente}".`,
        nuevo_saldo: ccActualizada?.saldo,
        divisa:      ccActualizada?.divisa,
      };
    },
  },

  // ── READ: Productos ───────────────────────────────────────────

  {
    name: "buscar_producto",
    section: "productos",
    action: "read",
    definition: {
      name: "buscar_producto",
      description: "Busca productos por nombre o código. Retorna hasta 10 resultados con costo y stock.",
      parameters: {
        type: "object",
        properties: {
          texto: { type: "string", description: "Nombre o código del producto" },
        },
        required: ["texto"],
      },
    },
    async execute({ texto }, { negocioId }) {
      const [results, whRes] = await Promise.all([
        productRepo.searchByText(texto, negocioId),
        pool.query(`SELECT id, name FROM warehouses WHERE negocio_id = $1`, [negocioId]),
      ]);
      if (results.length === 0) return { encontrados: 0, productos: [] };
      const whMap = {};
      whRes.rows.forEach((w) => { whMap[w.id] = w.name; });
      return {
        encontrados: results.length,
        productos: results.slice(0, 10).map((p) => ({
          id:          p.id,
          nombre:      p.name,
          codigo:      p.code,
          activo:      p.active,
          costo_usd:   p.costo_usd,
          stock_total: (p.stock || []).reduce((sum, s) => sum + (Number(s.quantity) || 0), 0),
          stock_por_deposito: (p.stock || [])
            .filter((s) => Number(s.quantity) > 0)
            .map((s) => ({
              deposito: whMap[s.warehouse_id] || s.warehouse_id,
              cantidad: Number(s.quantity) || 0,
            })),
        })),
      };
    },
  },

  // ── READ: Stock / Depósitos ───────────────────────────────────

  {
    name: "listar_depositos",
    section: "stock",
    action: "read",
    definition: {
      name: "listar_depositos",
      description: "Lista los depósitos (warehouses) disponibles con su id y nombre.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    async execute(_args, { negocioId }) {
      const { rows } = await pool.query(
        `SELECT id, name FROM warehouses WHERE negocio_id = $1 ORDER BY name`,
        [negocioId]
      );
      return { depositos: rows.map((r) => ({ id: r.id, nombre: r.name })) };
    },
  },

  {
    name: "consultar_movimientos_stock",
    section: "stock",
    action: "read",
    definition: {
      name: "consultar_movimientos_stock",
      description: "Consulta el historial de movimientos de stock de un producto (comprobantes, reposiciones, ajustes manuales). Requiere el ID UUID del producto (obtenelo con buscar_producto).",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string", description: "ID UUID del producto" },
          desde:      { type: "string", description: "Fecha inicio YYYY-MM-DD (opcional)" },
          hasta:      { type: "string", description: "Fecha fin YYYY-MM-DD (opcional)" },
        },
        required: ["product_id"],
      },
    },
    async execute({ product_id, desde, hasta }) {
      const prodRes = await pool.query(`SELECT id, name, code FROM products WHERE id = $1`, [product_id]);
      const producto = prodRes.rows[0];
      if (!producto) return { error: "Producto no encontrado" };

      // Stock actual por depósito
      const stockRes = await pool.query(`
        SELECT w.name AS deposito, s.quantity AS stock
        FROM stock s JOIN warehouses w ON w.id = s.warehouse_id
        WHERE s.product_id = $1 ORDER BY w.name
      `, [product_id]);

      // Movimientos: comprobantes + ajustes manuales (últimos 50)
      const params = [product_id];
      let dateFilter = "";
      if (desde && hasta) {
        params.push(`${desde} 00:00:00`, `${hasta} 23:59:59`);
        dateFilter = `AND fecha BETWEEN $${params.length - 1} AND $${params.length}`;
      } else if (desde) {
        params.push(`${desde} 00:00:00`);
        dateFilter = `AND fecha >= $${params.length}`;
      } else if (hasta) {
        params.push(`${hasta} 23:59:59`);
        dateFilter = `AND fecha <= $${params.length}`;
      }

      const { rows: movimientos } = await pool.query(`
        SELECT * FROM (
          SELECT o.created_at AS fecha, o.tipo AS concepto,
                 COALESCE(c.name, pr.name, 'Consumidor Final') AS entidad,
                 COALESCE(w.name, '') AS deposito,
                 NULL::numeric AS entradas,
                 oi.quantity::numeric AS salidas
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          LEFT JOIN customers c ON c.id = o.customer_id
          LEFT JOIN proveedores pr ON pr.id = o.supplier_id
          LEFT JOIN warehouses w ON w.id = o.warehouse_id
          WHERE oi.product_id = $1
            AND o.tipo IN ('Presupuesto', 'Presupuesto Web', 'Nota de Pedido', 'Nota de Pedido Web')
            AND o.deleted_at IS NULL

          UNION ALL

          SELECT o.created_at, o.tipo,
                 COALESCE(c.name, pr.name, ''),
                 COALESCE(w_dest.name, ''),
                 oi.quantity::numeric, NULL::numeric
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          LEFT JOIN customers c ON c.id = o.customer_id
          LEFT JOIN proveedores pr ON pr.id = o.supplier_id
          LEFT JOIN warehouses w_dest ON w_dest.id::text = o.destino
          WHERE oi.product_id = $1
            AND o.tipo IN ('Reposicion', 'Devolucion')
            AND o.deleted_at IS NULL

          UNION ALL

          SELECT smm.created_at,
                 CASE WHEN smm.source = 'excel' THEN 'Excel Import' ELSE 'Ajuste Manual' END,
                 COALESCE(smm.created_by, ''),
                 COALESCE(w.name, ''),
                 CASE WHEN smm.delta > 0 THEN smm.delta ELSE NULL END,
                 CASE WHEN smm.delta < 0 THEN ABS(smm.delta) ELSE NULL END
          FROM stock_manual_movements smm
          LEFT JOIN warehouses w ON w.id = smm.warehouse_id
          WHERE smm.product_id = $1
        ) mov
        WHERE 1=1 ${dateFilter}
        ORDER BY fecha DESC
        LIMIT 50
      `, params);

      return {
        producto:  { nombre: producto.name, codigo: producto.code },
        stock_actual: stockRes.rows,
        movimientos: movimientos.map((m) => ({
          fecha:    m.fecha,
          tipo:     m.concepto,
          entidad:  m.entidad  || null,
          deposito: m.deposito || null,
          entradas: m.entradas ?? null,
          salidas:  m.salidas  ?? null,
        })),
      };
    },
  },

  // ── WRITE: Stock ──────────────────────────────────────────────

  {
    name: "agregar_stock",
    section: "stock",
    action: "create",
    definition: {
      name: "agregar_stock",
      description: "Agrega unidades de stock a un producto en un depósito. El depósito puede indicarse por nombre o por UUID. Pedí confirmación antes de ejecutar.",
      parameters: {
        type: "object",
        properties: {
          product_id:    { type: "string",  description: "ID UUID del producto (obtenelo con buscar_producto)" },
          deposito:      { type: "string",  description: "Nombre o ID UUID del depósito destino" },
          cantidad:      { type: "number",  description: "Cantidad a agregar (número positivo)" },
          confirmado:    { type: "boolean", description: "Debe ser true para ejecutar." },
        },
        required: ["product_id", "deposito", "cantidad", "confirmado"],
      },
    },
    async execute({ product_id, deposito, cantidad, confirmado }, { negocioId, userName }) {
      if (Number(cantidad) <= 0) return { error: "La cantidad debe ser mayor a 0" };

      const [prodRes, wh] = await Promise.all([
        pool.query(`SELECT name, code FROM products WHERE id = $1`, [product_id]),
        resolveWarehouse(deposito, negocioId),
      ]);
      const producto = prodRes.rows[0];
      if (!producto) return { error: "Producto no encontrado" };
      if (!wh)       return { error: `No se encontró el depósito "${deposito}"` };

      if (!confirmado) {
        return {
          requiere_confirmacion: true,
          resumen: `Agregar ${cantidad} unidades de "${producto.name}" (${producto.code}) al depósito "${wh.name}"`,
          instruccion: "Confirmá con 'sí' para actualizar el stock.",
        };
      }

      await pool.query(
        `INSERT INTO stock (product_id, warehouse_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (product_id, warehouse_id)
         DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
        [product_id, wh.id, Number(cantidad)]
      );

      await pool.query(
        `INSERT INTO stock_manual_movements (negocio_id, product_id, warehouse_id, delta, source, created_by)
         VALUES ($1, $2, $3, $4, 'manual', $5)`,
        [negocioId, product_id, wh.id, Number(cantidad), userName || "Asistente IA"]
      ).catch(() => {});

      const { rows } = await pool.query(
        `SELECT quantity FROM stock WHERE product_id = $1 AND warehouse_id = $2`,
        [product_id, wh.id]
      );
      return {
        ok:          true,
        mensaje:     `Stock actualizado: +${cantidad} unidades de "${producto.name}" en "${wh.name}".`,
        stock_nuevo: rows[0]?.quantity,
      };
    },
  },

  // ── READ: Comprobantes ────────────────────────────────────────

  {
    name: "listar_comprobantes",
    section: "comprobantes",
    action: "read",
    definition: {
      name: "listar_comprobantes",
      description: "Lista comprobantes con filtros opcionales. Retorna hasta 30 resultados ordenados por fecha descendente.",
      parameters: {
        type: "object",
        properties: {
          desde:          { type: "string", description: "Fecha inicio YYYY-MM-DD (opcional)" },
          hasta:          { type: "string", description: "Fecha fin YYYY-MM-DD (opcional)" },
          tipo:           { type: "string", description: "Tipo: Presupuesto, Nota de Pedido, Reposicion, Devolucion (opcional)" },
          nombre_cliente: { type: "string", description: "Filtrar por nombre de cliente (opcional)" },
        },
        required: [],
      },
    },
    async execute({ desde, hasta, tipo, nombre_cliente }, { negocioId }) {
      let query = `
        SELECT o.id, o.tipo, o.created_at, o.total, o.divisa, o.status,
               c.name  AS customer_name,
               pr.name AS supplier_name
        FROM orders o
        LEFT JOIN customers   c  ON c.id  = o.customer_id
        LEFT JOIN proveedores pr ON pr.id = o.supplier_id
        WHERE o.negocio_id = $1
      `;
      const params = [negocioId];
      let idx = 2;
      if (desde)          { query += ` AND o.created_at >= $${idx++}::date`;                       params.push(desde); }
      if (hasta)          { query += ` AND o.created_at <  ($${idx++}::date + interval '1 day')`; params.push(hasta); }
      if (tipo)           { query += ` AND o.tipo ILIKE $${idx++}`;                                params.push(tipo); }
      if (nombre_cliente) { query += ` AND c.name ILIKE $${idx++}`;                                params.push(`%${nombre_cliente}%`); }
      query += ` ORDER BY o.created_at DESC LIMIT 30`;

      const { rows } = await pool.query(query, params);
      return {
        total_mostrado: rows.length,
        comprobantes: rows.map((r) => ({
          id:      r.id,
          tipo:    r.tipo,
          fecha:   r.created_at,
          cliente: r.customer_name || r.supplier_name || "Consumidor Final",
          total:   r.total,
          divisa:  r.divisa,
          estado:  r.status,
        })),
      };
    },
  },

  {
    name: "consultar_comprobante",
    section: "comprobantes",
    action: "read",
    definition: {
      name: "consultar_comprobante",
      description: "Obtiene el detalle completo de un comprobante: cliente, items, pagos y total. Los precios de los items y el total se muestran en la divisa del comprobante.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID UUID del comprobante (obtenelo con listar_comprobantes)" },
        },
        required: ["id"],
      },
    },
    async execute({ id }) {
      const order = await orderRepo.getById(id);
      if (!order) return { error: "Comprobante no encontrado" };

      const items = order.items || [];
      const divisa = order.divisa || "ARS";

      // Los unit_price se almacenan en ARS. Si el comprobante es en USD,
      // derivamos la cotización implícita del total y la suma de items.
      const sumARS = items.reduce((s, i) => s + (i.unit_price || 0) * (i.quantity || 0), 0);
      const cotizImplicita = (divisa === "USD" && order.total > 0 && sumARS > 0)
        ? sumARS / order.total
        : null;

      return {
        id:      order.id,
        tipo:    order.tipo,
        fecha:   order.created_at,
        cliente: order.customer_name || order.supplier_name || "Consumidor Final",
        total:   order.total,
        divisa,
        estado:  order.status,
        items: items.map((i) => {
          const precioUnidad = cotizImplicita ? i.unit_price / cotizImplicita : i.unit_price;
          const subtotal     = precioUnidad * i.quantity;
          return {
            producto:        i.product_name,
            codigo:          i.product_code,
            cantidad:        i.quantity,
            precio_unitario: Number(precioUnidad.toFixed(2)),
            subtotal:        Number(subtotal.toFixed(2)),
            divisa,
          };
        }),
        pagos: (order.payments || []).map((p) => ({ metodo: p.method, monto: p.amount })),
      };
    },
  },

  // ── READ: Proveedores ─────────────────────────────────────────

  {
    name: "buscar_proveedor",
    section: "proveedores",
    action: "read",
    definition: {
      name: "buscar_proveedor",
      description: "Busca proveedores por nombre, documento o código. Retorna hasta 10 resultados.",
      parameters: {
        type: "object",
        properties: {
          texto: { type: "string", description: "Nombre, documento o código del proveedor" },
        },
        required: ["texto"],
      },
    },
    async execute({ texto }, { negocioId }) {
      const results = await proveedorRepo.search(texto, negocioId);
      if (results.length === 0) return { encontrados: 0, proveedores: [] };
      return {
        encontrados: results.length,
        proveedores: results.slice(0, 10).map((p) => ({
          id:        p.id,
          nombre:    p.name,
          codigo:    p.codigo,
          documento: p.document,
          email:     p.email,
          telefono:  p.phone,
          divisa:    p.divisa,
        })),
      };
    },
  },

  {
    name: "consultar_cc_proveedor",
    section: "proveedores",
    action: "read",
    definition: {
      name: "consultar_cc_proveedor",
      description: "Consulta la cuenta corriente de un proveedor: saldo y últimos 10 movimientos.",
      parameters: {
        type: "object",
        properties: {
          proveedor_id: { type: "string", description: "ID UUID del proveedor (obtenelo con buscar_proveedor)" },
        },
        required: ["proveedor_id"],
      },
    },
    async execute({ proveedor_id }) {
      const [cc, movs] = await Promise.all([
        proveedorRepo.getCuentaCorriente(proveedor_id),
        proveedorRepo.getMovimientos(proveedor_id),
      ]);
      if (!cc) return { error: "Este proveedor no tiene cuenta corriente registrada." };
      return {
        saldo:  cc.saldo,
        divisa: cc.divisa,
        ultimos_movimientos: movs.slice(0, 10).map((m) => ({
          fecha:    m.created_at,
          tipo:     m.tipo,
          concepto: m.concepto,
          monto:    m.monto,
          metodo:   m.metodo_pago,
        })),
      };
    },
  },

  // ── WRITE: Proveedores ────────────────────────────────────────

  {
    name: "registrar_movimiento_proveedor",
    section: "proveedores",
    action: "create",
    definition: {
      name: "registrar_movimiento_proveedor",
      description: "Registra un movimiento en la cuenta corriente de un proveedor. tipo_mov 'debe' = le pagamos (saldo baja) | 'haber' = cargo nuevo (saldo sube). divisa_cobro es obligatorio. Llamá siempre con confirmado=false primero para mostrar el resumen.",
      parameters: {
        type: "object",
        properties: {
          proveedor_id:      { type: "string",  description: "ID UUID del proveedor" },
          monto:             { type: "number",  description: "Monto (positivo)" },
          tipo_mov:          { type: "string",  description: "'debe' = le pagamos al proveedor (saldo baja) | 'haber' = cargo nuevo (saldo sube)" },
          divisa_cobro:      { type: "string",  description: "Divisa del movimiento: 'ARS' o 'USD'" },
          metodo_pago:       { type: "string",  description: "Método de pago (para 'debe'): Efectivo, Transferencia, Cheque" },
          cotizacion_manual: { type: "number",  description: "ARS por USD. Obligatorio si divisa_cobro difiere de la divisa de la cuenta." },
          concepto:          { type: "string",  description: "Descripción opcional" },
          confirmado:        { type: "boolean", description: "false = mostrar resumen | true = ejecutar (solo tras confirmación del usuario)" },
        },
        required: ["proveedor_id", "monto", "tipo_mov", "divisa_cobro", "confirmado"],
      },
    },
    async execute({ proveedor_id, monto, tipo_mov, divisa_cobro, metodo_pago, cotizacion_manual, concepto, confirmado }, { negocioId }) {
      if (Number(monto) <= 0) return { error: "El monto debe ser mayor a 0." };
      if (tipo_mov !== "debe" && tipo_mov !== "haber") return { error: "tipo_mov debe ser 'debe' o 'haber'." };

      const provRes = await pool.query(`SELECT name FROM proveedores WHERE id = $1`, [proveedor_id]);
      const nombreProv = provRes.rows[0]?.name || proveedor_id;

      const cc = await proveedorRepo.getCuentaCorriente(proveedor_id);
      if (!cc) return { error: `El proveedor "${nombreProv}" no tiene cuenta corriente registrada.` };

      const divisaCuenta = cc.divisa ?? "ARS";
      if (divisa_cobro !== divisaCuenta && !cotizacion_manual) {
        return {
          error: `La cuenta corriente de "${nombreProv}" está en ${divisaCuenta}, pero el movimiento es en ${divisa_cobro}. Preguntale al usuario: "¿A cuántos ${divisaCuenta} equivale 1 ${divisa_cobro}?" y volvé a llamar con ese valor en cotizacion_manual.`,
        };
      }

      if (!confirmado) {
        const divisaInfo = (divisa_cobro !== divisaCuenta && cotizacion_manual)
          ? ` (cotización: ${cotizacion_manual} ARS/USD)` : "";
        const accion = tipo_mov === "debe"
          ? `Pago de ${monto} ${divisa_cobro} a "${nombreProv}"${metodo_pago ? ` por ${metodo_pago}` : ""}${divisaInfo}`
          : `Cargo de ${monto} ${divisa_cobro} a "${nombreProv}" (aumenta deuda)${divisaInfo}`;
        return {
          requiere_confirmacion: true,
          resumen: accion + (concepto ? ` — "${concepto}"` : ""),
          instruccion: "Presentá este resumen al usuario y preguntá: '¿Confirmás? (sí / no)'",
        };
      }

      await proveedorRepo.registrarCobranza(proveedor_id, {
        monto:             Number(monto),
        concepto:          concepto || (tipo_mov === "debe" ? "Pago a proveedor" : "Cargo proveedor"),
        metodo_pago:       metodo_pago || null,
        divisa_cobro,
        cotizacion_manual: cotizacion_manual ? Number(cotizacion_manual) : null,
        negocio_id:        negocioId,
        tipo_mov,
      });

      const ccActualizada = await proveedorRepo.getCuentaCorriente(proveedor_id);
      return {
        ok:          true,
        mensaje:     `Movimiento registrado correctamente para "${nombreProv}".`,
        nuevo_saldo: ccActualizada?.saldo,
        divisa:      ccActualizada?.divisa,
      };
    },
  },
];

export function getToolsForPermissions(permissions) {
  const permMap = {};
  for (const p of permissions) {
    permMap[p.section] = p;
  }
  return ALL_TOOLS.filter((tool) => {
    const perm = permMap[tool.section];
    if (!perm) return false;
    if (tool.action === "read"   && perm.can_read)   return true;
    if (tool.action === "create" && perm.can_create) return true;
    if (tool.action === "edit"   && perm.can_edit)   return true;
    if (tool.action === "delete" && perm.can_delete) return true;
    return false;
  });
}

export { ALL_TOOLS };
