import VendedorRepository from "../repositories/vendedorRepository.js";

export default class VendedorService {
  repo = new VendedorRepository();

  getAll(negocioId)         { return this.repo.getAll(negocioId); }
  getById(id)               { return this.repo.getById(id); }
  create(data)              { return this.repo.create(data); }
  update(id, data)          { return this.repo.update(id, data); }
  delete(id)                { return this.repo.delete(id); }
  getActivos(negocioId)     { return this.repo.getActivos(negocioId); }
}
