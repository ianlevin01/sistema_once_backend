import pool from "../database/db.js";

export default class ProductImageRepository {
  async create(productId, key) {
  await pool.query(
    "INSERT INTO product_images (product_id, url) VALUES ($1,$2)",
    [productId, key]
  );
}

  async getByProduct(productId) {
    const res = await pool.query(
      "SELECT * FROM product_images WHERE product_id=$1",
      [productId]
    );
    return res.rows;
  }

  async deleteByProduct(productId) {
    await pool.query(
      "DELETE FROM product_images WHERE product_id=$1",
      [productId]
    );
  }
}