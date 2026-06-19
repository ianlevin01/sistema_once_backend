import pool from "../database/db.js"

export default class CustomerRepository {
  async searchByName(name, negocioId, conCC = false) {
    const query = conCC
      ? `SELECT c.*, TRUE AS tiene_cc
         FROM customers c
         INNER JOIN cuentas_corrientes cc ON cc.customer_id = c.id
         WHERE (c.name ILIKE $1 OR c.document ILIKE $1) AND c.negocio_id = $2
         ORDER BY c.name LIMIT 30`
      : `SELECT c.*, EXISTS(SELECT 1 FROM cuentas_corrientes cc WHERE cc.customer_id = c.id) AS tiene_cc
         FROM customers c
         WHERE (c.name ILIKE $1 OR c.document ILIKE $1) AND c.negocio_id = $2
         ORDER BY c.name LIMIT 30`;
    const res = await pool.query(query, [`%${name}%`, negocioId]);
    return res.rows;
  }

  async getAll(negocioId) {
    const res = await pool.query(`
      SELECT c.*,
        EXISTS(SELECT 1 FROM cuentas_corrientes cc WHERE cc.customer_id = c.id) AS tiene_cc
      FROM customers c
      WHERE c.type IS DISTINCT FROM 'web' AND c.negocio_id = $1
      ORDER BY c.name ASC
    `, [negocioId]);
    return res.rows;
  }

  async getById(id) {
    const res = await pool.query(
      "SELECT * FROM customers WHERE id = $1",
      [id]
    );
    return res.rows[0];
  }

  async create(customer) {
    const res = await pool.query(
      `INSERT INTO customers
         (name, type, document, phone, email,
          domicilio, localidad, provincia, codigo_postal, transporte, divisa, vendedor, negocio_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        customer.name,
        customer.type          || null,
        customer.document      || null,
        customer.phone         || null,
        customer.email         || null,
        customer.domicilio     || null,
        customer.localidad     || null,
        customer.provincia     || null,
        customer.codigo_postal || null,
        customer.transporte    || "DON ALFREDO",
        customer.divisa        || "ARS",
        customer.vendedor      || null,
        customer.negocio_id,
      ]
    );
    return res.rows[0];
  }

  async update(id, customer) {
    const res = await pool.query(
      `UPDATE customers
       SET name=$1, document=$2, phone=$3, email=$4,
           domicilio=$5, localidad=$6, provincia=$7,
           codigo_postal=$8, transporte=$9, divisa=$10, vendedor=$11
       WHERE id=$12
       RETURNING *`,
      [
        customer.name,
        customer.document      || null,
        customer.phone         || null,
        customer.email         || null,
        customer.domicilio     || null,
        customer.localidad     || null,
        customer.provincia     || null,
        customer.codigo_postal || null,
        customer.transporte    || null,
        customer.divisa        || "ARS",
        customer.vendedor      || null,
        id,
      ]
    );
    return res.rows[0];
  }

  async delete(id) {
    await pool.query("DELETE FROM customers WHERE id=$1", [id]);
  }
}
