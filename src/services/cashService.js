import CashRepository from "../repositories/cashRepository.js";

export default class CashService {
  repo = new CashRepository();

  create(mov, warehouseId, negocioId, userId) {
    return this.repo.create({ ...mov, warehouse_id: warehouseId || null, negocio_id: negocioId, user_id: userId || null });
  }

  getAll({ from, to, warehouseId, negocioId, userId } = {}) {
    return this.repo.getAll({ from, to, warehouseId, negocioId, userId });
  }

  getById(id) {
    return this.repo.getById(id);
  }
}
