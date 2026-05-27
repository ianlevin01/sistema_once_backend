import ProductRepository from "../repositories/productRepository.js";
import S3Service from "./S3Service.js";
import pool from "../database/db.js";
import { generateEmbedding, productToText } from "./embeddingService.js";
import XLSX from "xlsx";

// ── Caché de config de precios por negocio (60s) ─────────────────────────────
const _configCache = new Map(); // negocio_id → { config, ts }

async function getPriceConfig(negocioId) {
  const now    = Date.now();
  const cached = _configCache.get(negocioId);
  if (cached && now - cached.ts < 60_000) return cached.config;
  const { rows } = await pool.query(
    `SELECT * FROM price_config WHERE negocio_id = $1 LIMIT 1`,
    [negocioId]
  );
  const config = rows[0] || { cotizacion_dolar: 1000, pct_1: 0, pct_2: 0, pct_3: 0, pct_4: 0, pct_5: 0 };
  _configCache.set(negocioId, { config, ts: now });
  return config;
}

export function invalidatePriceConfigCache(negocioId) {
  if (negocioId) _configCache.delete(negocioId);
  else           _configCache.clear();
}

// Construye el array de precios calculados desde costo_usd.
// overrides: objeto con pct_1..pct_5 opcionales (null = usar global)
// config puede incluir round_precio_N (1, 10, 100, 1000) para redondeo hacia arriba.
function buildComputedPrices(costo_usd, config, overrides = null) {
  if (!costo_usd || !config) return [];
  const cotizacion = Number(config.cotizacion_dolar || 0);
  const costoUsd   = Number(costo_usd);
  const costoArs   = costoUsd * cotizacion;

  return [1, 2, 3, 4, 5].map((n) => {
    const ovrPct = overrides?.[`pct_${n}`];
    const pct    = (ovrPct !== null && ovrPct !== undefined)
      ? Number(ovrPct)
      : Number(config[`pct_${n}`] || 0);
    const factor    = 1 + pct / 100;
    let   price     = costoArs * factor;
    const price_usd = costoUsd * factor;

    // Redondeo hacia arriba según configuración por nivel de precio
    const roundUnit = Number(config[`round_precio_${n}`] || 0);
    if (roundUnit > 0) {
      price = Math.ceil(price / roundUnit) * roundUnit;
    }

    return {
      price_type: `precio_${n}`,
      price,
      price_usd,
      pct,
      currency: "ARS",
    };
  });
}

function extractOverrides(product) {
  if (product.ovr_pct_1 == null && product.ovr_pct_2 == null &&
      product.ovr_pct_3 == null && product.ovr_pct_4 == null &&
      product.ovr_pct_5 == null) return null;
  return {
    pct_1: product.ovr_pct_1,
    pct_2: product.ovr_pct_2,
    pct_3: product.ovr_pct_3,
    pct_4: product.ovr_pct_4,
    pct_5: product.ovr_pct_5,
  };
}

export default class ProductService {
  repo = new ProductRepository();
  s3   = new S3Service();

  async _updateEmbedding(product) {
    try {
      const embedding = await generateEmbedding(productToText(product));
      await pool.query(
        "UPDATE products SET embedding = $1 WHERE id = $2",
        [JSON.stringify(embedding), product.id]
      );
    } catch {}
  }

  async search(name, negocioId, useVector = false) {
    const trimmed = name?.trim() ?? "";

    if (!trimmed) {
      const [products, config] = await Promise.all([
        this.repo.searchRecent(negocioId),
        getPriceConfig(negocioId),
      ]);
      return this._processProducts(products, config);
    }

    // Lanzar búsqueda por texto + generación de embedding en paralelo
    const [textResults, config, embedding] = await Promise.all([
      this.repo.searchByText(trimmed, negocioId),
      getPriceConfig(negocioId),
      useVector
        ? generateEmbedding(trimmed.toLowerCase()).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Búsqueda semántica con el embedding ya listo
    let semanticResults = [];
    if (embedding) {
      semanticResults = await this.repo.searchByEmbedding(negocioId, embedding);
    }

    // Combinar: texto primero, luego semánticos que no estén ya en texto
    const textIds = new Set(textResults.map((r) => r.id));
    const combined = [
      ...textResults,
      ...semanticResults.filter((r) => !textIds.has(r.id)),
    ];

    return this._processProducts(combined, config);
  }

  _processProducts(products, config) {
    return Promise.all(
      products.map(async (product) => {
        const costo_usd = product.costo_usd ? Number(product.costo_usd) : null;
        const overrides = extractOverrides(product);
        return {
          ...product,
          prices: buildComputedPrices(costo_usd, config, overrides),
          has_price_override: overrides !== null,
          images: this.addUrlsToImages(product.images),
        };
      })
    );
  }

  addUrlsToImages(images) {
    if (!images?.length) return [];
    return images.map((img) => ({ ...img, url: this.s3.getPublicUrl(img.key) }));
  }

  async saveCostIfChanged(productId, newCosto) {
    if (newCosto == null || newCosto === "") return;
    const current = await this.repo.getById(productId);
    const oldCosto = current?.costo_usd != null ? Number(current.costo_usd) : null;
    if (oldCosto !== null && oldCosto !== Number(newCosto)) {
      await this.repo.insertCost(productId, oldCosto);
    }
  }

  async getCategories(negocioId) {
    return this.repo.getCategories(negocioId);
  }

  async createCategory(name, parentId = null, negocioId) {
    return this.repo.createCategory(name, parentId, negocioId);
  }

  async getPaginated(limit = 30, offset = 0, categoryId = null, sort = "default", negocioId, maxPrice = null) {
    const config     = await getPriceConfig(negocioId);
    const cotizacion = Number(config.cotizacion_dolar || 0);
    const globalPct1 = Number(config.pct_1 || 0);

    const products = await this.repo.getPaginated(
      limit, offset, categoryId, sort, negocioId,
      maxPrice, cotizacion, globalPct1,
    );

    return Promise.all(
      products.map(async (product) => {
        const costo_usd = product.costo_usd ? Number(product.costo_usd) : null;
        const overrides = extractOverrides(product);
        return {
          ...product,
          prices: buildComputedPrices(costo_usd, config, overrides),
          has_price_override: overrides !== null,
          images: this.addUrlsToImages(product.images),
        };
      })
    );
  }

  async getById(id, negocioId) {
    const product = await this.repo.getById(id);
    const config  = await getPriceConfig(negocioId);

    const costo_usd  = product.costo_usd ? Number(product.costo_usd) : null;
    const cotizacion = Number(config.cotizacion_dolar || 0);
    const costoArs   = costo_usd != null ? costo_usd * cotizacion : null;
    const overrides  = extractOverrides(product);

    const prices = buildComputedPrices(costo_usd, config, overrides);

    const costoEntry = costo_usd != null
      ? { price_type: "costo", price: costoArs, price_usd: costo_usd, currency: "ARS" }
      : null;

    const allPrices = costoEntry ? [costoEntry, ...prices] : prices;

    const reservaRes = await pool.query(
      `SELECT stock_reserva FROM products WHERE id = $1`, [id]
    );
    const stock_reserva = Number(reservaRes.rows[0]?.stock_reserva || 0);

    return {
      ...product,
      prices:             allPrices,
      product_prices:     allPrices,
      stock_reserva,
      costo_usd,
      cotizacion_dolar:   cotizacion,
      has_price_override: overrides !== null,
      global_pct_1:       Number(config.pct_1 || 0),
      global_pct_2:       Number(config.pct_2 || 0),
      global_pct_3:       Number(config.pct_3 || 0),
      global_pct_4:       Number(config.pct_4 || 0),
      global_pct_5:       Number(config.pct_5 || 0),
      images: this.addUrlsToImages(product.images),
    };
  }

  async create(p, files, negocioId) {
    if (p.code) {
      const deleted = await this.repo.findDeletedByCode(p.code, negocioId);
      if (deleted) {
        const err = new Error(`El código "${p.code}" corresponde a un producto que fue eliminado anteriormente.`);
        err.code = "DELETED_PRODUCT_CODE";
        throw err;
      }
    }
    const product = await this.repo.create({ ...p, negocio_id: negocioId });

    const { rows: warehouses } = await pool.query(
      `SELECT id FROM warehouses WHERE negocio_id = $1`,
      [negocioId]
    );
    if (warehouses.length) {
      await Promise.all(
        warehouses.map((w) =>
          pool.query(
            `INSERT INTO stock (product_id, warehouse_id, quantity) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
            [product.id, w.id]
          )
        )
      );
    }

    if (files?.length) {
      const uploads = await Promise.all(files.map((file) => this.s3.upload(file)));
      await Promise.all(uploads.map((key) => this.repo.insertImage(product.id, key)));
    }

    const full = await this.getById(product.id, negocioId);
    this._updateEmbedding(full);
    return full;
  }

  async update(id, p, files, negocioId) {
    await this.saveCostIfChanged(id, p.costo_usd);
    await this.repo.update(id, p);

    const keepKeys =
      p.keepImages === undefined
        ? null
        : Array.isArray(p.keepImages)
          ? p.keepImages.filter(Boolean)
          : p.keepImages
            ? [p.keepImages]
            : [];

    const current       = await this.repo.getById(id);
    const currentImages = current.images || [];

    if (keepKeys !== null) {
      const toDelete = currentImages.filter((img) => !keepKeys.includes(img.key));
      await Promise.all(toDelete.map((img) => this.s3.delete(img.key)));
      if (toDelete.length) {
        await Promise.all(toDelete.map((img) => this.repo.deleteImageByKey(img.key)));
      }
    }

    if (files?.length) {
      const uploads = await Promise.all(files.map((file) => this.s3.upload(file)));
      await Promise.all(uploads.map((key) => this.repo.insertImage(id, key)));
    }

    const full = await this.getById(id, negocioId);
    this._updateEmbedding(full);
    return full;
  }

  async delete(id) {
    const product = await this.repo.getById(id);
    if (product?.images?.length) {
      await Promise.all(product.images.map((img) => this.s3.delete(img.key)));
    }
    await this.repo.deleteImagesByProduct(id);
    await this.repo.deleteStockByProduct(id);
    await this.repo.softDelete(id);
  }

  // ── Price overrides ────────────────────────────────────────────
  getOverride(id)         { return this.repo.getOverride(id); }
  setOverride(id, data)   { return this.repo.upsertOverride(id, data); }
  removeOverride(id)      { return this.repo.deleteOverride(id); }

  // ─────────────────────────────────────────────────────────────
  // EXPORTAR A EXCEL
  // ─────────────────────────────────────────────────────────────
  async exportToExcel(negocioId) {
    const [whRes, config] = await Promise.all([
      pool.query(`SELECT id, name FROM warehouses WHERE negocio_id = $1 ORDER BY name`, [negocioId]),
      getPriceConfig(negocioId),
    ]);
    const warehouses     = whRes.rows;
    const warehouseNames = warehouses.map((w) => w.name);

    const { rows: products } = await pool.query(`
      SELECT
        p.code, p.name, p.qxb, p.costo_usd, p.punto_pedido, p.active,
        p.barcode, p.box_code,
        c.name AS category_name,
        ppo.pct_1 AS ovr_pct_1, ppo.pct_2 AS ovr_pct_2, ppo.pct_3 AS ovr_pct_3,
        ppo.pct_4 AS ovr_pct_4, ppo.pct_5 AS ovr_pct_5,
        COALESCE(
          (SELECT json_object_agg(w.name, s.quantity)
           FROM stock s JOIN warehouses w ON w.id = s.warehouse_id
           WHERE s.product_id = p.id),
          '{}'::json
        ) AS stock_by_name
      FROM products p
      LEFT JOIN categories c    ON c.id   = p.category_id
      LEFT JOIN product_price_overrides ppo ON ppo.product_id = p.id
      WHERE p.negocio_id = $1 AND p.deleted_at IS NULL
      ORDER BY p.name ASC
    `, [negocioId]);

    const header = [
      'CODIGO', 'DETALLE', 'QxB', 'Costo',
      'Precio #1', 'Precio #2', 'Precio #3', 'Precio #4', 'Precio #5',
      ...warehouseNames,
      'Rubro', 'Activo', 'Barcode', 'Boxcode',
    ];

    const rows = products.map((p) => {
      const overrides   = extractOverrides(p);
      const prices      = buildComputedPrices(Number(p.costo_usd), config, overrides);
      // Siempre 5 columnas de precio — si costo es null/0 buildComputedPrices devuelve []
      // y el spread vacío desplaza todas las columnas siguientes.
      const priceRow    = [0,1,2,3,4].map((i) => prices[i] != null ? Math.round(prices[i].price * 100) / 100 : '');
      const rawStock    = p.stock_by_name;
      const stockByName = typeof rawStock === 'string'
        ? (() => { try { return JSON.parse(rawStock); } catch { return {}; } })()
        : (rawStock || {});
      return [
        p.code  ?? '',
        p.name  ?? '',
        p.qxb        != null ? Number(p.qxb)        : '',
        p.costo_usd  != null ? Number(p.costo_usd)  : '',
        ...priceRow,
        ...warehouseNames.map((wn) => stockByName[wn] ?? 0),
        p.category_name  ?? '',
        p.active !== false ? 'true' : 'false',
        p.barcode   ?? '',
        p.box_code  ?? '',
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  // ─────────────────────────────────────────────────────────────
  // IMPORTAR DESDE EXCEL
  // ─────────────────────────────────────────────────────────────
  async importFromExcel(buffer, { includeStock = true, apply = false, selectedCodes = [], userName = null }, negocioId) {
    // ── 1. Parsear el Excel ──────────────────────────────────────
    const wb      = XLSX.read(buffer, { type: 'buffer' });
    const ws      = wb.Sheets[wb.SheetNames[0]];
    const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const headerIdx = allRows.findIndex((r) =>
      r.includes('CODIGO') && r.includes('DETALLE')
    );
    if (headerIdx === -1) throw new Error('No se encontró la fila de encabezado (CODIGO / DETALLE)');

    const headers    = allRows[headerIdx];
    const dataRows   = allRows.slice(headerIdx + 1);
    const colIdx = (name) => headers.indexOf(name);

    const idxCodigo     = colIdx('CODIGO');
    const idxDetalle    = colIdx('DETALLE');
    const idxQxB        = colIdx('QxB');
    const idxCosto      = colIdx('Costo');
    const idxPrecio     = [1,2,3,4,5].map((n) => colIdx(`Precio #${n}`));
    const idxRubro      = colIdx('Rubro');
    const idxActivo     = colIdx('Activo');
    const idxBarcode    = colIdx('Barcode');
    const idxBoxcode    = colIdx('Boxcode');

    // Detectar columnas de stock (warehouses que aparezcan en el header)
    const stockColMap = {}; // warehouseName → colIdx
    if (includeStock) {
      const knownSpecial = new Set([
        'CODIGO','DETALLE','QxB','Costo',
        'Precio #1','Precio #2','Precio #3','Precio #4','Precio #5',
        'Rubro','Activo','Pto Pedido','Barcode','Boxcode',
        'Tipo Dolar','Pasivo = 1','Incluir en','Stock FULL',
      ]);
      headers.forEach((h, i) => {
        if (h && !knownSpecial.has(h)) stockColMap[h] = i;
      });
    }

    const parseNum = (v) => {
      if (v === null || v === undefined || v === '') return null;
      const n = parseFloat(String(v).replace(',', '.'));
      return isNaN(n) ? null : n;
    };

    // ── 2. Cargar estado actual de la DB ─────────────────────────
    const [config, categoriesRes, warehousesRes, productsRes] = await Promise.all([
      getPriceConfig(negocioId),
      pool.query(`SELECT id, name FROM categories    WHERE negocio_id = $1`, [negocioId]),
      pool.query(`SELECT id, name FROM warehouses    WHERE negocio_id = $1`, [negocioId]),
      pool.query(`
        SELECT
          p.id, p.code, p.name, p.qxb, p.costo_usd, p.punto_pedido, p.active,
          p.barcode, p.box_code, c.name AS category_name,
          ppo.pct_1 AS ovr_pct_1, ppo.pct_2 AS ovr_pct_2, ppo.pct_3 AS ovr_pct_3,
          ppo.pct_4 AS ovr_pct_4, ppo.pct_5 AS ovr_pct_5,
          COALESCE(
            (SELECT json_object_agg(w.name, s.quantity)
             FROM stock s JOIN warehouses w ON w.id = s.warehouse_id
             WHERE s.product_id = p.id),
            '{}'::json
          ) AS stock_by_name
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN product_price_overrides ppo ON ppo.product_id = p.id
        WHERE p.negocio_id = $1 AND p.deleted_at IS NULL
      `, [negocioId]),
    ]);

    const catMap  = new Map(categoriesRes.rows.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const whMap   = new Map(warehousesRes.rows.map((w) => [w.name, w.id]));
    const prodMap = new Map(productsRes.rows.map((p) => [String(p.code).trim(), p]));

    const cotizacion   = Number(config.cotizacion_dolar || 1);
    const globalPct    = [1,2,3,4,5].map((n) => Number(config[`pct_${n}`] || 0));

    const PCT_TOL = 0.01; // ±0.01% se considera igual al global

    // ── 3. Calcular diff ─────────────────────────────────────────
    const diff = [];
    let unchanged = 0;

    for (const row of dataRows) {
      const code = String(row[idxCodigo] ?? '').trim();
      if (!code) continue;

      const existing = prodMap.get(code);
      const isNew    = !existing;

      const xlsxName       = String(row[idxDetalle] ?? '').trim();
      const xlsxQxB        = parseNum(row[idxQxB]);
      const xlsxCosto      = parseNum(row[idxCosto]);
      const xlsxActive     = idxActivo >= 0 && row[idxActivo] !== '' ? String(row[idxActivo]).toLowerCase() === 'true' : null;
      const xlsxRubro      = String(row[idxRubro] ?? '').trim();
      const xlsxBarcode    = String(row[idxBarcode] ?? '').trim();
      const xlsxBoxcode    = String(row[idxBoxcode] ?? '').trim();
      const xlsxPrices     = idxPrecio.map((ci) => parseNum(row[ci]));

      // Costo efectivo para calcular pct (usar el nuevo si cambió, si no el actual)
      const effectiveCosto = xlsxCosto ?? (existing ? Number(existing.costo_usd) : null);

      if (isNew) {
        // Calcular pct overrides para el nuevo producto
        const priceChanges = [];
        if (effectiveCosto && cotizacion) {
          xlsxPrices.forEach((xlsxP, i) => {
            if (xlsxP == null) return;
            const pctNuevo = (xlsxP / (effectiveCosto * cotizacion) - 1) * 100;
            const pctGlobal = globalPct[i];
            if (Math.abs(pctNuevo - pctGlobal) > PCT_TOL) {
              priceChanges.push({ field: `precio_${i+1}`, from: null, to: xlsxP, pct: Math.round(pctNuevo * 100) / 100 });
            }
          });
        }
        const stockChanges = [];
        if (includeStock) {
          for (const [wName, ci] of Object.entries(stockColMap)) {
            const qty = parseNum(row[ci]) ?? 0;
            if (qty !== 0) stockChanges.push({ field: `stock_${wName}`, from: 0, to: qty });
          }
        }
        diff.push({
          status: 'new', code, name: xlsxName, costo: xlsxCosto,
          changes: [
            ...(xlsxName ? [{ field: 'name', from: null, to: xlsxName }] : []),
            ...(xlsxCosto != null ? [{ field: 'costo_usd', from: null, to: xlsxCosto }] : []),
            ...priceChanges,
            ...stockChanges,
          ],
        });
        continue;
      }

      // ── Producto existente: calcular cambios ─────────────────
      const changes = [];

      // Campos simples
      const strComp = (a, b) => (a || '') === (b || '');
      if (xlsxName && xlsxName !== (existing.name || '').trim())
        changes.push({ field: 'name', from: existing.name, to: xlsxName });
      if (xlsxCosto != null && Math.abs(xlsxCosto - Number(existing.costo_usd || 0)) > 0.0001)
        changes.push({ field: 'costo_usd', from: Number(existing.costo_usd), to: xlsxCosto });
      if (xlsxQxB != null && xlsxQxB !== (existing.qxb != null ? Number(existing.qxb) : null))
        changes.push({ field: 'qxb', from: existing.qxb != null ? Number(existing.qxb) : null, to: xlsxQxB });
      if (xlsxActive != null && xlsxActive !== Boolean(existing.active))
        changes.push({ field: 'active', from: Boolean(existing.active), to: xlsxActive });
      if (idxBarcode >= 0 && !strComp(xlsxBarcode, existing.barcode))
        changes.push({ field: 'barcode', from: existing.barcode, to: xlsxBarcode });
      if (idxBoxcode >= 0 && !strComp(xlsxBoxcode, existing.box_code))
        changes.push({ field: 'box_code', from: existing.box_code, to: xlsxBoxcode });
      if (xlsxRubro && xlsxRubro.toLowerCase() !== (existing.category_name || '').toLowerCase())
        changes.push({ field: 'category', from: existing.category_name, to: xlsxRubro });

      // Precios → pct overrides
      const ovrs = extractOverrides(existing);
      xlsxPrices.forEach((xlsxP, i) => {
        if (xlsxP == null) return;
        const n = i + 1;
        // Precio actual que el sistema calcula
        const currentPct = ovrs?.[`pct_${n}`] != null ? Number(ovrs[`pct_${n}`]) : globalPct[i];
        const currentPrice = effectiveCosto
          ? Math.round((Number(existing.costo_usd) * cotizacion * (1 + currentPct / 100)) * 100) / 100
          : null;
        if (currentPrice != null && Math.abs(xlsxP - currentPrice) < 0.01) return; // sin cambio
        // Calcular nuevo pct
        if (!effectiveCosto || !cotizacion) return;
        const pctNuevo = (xlsxP / (effectiveCosto * cotizacion) - 1) * 100;
        const fromPrice = currentPrice;
        changes.push({
          field: `precio_${n}`,
          from: fromPrice,
          to: xlsxP,
          pct_from: Math.round(currentPct * 100) / 100,
          pct_to:   Math.round(pctNuevo * 100) / 100,
          matches_global: Math.abs(pctNuevo - globalPct[i]) <= PCT_TOL,
        });
      });

      // Stock
      if (includeStock) {
        const rawStock = existing.stock_by_name;
        const stockByName = typeof rawStock === 'string'
          ? (() => { try { return JSON.parse(rawStock); } catch { return {}; } })()
          : (rawStock || {});
        for (const [wName, ci] of Object.entries(stockColMap)) {
          const xlsxQty = parseNum(row[ci]) ?? 0;
          const curQty  = Number(stockByName[wName] ?? 0);
          if (xlsxQty !== curQty) {
            changes.push({ field: `stock_${wName}`, from: curQty, to: xlsxQty });
          }
        }
      }

      if (changes.length === 0) { unchanged++; continue; }

      diff.push({ status: 'modified', code, id: existing.id, name: existing.name, changes });
    }

    const summary = {
      total:       dataRows.filter((r) => r[idxCodigo]).length,
      changed:     diff.filter((d) => d.status === 'modified').length,
      newProducts: diff.filter((d) => d.status === 'new').length,
      unchanged,
    };

    if (!apply) return { summary, diff };

    // ── 4. Aplicar cambios ───────────────────────────────────────
    const selectedSet = new Set(selectedCodes.map(String));
    const toApply     = diff.filter((d) => selectedSet.has(d.code));

    const client = await pool.connect();
    let applied = 0;
    const errors = [];
    try {
      await client.query('BEGIN');

      for (const item of toApply) {
        try {
          const row      = dataRows.find((r) => String(r[idxCodigo]).trim() === item.code);
          if (!row) continue;

          const xlsxName      = String(row[idxDetalle] ?? '').trim();
          const xlsxCosto     = parseNum(row[idxCosto]);
          const xlsxQxB       = parseNum(row[idxQxB]);
          const xlsxRubro     = String(row[idxRubro] ?? '').trim();
          const xlsxBarcode   = String(row[idxBarcode] ?? '').trim();
          const xlsxBoxcode   = String(row[idxBoxcode] ?? '').trim();
          const xlsxActive    = idxActivo >= 0 && row[idxActivo] !== '' ? String(row[idxActivo]).toLowerCase() === 'true' : null;
          const xlsxPrices    = idxPrecio.map((ci) => parseNum(row[ci]));
          const catId         = xlsxRubro ? (catMap.get(xlsxRubro.toLowerCase()) ?? null) : undefined;
          const effectiveCosto = xlsxCosto ?? (item.id ? Number(prodMap.get(item.code)?.costo_usd) : null);

          if (item.status === 'new') {
            // Insertar producto nuevo
            let newCatId = null;
            if (xlsxRubro) {
              newCatId = catMap.get(xlsxRubro.toLowerCase()) ?? null;
              if (!newCatId) {
                const catInsert = await client.query(
                  `INSERT INTO categories (name, negocio_id) VALUES ($1, $2) RETURNING id`,
                  [xlsxRubro, negocioId]
                );
                newCatId = catInsert.rows[0].id;
                catMap.set(xlsxRubro.toLowerCase(), newCatId);
              }
            }
            const ins = await client.query(`
              INSERT INTO products (code, name, qxb, costo_usd, punto_pedido, active, barcode, box_code, category_id, negocio_id)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
              RETURNING id
            `, [
              item.code, xlsxName, xlsxQxB, xlsxCosto,
              null, xlsxActive ?? true,
              xlsxBarcode || null, xlsxBoxcode || null, newCatId, negocioId,
            ]);
            const newId = ins.rows[0].id;

            // Stock
            if (includeStock) {
              for (const [wName, ci] of Object.entries(stockColMap)) {
                const qty = parseNum(row[ci]) ?? 0;
                const whId = whMap.get(wName);
                if (whId) {
                  await client.query(
                    `INSERT INTO stock (product_id, warehouse_id, quantity) VALUES ($1,$2,$3)
                     ON CONFLICT (product_id, warehouse_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
                    [newId, whId, qty]
                  );
                  if (qty !== 0) {
                    await client.query(
                      `INSERT INTO stock_manual_movements (negocio_id, product_id, warehouse_id, delta, source, created_by) VALUES ($1,$2,$3,$4,'excel',$5)`,
                      [negocioId, newId, whId, qty, userName]
                    ).catch(() => {});
                  }
                }
              }
            }

            // Price overrides para el nuevo
            const newOvr = {};
            let hasOvr = false;
            xlsxPrices.forEach((xlsxP, i) => {
              if (xlsxP == null || !effectiveCosto || !cotizacion) return;
              const pctNuevo = (xlsxP / (effectiveCosto * cotizacion) - 1) * 100;
              if (Math.abs(pctNuevo - globalPct[i]) > PCT_TOL) {
                newOvr[`pct_${i+1}`] = Math.round(pctNuevo * 10000) / 10000;
                hasOvr = true;
              }
            });
            if (hasOvr) {
              await client.query(
                `INSERT INTO product_price_overrides (product_id, pct_1, pct_2, pct_3, pct_4, pct_5)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (product_id) DO UPDATE SET
                   pct_1=EXCLUDED.pct_1, pct_2=EXCLUDED.pct_2, pct_3=EXCLUDED.pct_3,
                   pct_4=EXCLUDED.pct_4, pct_5=EXCLUDED.pct_5`,
                [newId, newOvr.pct_1??null, newOvr.pct_2??null, newOvr.pct_3??null, newOvr.pct_4??null, newOvr.pct_5??null]
              );
            }
          } else {
            // Actualizar producto existente
            const existing  = prodMap.get(item.code);
            const productId = existing.id;

            // Resolver category
            let resolvedCatId = existing.category_id ?? null;
            if (xlsxRubro) {
              const catIdFound = catMap.get(xlsxRubro.toLowerCase());
              if (catIdFound) {
                resolvedCatId = catIdFound;
              } else {
                const catInsert = await client.query(
                  `INSERT INTO categories (name, negocio_id) VALUES ($1, $2) RETURNING id`,
                  [xlsxRubro, negocioId]
                );
                resolvedCatId = catInsert.rows[0].id;
                catMap.set(xlsxRubro.toLowerCase(), resolvedCatId);
              }
            }

            // Guardar costo anterior si cambió
            if (xlsxCosto != null && existing.costo_usd != null &&
                Math.abs(Number(existing.costo_usd) - xlsxCosto) > 0.0001) {
              await client.query(
                `INSERT INTO product_costs (product_id, cost) VALUES ($1, $2)`,
                [productId, Number(existing.costo_usd)]
              );
            }

            await client.query(`
              UPDATE products SET
                name        = COALESCE($1, name),
                costo_usd   = COALESCE($2, costo_usd),
                qxb         = COALESCE($3, qxb),
                punto_pedido= COALESCE($4, punto_pedido),
                active      = COALESCE($5, active),
                barcode     = COALESCE(NULLIF($6,''), barcode),
                box_code    = COALESCE(NULLIF($7,''), box_code),
                category_id = COALESCE($8, category_id)
              WHERE id = $9
            `, [
              xlsxName   || null,
              xlsxCosto  ?? null,
              xlsxQxB    ?? null,
              null,
              xlsxActive ?? null,
              xlsxBarcode,
              xlsxBoxcode,
              resolvedCatId,
              productId,
            ]);

            // Stock
            if (includeStock) {
              for (const [wName, ci] of Object.entries(stockColMap)) {
                const qty  = parseNum(row[ci]) ?? 0;
                const whId = whMap.get(wName);
                if (whId) {
                  const oldRes = await client.query(
                    `SELECT quantity FROM stock WHERE product_id = $1 AND warehouse_id = $2`,
                    [productId, whId]
                  );
                  const oldQty = oldRes.rows[0]?.quantity ?? 0;
                  await client.query(
                    `INSERT INTO stock (product_id, warehouse_id, quantity) VALUES ($1,$2,$3)
                     ON CONFLICT (product_id, warehouse_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
                    [productId, whId, qty]
                  );
                  const delta = qty - oldQty;
                  if (delta !== 0) {
                    await client.query(
                      `INSERT INTO stock_manual_movements (negocio_id, product_id, warehouse_id, delta, source, created_by) VALUES ($1,$2,$3,$4,'excel',$5)`,
                      [negocioId, productId, whId, delta, userName]
                    ).catch(() => {});
                  }
                }
              }
            }

            // Price overrides
            const newOvr = {};
            const existingOvrs = extractOverrides(existing) || {};
            let ovrChanged = false;

            xlsxPrices.forEach((xlsxP, i) => {
              if (xlsxP == null || !effectiveCosto || !cotizacion) return;
              const pctNuevo  = (xlsxP / (effectiveCosto * cotizacion) - 1) * 100;
              const pctGlobal = globalPct[i];
              if (Math.abs(pctNuevo - pctGlobal) <= PCT_TOL) {
                newOvr[`pct_${i+1}`] = null; // vuelve al global
              } else {
                newOvr[`pct_${i+1}`] = Math.round(pctNuevo * 10000) / 10000;
              }
              ovrChanged = true;
            });

            if (ovrChanged) {
              const allNull = [1,2,3,4,5].every((n) => {
                const v = newOvr[`pct_${n}`] ?? existingOvrs[`pct_${n}`] ?? null;
                return v == null;
              });
              if (allNull) {
                await client.query(`DELETE FROM product_price_overrides WHERE product_id = $1`, [productId]);
              } else {
                const merged = [1,2,3,4,5].map((n) =>
                  newOvr[`pct_${n}`] !== undefined ? newOvr[`pct_${n}`] : (existingOvrs[`pct_${n}`] ?? null)
                );
                await client.query(
                  `INSERT INTO product_price_overrides (product_id, pct_1, pct_2, pct_3, pct_4, pct_5)
                   VALUES ($1,$2,$3,$4,$5,$6)
                   ON CONFLICT (product_id) DO UPDATE SET
                     pct_1=EXCLUDED.pct_1, pct_2=EXCLUDED.pct_2, pct_3=EXCLUDED.pct_3,
                     pct_4=EXCLUDED.pct_4, pct_5=EXCLUDED.pct_5`,
                  [productId, ...merged]
                );
              }
            }
          }

          applied++;
        } catch (err) {
          errors.push({ code: item.code, error: err.message });
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    invalidatePriceConfigCache(negocioId);
    return { summary, diff, applied, errors };
  }
}
