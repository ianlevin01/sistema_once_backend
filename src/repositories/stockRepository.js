export default class StockRepository {
  async updateStock(productId, warehouseId, quantity, client) {
    await client.query(
      `UPDATE stock SET quantity = quantity - $1
       WHERE product_id=$2 AND warehouse_id=$3`,
      [quantity, productId, warehouseId]
    );
  }
}