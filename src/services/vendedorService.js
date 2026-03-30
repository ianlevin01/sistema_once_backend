import VendedorRepository from "../repositories/vendedorRepository.js";

export default class VendedorService {
  repo = new VendedorRepository();

  getAll()              { return this.repo.getAll(); }
  getById(id)           { return this.repo.getById(id); }
  create(data)          { return this.repo.create(data); }
  update(id, data)      { return this.repo.update(id, data); }
  delete(id)            { return this.repo.delete(id); }
  getActivos()          { return this.repo.getActivos(); }
}
