export default class OrderItemRepository {
  async create(item, orderId, client) {
    await client.query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price, cost)
       VALUES ($1,$2,$3,$4,$5)`,
      [orderId, item.product_id, item.quantity, item.unit_price, item.cost ?? null]
    );
  }
}