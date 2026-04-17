import pool from "../database/db.js"

export default class CustomerRepository {
  async searchByName(name, conCC = false) {
    const query = conCC
      ? `SELECT c.*, TRUE AS tiene_cc
         FROM customers c
         INNER JOIN cuentas_corrientes cc ON cc.customer_id = c.id
         WHERE c.name ILIKE $1 OR c.document ILIKE $1
         ORDER BY c.name LIMIT 30`
      : `SELECT c.*, EXISTS(SELECT 1 FROM cuentas_corrientes cc WHERE cc.customer_id = c.id) AS tiene_cc
         FROM customers c
         WHERE c.name ILIKE $1 OR c.document ILIKE $1
         ORDER BY c.name LIMIT 30`;
    const res = await pool.query(query, [`%${name}%`]);
    return res.rows;
  }

  async getAll() {
    const res = await pool.query(`
      SELECT c.*,
        EXISTS(SELECT 1 FROM cuentas_corrientes cc WHERE cc.customer_id = c.id) AS tiene_cc
      FROM customers c
      WHERE c.type IS DISTINCT FROM 'web'
      ORDER BY c.name ASC
    `);
    return res.rows;
  }

  async getById(id) {
    const res = await pool.query(
      "SELECT * FROM customers WHERE id = $1",
      [id]
    );
    return res.rows[0];
  }

  // customerRepository.js

async create(customer) {
  const res = await pool.query(
    `INSERT INTO customers 
       (name, type, document, phone, email,
        domicilio, codigo_postal, transporte, divisa)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      customer.name,
      customer.type    || null,
      customer.document || null,
      customer.phone   || null,
      customer.email   || null,
      customer.domicilio     || null,
      customer.codigo_postal || null,
      customer.transporte    || "DON ALFREDO",
      customer.divisa        || "ARS",
    ]
  );
  return res.rows[0];
}

async update(id, customer) {
  const res = await pool.query(
    `UPDATE customers
     SET name=$1, phone=$2, email=$3,
         domicilio=$4, codigo_postal=$5,
         transporte=$6, divisa=$7
     WHERE id=$8
     RETURNING *`,
    [
      customer.name,
      customer.phone   || null,
      customer.email   || null,
      customer.domicilio     || null,
      customer.codigo_postal || null,
      customer.transporte    || null,
      customer.divisa        || "ARS",
      id,
    ]
  );
  return res.rows[0];
}

  async delete(id) {
    await pool.query("DELETE FROM customers WHERE id=$1", [id]);
  }
}