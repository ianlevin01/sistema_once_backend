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

export async function sendOrderReceivedEmail({ to, customerName, orderId, items, total, observaciones }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  if (!to) return;
  const shortId = String(orderId).slice(-6).toUpperCase();
  const html = shell(`
    <div style="background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);border:1.5px solid #4ade80;border-radius:12px;padding:22px 24px;margin-bottom:28px;text-align:center;">
      <div style="font-size:40px;margin-bottom:8px;">🎉</div>
      <p style="margin:0;font-size:20px;font-weight:800;color:#15803d;letter-spacing:-.3px;">¡Pedido recibido!</p>
      <p style="margin:8px 0 0;font-size:13px;color:#6b7280;letter-spacing:.04em;">Número de pedido <strong style="color:#374151;">#${shortId}</strong></p>
    </div>

    <p style="font-size:15px;color:#374151;margin:0 0 6px;">Hola <strong>${customerName || 'cliente'}</strong>,</p>
    <p style="font-size:15px;color:#374151;margin:0 0 20px;">Tu pedido fue registrado correctamente. Nuestro equipo lo revisará y te contactará para coordinar la entrega.</p>

    <p style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;margin:0 0 4px;">Resumen del pedido</p>
    ${itemsTable(items)}

    ${total ? `
    <div style="display:flex;justify-content:flex-end;margin:4px 0 24px;">
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:12px 20px;text-align:right;">
        <span style="font-size:13px;color:#6b7280;margin-right:16px;">Total del pedido</span>
        <span style="font-size:18px;font-weight:800;color:#1d4ed8;">$${Number(total).toLocaleString('es-AR')}</span>
      </div>
    </div>` : ''}

    ${observaciones ? `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:24px;">
      <p style="margin:0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#92400e;">Observaciones</p>
      <p style="margin:4px 0 0;font-size:14px;color:#374151;">${observaciones}</p>
    </div>` : ''}

    <div style="background:#eff6ff;border-radius:10px;padding:16px 20px;margin-bottom:8px;">
      <p style="margin:0;font-size:14px;color:#1d4ed8;font-weight:600;">¿Qué sigue?</p>
      <p style="margin:6px 0 0;font-size:13px;color:#374151;">Revisaremos tu pedido y te enviaremos otro correo cuando esté listo o tengamos novedades.</p>
    </div>

    <p style="font-size:13px;color:#9ca3af;margin:20px 0 0;text-align:center;">¡Gracias por confiar en <strong style="color:#1d4ed8;">Oncepuntos</strong>! 🛍️</p>
  `);
  try {
    await getTransporter().sendMail({
      from: getFrom(),
      to,
      subject: `✅ Tu pedido #${shortId} fue recibido — Oncepuntos`,
      html,
    });
  } catch (err) {
    console.error('emailService received:', err.message);
  }
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

export async function sendCampaignEmail({ to, subject, html }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  if (!to?.trim() || !html) return;
  try {
    await getTransporter().sendMail({ from: getFrom(), to, subject, html });
  } catch (err) {
    console.error('emailService campaign:', err.message);
    throw err;
  }
}

export async function sendPasswordResetEmail({ to, customerName, resetLink }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  if (!to) return;
  const html = shell(`
    <div style="background:linear-gradient(135deg,#fef3c7 0%,#fef08a 100%);border:1.5px solid #fbbf24;border-radius:12px;padding:22px 24px;margin-bottom:28px;text-align:center;">
      <div style="font-size:40px;margin-bottom:8px;">🔐</div>
      <p style="margin:0;font-size:20px;font-weight:800;color:#d97706;letter-spacing:-.3px;">Restablecer contraseña</p>
      <p style="margin:8px 0 0;font-size:13px;color:#6b7280;">Recibimos una solicitud para restablecer tu contraseña</p>
    </div>

    <p style="font-size:15px;color:#374151;margin:0 0 6px;">Hola <strong>${customerName || 'cliente'}</strong>,</p>
    <p style="font-size:15px;color:#374151;margin:0 0 20px;">Haz clic en el botón de abajo para restablecer tu contraseña. Este enlace expira en 15 minutos por razones de seguridad.</p>

    <div style="text-align:center;margin:28px 0;">
      <a href="${resetLink}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:.02em;">Restablecer contraseña</a>
    </div>

    <div style="background:#f3f4f6;border-radius:10px;padding:16px 20px;margin-bottom:8px;">
      <p style="margin:0;font-size:12px;color:#6b7280;"><strong style="color:#374151;">¿No solicitaste este cambio?</strong></p>
      <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Ignora este correo si no eres quién solicitó el restablecimiento de contraseña. Tu cuenta estará segura.</p>
    </div>

    <p style="font-size:12px;color:#9ca3af;margin:20px 0 0;text-align:center;font-style:italic;">Por tu seguridad, nunca compartimos contraseñas por correo.</p>
  `);
  try {
    await getTransporter().sendMail({
      from: getFrom(),
      to,
      subject: '🔐 Restablecer tu contraseña — Oncepuntos',
      html,
    });
  } catch (err) {
    console.error('emailService reset:', err.message);
  }
}
