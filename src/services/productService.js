import ProductRepository from "../repositories/productRepository.js";
import S3Service from "./s3Service.js";

export default class ProductService {
  repo = new ProductRepository();
  s3 = new S3Service();

  async search(name) {
    return this.repo.search(name);
  }

  // ── Helper: URLs firmadas ───────────────────────────────────────────────────
  async addSignedUrlsToImages(images) {
    if (!images?.length) return [];

    return Promise.all(
      images.map(async (img) => ({
        ...img,
        url: await this.s3.getSignedUrl(img.key)
      }))
    );
  }

  // ── Helper: guardar costo y precios ────────────────────────────────────────
  async saveCostAndPrices(productId, p) {
    const promises = [];

    // Costo → inserta un nuevo registro en product_costs
    if (p.cost != null && p.cost !== "") {
      promises.push(this.repo.insertCost(productId, p.cost));
    }

    // Precios → upsert por price_type (precio_1 … precio_5)
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

  // ── GET PAGINADO ────────────────────────────────────────────────────────────
  async getPaginated(limit = 30, offset = 0, categoryId = null) {
    const products = await this.repo.getPaginated(limit, offset, categoryId);

    return Promise.all(
      products.map(async (product) => ({
        ...product,
        images: await this.addSignedUrlsToImages(product.images)
      }))
    );
  }

  // ── GET BY ID ───────────────────────────────────────────────────────────────
  async getById(id) {
    const product = await this.repo.getById(id);

    return {
      ...product,
      images: await this.addSignedUrlsToImages(product.images)
    };
  }

  // ── CREATE ──────────────────────────────────────────────────────────────────
  async create(p, files) {
    const product = await this.repo.create(p);

    // Guardar costo y precios
    await this.saveCostAndPrices(product.id, p);

    // Subir imágenes si las hay
    if (files?.length) {
      const uploads = await Promise.all(
        files.map(file => this.s3.upload(file))
      );

      await Promise.all(
        uploads.map(key => this.repo.insertImage(product.id, key))
      );
    }

    return this.getById(product.id);
  }

  // ── UPDATE ──────────────────────────────────────────────────────────────────
  async update(id, p, files) {
    await this.repo.update(id, p);

    // Actualizar costo y precios
    await this.saveCostAndPrices(id, p);

    // keepImages: array de keys S3 que el frontend quiere conservar
    const keepKeys = p.keepImages
      ? (Array.isArray(p.keepImages) ? p.keepImages : [p.keepImages])
      : null;

    const current = await this.repo.getById(id);
    const currentImages = current.images || [];

    if (keepKeys !== null) {
      // Borrar de S3 y de la BD las imágenes que NO están en keepKeys
      const toDelete = currentImages.filter((img) => !keepKeys.includes(img.key));
      await Promise.all(toDelete.map((img) => this.s3.delete(img.key)));
      if (toDelete.length) {
        await Promise.all(toDelete.map((img) => this.repo.deleteImageByKey(img.key)));
      }
    }

    // Subir imágenes nuevas si las hay
    if (files?.length) {
      const uploads = await Promise.all(files.map((file) => this.s3.upload(file)));
      await Promise.all(uploads.map((key) => this.repo.insertImage(id, key)));
    }

    return this.getById(id);
  }

  // ── DELETE ──────────────────────────────────────────────────────────────────
  async delete(id) {
    const product = await this.repo.getById(id);

    if (product.images?.length) {
      await Promise.all(
        product.images.map(img => this.s3.delete(img.key))
      );
    }

    await this.repo.deleteImagesByProduct(id);
    await this.repo.delete(id);
  }
}
