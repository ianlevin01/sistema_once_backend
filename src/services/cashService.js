import CashRepository from "../repositories/cashRepository.js";

export default class CashService {
  repo = new CashRepository();

  create(mov) {
    return this.repo.create(mov);
  }

  getAll({ from, to } = {}) {
    return this.repo.getAll({ from, to });
  }

  getById(id) {
    return this.repo.getById(id);
  }
}