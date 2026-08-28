import ProductVariantsRepository from "../repositories/productVariantsRepository.js";

const repo = new ProductVariantsRepository();

export default class ProductVariantsService {
  async getByProduct(productId) {
    return repo.getByProduct(productId);
  }

  async addColor(productId, { nombre, hex }) {
    if (!nombre?.trim()) throw new Error("El nombre del color es obligatorio");
    return repo.create(productId, "color", { nombre: nombre.trim(), hex: hex?.trim() || null });
  }

  async addTamanio(productId, { alto, ancho, profundidad }) {
    const a = alto != null && alto !== "" ? Number(alto) : null;
    const an = ancho != null && ancho !== "" ? Number(ancho) : null;
    const p = profundidad != null && profundidad !== "" ? Number(profundidad) : null;
    if (a === null && an === null && p === null) {
      throw new Error("Al menos uno de los campos de tamaño es obligatorio");
    }
    return repo.create(productId, "tamaño", { alto: a, ancho: an, profundidad: p });
  }

  async delete(id, productId) {
    const deleted = await repo.delete(id, productId);
    if (!deleted) throw new Error("Variante no encontrada");
  }
}
