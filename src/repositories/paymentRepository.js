export default class PaymentRepository {
  async create(payment, orderId, client) {
    await client.query(
      `INSERT INTO payments (order_id, method, amount)
       VALUES ($1,$2,$3)`,
      [orderId, payment.method, payment.amount]
    );
  }
}