import CustomerRepository from "../repositories/customerRepository.js";

export default class CustomerService {
  repo = new CustomerRepository();

  searchByName(name) {
    return this.repo.searchByName(name);
  }

  getById(id) {
    return this.repo.getById(id);
  }

  create(c) {
    return this.repo.create(c);
  }

  update(id, c) {
    return this.repo.update(id, c);
  }

  delete(id) {
    return this.repo.delete(id);
  }
}