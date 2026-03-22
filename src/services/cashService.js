import CashRepository from "../repositories/cashRepository.js";

export default class CashService {
  repo = new CashRepository();

  create(mov) {
    return this.repo.create(mov);
  }

  getAll() {
    return this.repo.getAll();
  }

  getById(id) {
    return this.repo.getById(id);
  }
}