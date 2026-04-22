import CashRepository from "../repositories/cashRepository.js";

export default class CashService {
  repo = new CashRepository();

  create(mov, warehouseId, negocioId) {
    return this.repo.create({ ...mov, warehouse_id: warehouseId || null, negocio_id: negocioId });
  }

  getAll({ from, to, warehouseId, negocioId } = {}) {
    return this.repo.getAll({ from, to, warehouseId, negocioId });
  }

  getById(id) {
    return this.repo.getById(id);
  }
}
