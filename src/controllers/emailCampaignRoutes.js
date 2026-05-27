import { Router } from "express";
import pool from "../database/db.js";
import OpenAI from "openai";
import { requireAuth } from "./authRoutes.js";
import { sendCampaignEmail } from "../services/emailService.js";
import S3Service from "../services/S3Service.js";

const router = Router();
const ONCEPUNTOS_ID = "00000000-0000-0000-0000-000000000001";

const s3 = new S3Service();

const SYSTEM_PROMPT = `Sos un diseñador experto en emails de marketing para Oncepuntos, una plataforma mayorista argentina de juguetes, papelería y regalería.

Tenés herramientas para buscar productos en el catálogo con sus imágenes reales. Siempre buscá los productos antes de incluirlos.

════════════════════════════════════════
REGLAS TÉCNICAS (obligatorias)
════════════════════════════════════════
- Devolvé SIEMPRE el HTML completo dentro de \`\`\`html ... \`\`\`.
- Todo estilo debe ser inline (sin <style> ni CSS externo). Compatible con Gmail y Outlook.
- Ancho máximo 600px centrado con table layout.
- Cada producto tiene un array "images" con URLs públicas permanentes. Usá images[0] como imagen principal, y si el email lo justifica podés mostrar imágenes adicionales (images[1], images[2], etc.).
- Si el array images está vacío, omitir el <img>.
- Después del HTML, un párrafo breve explicando los cambios.
- Devolvé el HTML completo actualizado siempre, aunque el cambio sea pequeño.

════════════════════════════════════════
REFERENCIA DE CALIDAD VISUAL
════════════════════════════════════════
A continuación hay un email de ejemplo que muestra el nivel de calidad visual que se espera. Usalo solo como inspiración de estilo y calidad — NO como plantilla obligatoria.

Si el usuario pide una estructura diferente, un estilo distinto, algo minimalista, con otro layout o cualquier variación, seguí exactamente lo que pide. La creatividad y las instrucciones del usuario tienen prioridad absoluta sobre este ejemplo.

El ejemplo existe solo para que no generes emails planos o básicos cuando el usuario NO especifica un estilo concreto:

\`\`\`html-reference
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Oncepuntos</title></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:32px 16px;">
  <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

    <!-- HEADER -->
    <tr><td style="background:linear-gradient(135deg,#1d4ed8 0%,#0ea5e9 100%);padding:26px 40px;border-radius:18px 18px 0 0;text-align:center;">
      <p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.65);">MAYORISTA</p>
      <h1 style="margin:0;font-size:26px;font-weight:900;color:#fff;letter-spacing:-1px;">Oncepuntos</h1>
    </td></tr>

    <!-- HERO OSCURO -->
    <tr><td style="background:linear-gradient(160deg,#0f172a 0%,#1e3a8a 100%);padding:48px 40px;text-align:center;">
      <span style="display:inline-block;background:#f59e0b;color:#fff;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;padding:4px 14px;border-radius:20px;margin-bottom:20px;">✦ NOVEDAD EXCLUSIVA</span>
      <h2 style="margin:0 0 14px;font-size:36px;font-weight:900;color:#fff;letter-spacing:-1.5px;line-height:1.1;">El producto que<br>todos esperaban</h2>
      <p style="margin:0 auto;font-size:16px;color:rgba(255,255,255,.75);line-height:1.65;max-width:400px;">Llegó al catálogo y ya está causando sensación entre nuestros compradores mayoristas.</p>
    </td></tr>

    <!-- PRODUCTO DESTACADO: imagen + texto lado a lado -->
    <tr><td style="background:#fff;padding:0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="55%" style="padding:36px 20px 36px 40px;vertical-align:middle;">
            <span style="display:inline-block;background:#eff6ff;color:#1d4ed8;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:3px 10px;border-radius:20px;margin-bottom:12px;">Juguetes</span>
            <h3 style="margin:0 0 10px;font-size:22px;font-weight:900;color:#0f172a;letter-spacing:-.5px;line-height:1.2;">NOMBRE DEL PRODUCTO</h3>
            <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.7;">Descripción llamativa del producto. Destacá las ventajas para el comprador mayorista con un tono dinámico.</p>
            <a href="https://oncepuntos.com.ar" style="display:inline-block;background:linear-gradient(135deg,#1d4ed8,#0ea5e9);color:#fff;font-size:13px;font-weight:700;text-decoration:none;padding:11px 24px;border-radius:8px;">Ver producto →</a>
          </td>
          <td width="45%" style="padding:28px 40px 28px 0;vertical-align:middle;text-align:center;background:#f8fafc;">
            <img src="URL_IMAGEN" alt="Producto" width="180" style="width:180px;height:180px;object-fit:contain;display:block;margin:0 auto;border-radius:12px;" />
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- SEPARADOR DECORATIVO -->
    <tr><td style="background:#fff;padding:0 40px;"><div style="height:1px;background:linear-gradient(90deg,transparent,#cbd5e1,transparent);"></div></td></tr>

    <!-- GRILLA DE 2 PRODUCTOS -->
    <tr><td style="background:#fff;padding:32px 40px 36px;">
      <p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#94a3b8;">TAMBIÉN TE PUEDE INTERESAR</p>
      <h3 style="margin:0 0 22px;font-size:18px;font-weight:800;color:#0f172a;">Más novedades del catálogo</h3>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="48%" style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:14px;padding:20px 16px;vertical-align:top;text-align:center;">
            <img src="URL_IMG_1" alt="Prod 1" width="100" style="width:100px;height:100px;object-fit:contain;display:block;margin:0 auto 12px;" />
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#0f172a;">PRODUCTO UNO</p>
            <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;">Categoría</p>
          </td>
          <td width="4%"></td>
          <td width="48%" style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:14px;padding:20px 16px;vertical-align:top;text-align:center;">
            <img src="URL_IMG_2" alt="Prod 2" width="100" style="width:100px;height:100px;object-fit:contain;display:block;margin:0 auto 12px;" />
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#0f172a;">PRODUCTO DOS</p>
            <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;">Categoría</p>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- BANNER CTA -->
    <tr><td style="background:linear-gradient(135deg,#1d4ed8 0%,#0ea5e9 100%);padding:40px;text-align:center;">
      <h3 style="margin:0 0 10px;font-size:22px;font-weight:900;color:#fff;letter-spacing:-.5px;">¿Listo para hacer tu pedido?</h3>
      <p style="margin:0 0 24px;font-size:15px;color:rgba(255,255,255,.8);line-height:1.6;">Visitá el catálogo completo y hacé tu pedido mayorista hoy.</p>
      <a href="https://oncepuntos.com.ar" style="display:inline-block;background:#fff;color:#1d4ed8;font-size:14px;font-weight:800;text-decoration:none;padding:14px 32px;border-radius:10px;letter-spacing:.01em;">Ver catálogo completo →</a>
    </td></tr>

    <!-- FOOTER -->
    <tr><td style="background:#1e293b;padding:22px 40px;border-radius:0 0 18px 18px;text-align:center;">
      <p style="margin:0 0 5px;font-size:13px;font-weight:600;color:#94a3b8;">Oncepuntos — Venta Mayorista</p>
      <p style="margin:0;font-size:11px;color:#475569;">Este correo fue enviado automáticamente — por favor no respondas.</p>
    </td></tr>

  </table>
  </td></tr>
</table>
</body>
</html>
\`\`\`

════════════════════════════════════════
SUGERENCIAS DE DISEÑO (cuando tengas libertad creativa)
════════════════════════════════════════
Cuando el usuario no especifique un estilo, estas sugerencias ayudan a generar emails visualmente ricos:

- Jerarquía tipográfica clara: titulares grandes (32-40px, font-weight:900), subtítulos (18-22px), cuerpo (14px, line-height:1.65)
- Alternancia de fondos entre secciones para crear profundidad visual
- Badges/etiquetas redondeadas para destacar novedades u ofertas
- Cards de producto con fondo #f8fafc y borde sutil
- Botones CTA con gradiente o color sólido llamativo
- Paleta sugerida: #0f172a, #1d4ed8, #0ea5e9, #f59e0b, #f8fafc

Pero si el usuario pide algo específico — minimalista, colorido, con otra estructura, sin algún elemento — hacelo exactamente como pide, con el mismo nivel de cuidado en los detalles.`;


// Definición de tools para OpenAI function calling
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_products_by_name",
      description: "Busca productos por nombre o parte del nombre. Usá esto cuando el usuario mencione un producto específico.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Nombre o parte del nombre del producto a buscar" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_products_by_code",
      description: "Busca productos por código de producto.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Código o parte del código del producto" },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_products_by_category",
      description: "Busca productos de una categoría. Usá esto cuando el usuario pida productos de una categoría o tipo genérico (ej: 'juguetes', 'papelería', 'muñecas').",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "Nombre o parte del nombre de la categoría" },
        },
        required: ["category"],
      },
    },
  },
];

// Helper: formatea filas de productos para el AI
function formatProductRows(rows) {
  if (!rows.length) return JSON.stringify({ message: "No se encontraron productos con ese criterio." });
  return JSON.stringify(
    rows.map((p) => ({
      name:       p.name,
      code:       p.code || "",
      category:   p.category_name || "",
      images:     (p.image_keys || []).map((key) => s3.getPublicUrl(key)),
    }))
  );
}

// Helper: query base de productos con todas sus imágenes
const PRODUCT_SELECT = `
  SELECT p.name, p.code, c.name AS category_name,
    COALESCE(
      (SELECT json_agg(pi.key ORDER BY pi.created_at)
       FROM product_images pi WHERE pi.product_id = p.id),
      '[]'
    ) AS image_keys
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE p.negocio_id = $1 AND p.deleted_at IS NULL AND p.active = true
`;

// Ejecuta el tool que el AI solicitó y devuelve el resultado como string JSON
async function executeTool(name, args) {
  try {
    if (name === "search_products_by_name") {
      const { rows } = await pool.query(
        PRODUCT_SELECT + " AND p.name ILIKE $2 ORDER BY p.name ASC LIMIT 5",
        [ONCEPUNTOS_ID, `%${args.query}%`]
      );
      return formatProductRows(rows);
    }

    if (name === "search_products_by_code") {
      const { rows } = await pool.query(
        PRODUCT_SELECT + " AND p.code ILIKE $2 ORDER BY p.name ASC LIMIT 5",
        [ONCEPUNTOS_ID, `%${args.code}%`]
      );
      return formatProductRows(rows);
    }

    if (name === "search_products_by_category") {
      const { rows } = await pool.query(
        PRODUCT_SELECT + " AND c.name ILIKE $2 ORDER BY p.name ASC LIMIT 8",
        [ONCEPUNTOS_ID, `%${args.category}%`]
      );
      return formatProductRows(rows);
    }

    return JSON.stringify({ error: "Herramienta desconocida" });
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}

// ── GET /api/email-campaign/recipients ────────────────────────────────────────
router.get("/recipients", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.shop_users
       WHERE negocio_id = $1 AND email IS NOT NULL`,
      [req.user.negocio_id]
    );
    return res.json({ total: rows[0].total });
  } catch (err) {
    console.error("email-campaign recipients error:", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

// ── POST /api/email-campaign/ai-chat ─────────────────────────────────────────
router.post("/ai-chat", requireAuth, async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ message: "Se requieren mensajes" });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    // Historial acumulado para el loop de function calling
    const apiMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages,
    ];

    let rawReply = "";

    // Loop agentico: el AI puede llamar tools múltiples veces antes de responder
    for (let i = 0; i < 6; i++) {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: apiMessages,
        tools: TOOLS,
        temperature: 0.7,
      });

      const choice = response.choices[0];

      if (choice.finish_reason === "tool_calls") {
        // Agregar el mensaje del asistente con los tool_calls
        apiMessages.push(choice.message);

        // Ejecutar cada tool call y agregar los resultados
        for (const tc of choice.message.tool_calls) {
          const args = JSON.parse(tc.function.arguments);
          const result = await executeTool(tc.function.name, args);
          apiMessages.push({
            role:         "tool",
            tool_call_id: tc.id,
            content:      result,
          });
        }
        // Continuar el loop para que el AI procese los resultados
        continue;
      }

      // Respuesta final (finish_reason === "stop")
      rawReply = choice.message.content ?? "";
      break;
    }

    // Extraer bloque HTML (```html ... ```)
    const htmlMatch = rawReply.match(/```html\s*([\s\S]*?)```/i);
    const html = htmlMatch ? htmlMatch[1].trim() : null;

    // Texto limpio para mostrar en el chat (sin el bloque HTML)
    const reply = rawReply.replace(/```html[\s\S]*?```/gi, "").trim() || "✓ HTML generado";

    return res.json({ reply, html });
  } catch (err) {
    console.error("email-campaign AI error:", err.message);
    return res.status(500).json({ message: "Error al contactar OpenAI" });
  }
});

// ── POST /api/email-campaign/send ─────────────────────────────────────────────
router.post("/send", requireAuth, async (req, res) => {
  const { subject, html, test_email } = req.body;
  if (!subject?.trim()) return res.status(400).json({ message: "Se requiere un asunto" });
  if (!html?.trim())    return res.status(400).json({ message: "Se requiere contenido HTML" });

  // Modo prueba
  if (test_email) {
    const dest = String(test_email).trim();
    if (!dest) return res.status(400).json({ message: "Email de prueba inválido" });
    try {
      await sendCampaignEmail({ to: dest, subject: `[PRUEBA] ${subject}`, html });
      return res.json({ sent: 1, errors: 0, total: 1, mode: "test" });
    } catch (err) {
      console.error("test send error:", err.message);
      return res.status(500).json({ message: `Error al enviar email de prueba: ${err.message}` });
    }
  }

  // Envío masivo
  try {
    const { rows } = await pool.query(
      `SELECT email FROM public.shop_users
       WHERE negocio_id = $1 AND email IS NOT NULL AND trim(email) != ''`,
      [req.user.negocio_id]
    );

    let sent = 0, errors = 0;
    for (const { email } of rows) {
      try {
        await sendCampaignEmail({ to: email, subject, html });
        sent++;
      } catch {
        errors++;
      }
    }

    return res.json({ sent, errors, total: rows.length });
  } catch (err) {
    console.error("email-campaign send error:", err.message);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
