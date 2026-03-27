import CuentaCorrienteRepository from "../repositories/cuentaCorrienteRepository.js";

export default class CuentaCorrienteService {
  repo = new CuentaCorrienteRepository();

  getAll()                          { return this.repo.getAll(); }
  getByCustomer(customerId)         { return this.repo.getByCustomer(customerId); }
  getOrCreate(customerId)           { return this.repo.getOrCreate(customerId); }
  registrarPago(customerId, data)   { return this.repo.registrarPago(customerId, data); }
  agregarSaldo(customerId, data)    { return this.repo.agregarSaldo(customerId, data); }
}
