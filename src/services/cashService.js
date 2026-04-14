import CashRepository from "../repositories/cashRepository.js";

export default class CashService {
  repo = new CashRepository();

  create(mov, warehouseId) {
    return this.repo.create({ ...mov, warehouse_id: warehouseId || null });
  }

  getAll({ from, to, warehouseId } = {}) {
    return this.repo.getAll({ from, to, warehouseId });
  }

  getById(id) {
    return this.repo.getById(id);
  }
}