import ProductRepository from "../repositories/productRepository.js";
import S3Service from "./s3Service.js";

export default class ProductService {
  repo = new ProductRepository();
  s3 = new S3Service();

  async search(name) {
    return this.repo.search(name);
  }
  // 🔥 helper centralizado
  async addSignedUrlsToImages(images) {
    if (!images?.length) return [];

    return Promise.all(
      images.map(async (img) => ({
        ...img,
        url: await this.s3.getSignedUrl(img.key)
      }))
    );
  }

  // 🔥 PAGINADO (optimizado)
  async getPaginated(limit = 30, offset = 0) {
    const products = await this.repo.getPaginated(limit, offset);

    return Promise.all(
      products.map(async (product) => ({
        ...product,
        images: await this.addSignedUrlsToImages(product.images)
      }))
    );
  }

  // 🔥 GET BY ID
  async getById(id) {
    const product = await this.repo.getById(id);

    return {
      ...product,
      images: await this.addSignedUrlsToImages(product.images)
    };
  }

  // 🔥 CREATE
async create(p, files) {
  const product = await this.repo.create(p);
  if (files?.length) {
    const uploads = await Promise.all(
      files.map(file => this.s3.upload(file))
    );

    await Promise.all(
      uploads.map(key =>
        this.repo.insertImage(product.id, key)
      )
    );
  }

  return this.getById(product.id);
}

  // 🔥 UPDATE
  async update(id, p, files) {
    const product = await this.repo.update(id, p);

    if (files?.length) {
      // traer imágenes actuales
      const current = await this.repo.getById(id);

      // borrar de S3
      await Promise.all(
        current.images.map(img =>
          this.s3.delete(img.key)
        )
      );

      // borrar de DB
      await this.repo.deleteImagesByProduct(id);

      // subir nuevas
      const uploads = await Promise.all(
        files.map(file => this.s3.upload(file))
      );

      await Promise.all(
        uploads.map(key =>
          this.repo.insertImage(id, key)
        )
      );
    }

    return this.getById(id); // 👈 siempre devolver completo
  }

  // 🔥 DELETE (opcional pero recomendable)
  async delete(id) {
    const product = await this.repo.getById(id);

    if (product.images?.length) {
      await Promise.all(
        product.images.map(img =>
          this.s3.delete(img.key)
        )
      );
    }

    await this.repo.deleteImagesByProduct(id);
    await this.repo.delete(id);
  }
}