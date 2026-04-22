import ProductRepository from "../repositories/productRepository.js";
import S3Service from "./S3Service.js";
import pool from "../database/db.js";

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

// Construye el array de precios calculados desde costo_usd
function buildComputedPrices(costo_usd, config) {
  if (!costo_usd || !config) return [];
  const cotizacion = Number(config.cotizacion_dolar || 0);
  const costoUsd   = Number(costo_usd);
  const costoArs   = costoUsd * cotizacion;

  return [1, 2, 3, 4, 5].map((n) => {
    const pct    = Number(config[`pct_${n}`] || 0);
    const factor = 1 + pct / 100;
    return {
      price_type: `precio_${n}`,
      price:      costoArs * factor,
      price_usd:  costoUsd * factor,
      pct,
      currency:   "ARS",
    };
  });
}

export default class ProductService {
  repo = new ProductRepository();
  s3   = new S3Service();

  async search(name, negocioId) {
    const [products, config] = await Promise.all([
      this.repo.search(name, negocioId),
      getPriceConfig(negocioId),
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

    for (let n = 1; n <= 5; n++) {
      const val = p[`price_${n}`];
      if (val != null && val !== "") {
        promises.push(this.repo.upsertPrice(productId, `precio_${n}`, val));
      }
    }

    await Promise.all(promises);
  }

  async getCategories(negocioId) {
    return this.repo.getCategories(negocioId);
  }

  async createCategory(name, parentId = null, negocioId) {
    return this.repo.createCategory(name, parentId, negocioId);
  }

  async getPaginated(limit = 30, offset = 0, categoryId = null, sort = "default", negocioId) {
    const [products, config] = await Promise.all([
      this.repo.getPaginated(limit, offset, categoryId, sort, negocioId),
      getPriceConfig(negocioId),
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

  async getById(id, negocioId) {
    const product = await this.repo.getById(id);
    const config  = await getPriceConfig(negocioId);

    const costo_usd  = product.costo_usd ? Number(product.costo_usd) : null;
    const cotizacion = Number(config.cotizacion_dolar || 0);
    const costoArs   = costo_usd != null ? costo_usd * cotizacion : null;

    let prices = product.prices || product.product_prices || [];
    if (costo_usd) {
      prices = buildComputedPrices(costo_usd, config);
    }

    const costoEntry = costo_usd != null
      ? { price_type: "costo", price: costoArs, price_usd: costo_usd, currency: "ARS" }
      : (product.prices || []).find((p) => p.price_type === "costo") || null;

    const allPrices = costoEntry
      ? [costoEntry, ...prices.filter((p) => p.price_type !== "costo")]
      : prices;

    const reservaRes = await pool.query(
      `SELECT stock_reserva FROM products WHERE id = $1`, [id]
    );
    const stock_reserva = Number(reservaRes.rows[0]?.stock_reserva || 0);

    return {
      ...product,
      prices:           allPrices,
      product_prices:   allPrices,
      stock_reserva,
      costo_usd,
      cotizacion_dolar: cotizacion,
      images: await this.addSignedUrlsToImages(product.images),
    };
  }

  async create(p, files, negocioId) {
    const product = await this.repo.create({ ...p, negocio_id: negocioId });
    await this.saveCostAndPrices(product.id, p);

    if (files?.length) {
      const uploads = await Promise.all(files.map((file) => this.s3.upload(file)));
      await Promise.all(uploads.map((key) => this.repo.insertImage(product.id, key)));
    }

    return this.getById(product.id, negocioId);
  }

  async update(id, p, files, negocioId) {
    await this.repo.update(id, p);
    await this.saveCostAndPrices(id, p);

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

    return this.getById(id, negocioId);
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
