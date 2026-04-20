import nodemailer from 'nodemailer';

function getTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function getFrom() {
  return `"Oncepuntos" <${process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@oncepuntos.com'}>`;
}

function itemsTable(items) {
  if (!items?.length) return '';
  const rows = items.map(i => `
    <tr>
      <td style="padding:9px 14px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">${i.name}</td>
      <td style="padding:9px 14px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;text-align:center;">${i.quantity}</td>
      <td style="padding:9px 14px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;text-align:right;">$${Number(i.unit_price ?? 0).toLocaleString('es-AR')}</td>
    </tr>`).join('');
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin:20px 0;">
      <tr style="background:#f9fafb;">
        <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;">Producto</th>
        <th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;">Cant.</th>
        <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;">Precio</th>
      </tr>
      ${rows}
    </table>`;
}

function shell(bodyHtml) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Oncepuntos</title></head>
<body style="margin:0;padding:0;background:#f0f4fa;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(13,27,46,.10);">
      <tr><td style="background:linear-gradient(135deg,#1d4ed8 0%,#0ea5e9 100%);padding:30px 40px;text-align:center;">
        <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;letter-spacing:-.5px;">Oncepuntos</h1>
      </td></tr>
      <tr><td style="padding:36px 40px;">${bodyHtml}</td></tr>
      <tr><td style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:18px 40px;text-align:center;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">Este correo fue enviado automáticamente — por favor no respondas.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export async function sendOrderPreparationEmail({ to, customerName, orderId, items, total }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const shortId = String(orderId).slice(-6).toUpperCase();
  const html = shell(`
    <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:18px 20px;margin-bottom:24px;">
      <p style="margin:0;font-size:17px;font-weight:700;color:#15803d;">🔧 Tu pedido está en preparación</p>
      <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Pedido #${shortId}</p>
    </div>
    <p style="font-size:15px;color:#374151;margin:0 0 6px;">Hola <strong>${customerName || 'cliente'}</strong>,</p>
    <p style="font-size:15px;color:#374151;margin:0 0 20px;">Tu pedido fue recibido y ya está siendo preparado. Pronto te contactaremos para coordinar la entrega.</p>
    ${itemsTable(items)}
    ${total ? `<p style="text-align:right;font-size:16px;font-weight:700;color:#1d4ed8;margin:0 0 24px;">Total: $${Number(total).toLocaleString('es-AR')}</p>` : ''}
    <p style="font-size:14px;color:#6b7280;margin:0;">¡Gracias por tu compra en Oncepuntos!</p>
  `);
  try {
    await getTransporter().sendMail({
      from: getFrom(),
      to,
      subject: `🔧 Tu pedido #${shortId} está en preparación — Oncepuntos`,
      html,
    });
  } catch (err) {
    console.error('emailService preparation:', err.message);
  }
}

export async function sendOrderCompletedEmail({ to, customerName, orderId, items, total }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const shortId = String(orderId).slice(-6).toUpperCase();
  const html = shell(`
    <div style="background:#eff6ff;border:1.5px solid #93c5fd;border-radius:10px;padding:18px 20px;margin-bottom:24px;">
      <p style="margin:0;font-size:17px;font-weight:700;color:#1d4ed8;">✅ ¡Tu pedido fue completado!</p>
      <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Pedido #${shortId}</p>
    </div>
    <p style="font-size:15px;color:#374151;margin:0 0 6px;">Hola <strong>${customerName || 'cliente'}</strong>,</p>
    <p style="font-size:15px;color:#374151;margin:0 0 20px;">Tu pedido fue procesado y completado exitosamente. ¡Muchas gracias por elegir Oncepuntos!</p>
    ${itemsTable(items)}
    ${total ? `<p style="text-align:right;font-size:16px;font-weight:700;color:#1d4ed8;margin:0 0 24px;">Total: $${Number(total).toLocaleString('es-AR')}</p>` : ''}
    <p style="font-size:14px;color:#6b7280;margin:0;">Esperamos verte de nuevo pronto.</p>
  `);
  try {
    await getTransporter().sendMail({
      from: getFrom(),
      to,
      subject: `✅ Tu pedido #${shortId} fue completado — Oncepuntos`,
      html,
    });
  } catch (err) {
    console.error('emailService completed:', err.message);
  }
}
