import ProductRepository from "../repositories/productRepository.js";

export default class ProductService {
  repo = new ProductRepository();

  search(name) {
    return this.repo.search(name);
  }

  getById(id) {
    return this.repo.getById(id);
  }

  create(p) {
    return this.repo.create(p);
  }

  update(id, p) {
    return this.repo.update(id, p);
  }

  delete(id) {
    return this.repo.delete(id);
  }
}