import ProductRepository from "../repositories/productRepository.js";
import S3Service from "./S3Service.js";
import pool from "../database/db.js";

// ── Caché de config de precios (60s) ─────────────────────────────────────────
let _configCache    = null;
let _configCachedAt = 0;

async function getPriceConfig() {
  const now = Date.now();
  if (_configCache && now - _configCachedAt < 60_000) return _configCache;
  const { rows } = await pool.query(
    `SELECT * FROM price_config ORDER BY updated_at DESC LIMIT 1`
  );
  _configCache    = rows[0] || { cotizacion_dolar: 1000, pct_1: 0, pct_2: 0, pct_3: 0, pct_4: 0, pct_5: 0 };
  _configCachedAt = now;
  return _configCache;
}

export function invalidatePriceConfigCache() {
  _configCache = null;
}

// Construye el array de precios calculados desde costo_usd
// Devuelve price en ARS y price_usd en USD
function buildComputedPrices(costo_usd, config) {
  if (!costo_usd || !config) return [];
  const cotizacion = Number(config.cotizacion_dolar || 0);
  const costoUsd   = Number(costo_usd);
  const costoArs   = costoUsd * cotizacion;

  return [1, 2, 3, 4, 5].map((n) => {
    const pct      = Number(config[`pct_${n}`] || 0);
    const factor   = 1 + pct / 100;
    // ARS = costo_ars * factor
    // USD = costo_usd * factor  (NO dividir por cotización — es precio en USD directo)
    return {
      price_type: `precio_${n}`,
      price:      costoArs * factor,   // ARS → lo que muestra la app
      price_usd:  costoUsd * factor,   // USD → informativo
      pct,
      currency:   "ARS",
    };
  });
}

export default class ProductService {
  repo = new ProductRepository();
  s3   = new S3Service();

  async search(name) {
    const [products, config] = await Promise.all([
      this.repo.search(name),
      getPriceConfig(),
    ]);

    return Promise.all(
      products.map(async (product) => {
        const costo_usd = product.costo_usd ? Number(product.costo_usd) : null;

        const prices = costo_usd
          ? buildComputedPrices(costo_usd, config)
          : (product.prices ?? []);

        return {
          ...product,
          prices,
          images: await this.addSignedUrlsToImages(product.images),
        };
      })
    );
  }

  async addSignedUrlsToImages(images) {
    if (!images?.length) return [];
    return Promise.all(
      images.map(async (img) => ({
        ...img,
        url: await this.s3.getSignedUrl(img.key),
      }))
    );
  }

  async saveCostAndPrices(productId, p) {
    const promises = [];

    if (p.cost != null && p.cost !== "") {
      promises.push(this.repo.insertCost(productId, p.cost));
    }

    // Precios manuales — fallback cuando no hay costo_usd
    for (let n = 1; n <= 5; n++) {
      const val = p[`price_${n}`];
      if (val != null && val !== "") {
        promises.push(this.repo.upsertPrice(productId, `precio_${n}`, val));
      }
    }

    await Promise.all(promises);
  }

  async getCategories() {
    return this.repo.getCategories();
  }

  async createCategory(name, parentId = null) {
    return this.repo.createCategory(name, parentId);
  }

  async getPaginated(limit = 30, offset = 0, categoryId = null, sort = "default") {
    const [products, config] = await Promise.all([
      this.repo.getPaginated(limit, offset, categoryId, sort),
      getPriceConfig(),
    ]);

    return Promise.all(
      products.map(async (product) => {
        const costo_usd = product.costo_usd ? Number(product.costo_usd) : null;

        // Si tiene costo_usd, calcular precios 1-5 igual que en getById
        const prices = costo_usd
          ? buildComputedPrices(costo_usd, config)
          : (product.prices ?? []);

        return {
          ...product,
          prices,
          images: await this.addSignedUrlsToImages(product.images),
        };
      })
    );
  }

  async getById(id) {
    const product = await this.repo.getById(id);
    const config  = await getPriceConfig();

    const costo_usd     = product.costo_usd ? Number(product.costo_usd) : null;
    const cotizacion    = Number(config.cotizacion_dolar || 0);
    const costoArs      = costo_usd != null ? costo_usd * cotizacion : null;

    // Precios 1-5: si hay costo_usd los calcula, sino usa los de product_prices
    let prices = product.prices || product.product_prices || [];
    if (costo_usd) {
      prices = buildComputedPrices(costo_usd, config);
    }

    // Construir el precio "costo" para el panel — siempre presente si hay costo_usd
    // Lo agregamos al array como price_type "costo" para que getCost() lo encuentre
    const costoEntry = costo_usd != null
      ? { price_type: "costo", price: costoArs, price_usd: costo_usd, currency: "ARS" }
      : (product.prices || []).find((p) => p.price_type === "costo") || null;

    const allPrices = costoEntry
      ? [costoEntry, ...prices.filter((p) => p.price_type !== "costo")]
      : prices;

    // stock_reserva
    const reservaRes = await pool.query(
      `SELECT stock_reserva FROM products WHERE id = $1`, [id]
    );
    const stock_reserva = Number(reservaRes.rows[0]?.stock_reserva || 0);

    return {
      ...product,
      prices:           allPrices,
      product_prices:   allPrices,   // alias por si el frontend usa product_prices
      stock_reserva,
      costo_usd,
      cotizacion_dolar: cotizacion,
      images: await this.addSignedUrlsToImages(product.images),
    };
  }

  async create(p, files) {
    const product = await this.repo.create(p);
    await this.saveCostAndPrices(product.id, p);

    if (files?.length) {
      const uploads = await Promise.all(files.map((file) => this.s3.upload(file)));
      await Promise.all(uploads.map((key) => this.repo.insertImage(product.id, key)));
    }

    return this.getById(product.id);
  }

  async update(id, p, files) {
    await this.repo.update(id, p);
    await this.saveCostAndPrices(id, p);

    // keepImages puede ser:
    //   undefined  → el cliente no mandó el campo (no tocar imágenes, comportamiento legacy)
    //   string     → una sola key a conservar
    //   string[]   → varias keys a conservar
    //   ""         → se mandó el campo pero vacío → borrar todas
    const keepKeys =
      p.keepImages === undefined
        ? null                                              // no vino el campo → no tocar
        : Array.isArray(p.keepImages)
          ? p.keepImages.filter(Boolean)                   // array → filtrar vacíos
          : p.keepImages
            ? [p.keepImages]                               // string con valor → envolver
            : [];                                          // string vacío → borrar todas

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

    return this.getById(id);
  }

  async delete(id) {
    const product = await this.repo.getById(id);
    if (product.images?.length) {
      await Promise.all(product.images.map((img) => this.s3.delete(img.key)));
    }
    await this.repo.deleteImagesByProduct(id);
    await this.repo.delete(id);
  }
}
