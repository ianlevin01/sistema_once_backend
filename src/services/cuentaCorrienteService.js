import CuentaCorrienteRepository from "../repositories/cuentaCorrienteRepository.js";

export default class CuentaCorrienteService {
  repo = new CuentaCorrienteRepository();

  getAll()                          { return this.repo.getAll(); }
  getByCustomer(id)                 { return this.repo.getByCustomer(id); }
  getOrCreate(id)                   { return this.repo.getOrCreate(id); }
  registrarPago(id, data)           { return this.repo.registrarPago(id, data); }
  agregarSaldo(id, data)            { return this.repo.agregarSaldo(id, data); }
  registrarCobranza(id, data)       { return this.repo.registrarCobranza(id, data); }
  getCobranzas(from, to)            { return this.repo.getCobranzas(from, to); }
  debitarPorComprobante(id, data, client) {
    return this.repo.debitarPorComprobante(id, data, client);
  }
}
