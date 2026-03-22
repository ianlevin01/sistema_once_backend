import pool from "../database/db.js"

export default class CustomerRepository {
  async searchByName(name) {
    const res = await pool.query(
      "SELECT * FROM customers WHERE name ILIKE $1",
      [`%${name}%`]
    );
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
      `INSERT INTO customers (name, type, document, phone, email)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [customer.name, customer.type, customer.document, customer.phone, customer.email]
    );
    return res.rows[0];
  }

  async update(id, customer) {
    const res = await pool.query(
      `UPDATE customers SET name=$1, phone=$2, email=$3 WHERE id=$4 RETURNING *`,
      [customer.name, customer.phone, customer.email, id]
    );
    return res.rows[0];
  }

  async delete(id) {
    await pool.query("DELETE FROM customers WHERE id=$1", [id]);
  }
}