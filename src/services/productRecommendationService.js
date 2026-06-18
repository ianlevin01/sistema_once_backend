import OpenAI from "openai";
import pool from "../database/db.js";
import { sendProductRecommendationEmail } from "./emailService.js";

const SIMILARITY_THRESHOLD = 0.60;
const MAX_PRODUCTS_PER_EMAIL = 4;
const NEW_PRODUCT_DAYS = 7;
const BATCH_SIZE = 50;
const RECENT_ORDERS_LIMIT = 3; // Cuántos pedidos web recientes usar para comparar similitud

let _openai = null;
const getOpenAI = () => {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
};

export async function runRecommendationBatch() {
  console.log("[recommendations] Iniciando batch...");
  try {
    const { rows } = await pool.query(
      `SELECT id FROM negocios WHERE email_marketing_enabled = true`
    );
    const negocioIds = rows.map((r) => r.id);

    if (negocioIds.length === 0) {
      console.log("[recommendations] Ningún negocio tiene marketing automático activado, skip");
      return;
    }

    let totalSent = 0;
    for (const negocioId of negocioIds) {
      try {
        totalSent += await processNegocio(negocioId);
      } catch (err) {
        console.error(`[recommendations] ❌ Error en negocio ${negocioId}:`, err.message);
      }
    }
    console.log(`[recommendations] ✅ Batch completo — ${totalSent} email(s) enviado(s)`);
  } catch (err) {
    console.error("[recommendations] ❌ Error en batch:", err.message);
  }
}

async function processNegocio(negocioId) {
  let newProducts;
  try {
    newProducts = await getNewProducts(negocioId);
  } catch (err) {
    console.error(`[recommendations] Error consultando productos nuevos para negocio ${negocioId}:`, err.message);
    return 0;
  }

  if (newProducts.length === 0) {
    console.log(`[recommendations] negocio ${negocioId}: sin productos nuevos, skip`);
    return 0;
  }
  console.log(`[recommendations] negocio ${negocioId}: ${newProducts.length} producto(s) nuevo(s):`);
  newProducts.forEach((p) => console.log(`  · "${p.name}" — embedding: ${p.embedding ? "OK" : "NULL"}`));

  let customers;
  try {
    customers = await getCustomerBatch(negocioId, BATCH_SIZE);
  } catch (err) {
    console.error(`[recommendations] Error consultando clientes para negocio ${negocioId}:`, err.message);
    return 0;
  }

  console.log(`[recommendations] ${customers.length} cliente(s) a procesar`);
  if (customers.length === 0) return 0;

  customers.forEach((c) => console.log(`  · ${c.name || "(sin nombre)"} <${c.email}> — score: ${c.score} — último mail: ${c.last_emailed || "nunca"}`));

  let sent = 0;
  for (const customer of customers) {
    try {
      const ok = await processCustomer(customer, newProducts, negocioId);
      if (ok) sent++;
    } catch (err) {
      console.error(`[recommendations] Error inesperado procesando cliente ${customer.id}:`, err.message);
    }
  }
  return sent;
}

async function getNewProducts(negocioId) {
  const res = await pool.query(
    `SELECT
       p.id, p.name, p.description, p.costo_usd, p.embedding,
       COALESCE(
         (SELECT json_agg(json_build_object('key', pi.key) ORDER BY pi.created_at)
          FROM product_images pi WHERE pi.product_id = p.id),
         '[]'
       ) AS images
     FROM products p
     WHERE p.negocio_id = $1
       AND p.active = true
       AND p.deleted_at IS NULL
       AND p.embedding IS NOT NULL
       AND p.created_at > NOW() - INTERVAL '${NEW_PRODUCT_DAYS} days'
     ORDER BY p.created_at DESC`,
    [negocioId]
  );
  return res.rows;
}

async function getCustomerBatch(negocioId, limit) {
  const res = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (COALESCE(c.email, wo_data.customer_email))
       c.id, c.name,
       COALESCE(c.email, wo_data.customer_email) AS email,
       eml_data.last_sent AS last_emailed,
       ROUND((
         -- 35%: recencia del último pedido (0 días = 1.0, 180+ días = 0.0)
         0.35 * GREATEST(0.0, 1.0 - EXTRACT(EPOCH FROM (NOW() - wo_data.last_order)) / (180.0 * 86400)) +
         -- 25%: tiempo sin recibir email (30+ días o nunca = 1.0, recién emaileado = 0.0)
         0.25 * LEAST(1.0, COALESCE(EXTRACT(EPOCH FROM (NOW() - eml_data.last_sent)) / (30.0 * 86400), 1.0)) +
         -- 25%: cantidad de pedidos históricos (10+ pedidos = 1.0)
         0.25 * LEAST(1.0, wo_data.order_count / 10.0) +
         -- 15%: diversidad de categorías compradas (5+ categorías = 1.0)
         0.15 * LEAST(1.0, wo_data.category_count / 5.0)
       )::numeric, 4) AS score
     FROM customers c
     JOIN (
       SELECT
         wo.customer_id,
         MAX(wo.customer_email)       AS customer_email,
         MAX(wo.created_at)           AS last_order,
         COUNT(DISTINCT wo.id)::float AS order_count,
         COUNT(DISTINCT p.category_id)::float AS category_count
       FROM web_orders wo
       LEFT JOIN web_order_items woi ON woi.web_order_id = wo.id
       LEFT JOIN products p ON p.id = woi.product_id
       WHERE wo.negocio_id = $1 AND wo.customer_id IS NOT NULL
       GROUP BY wo.customer_id
     ) wo_data ON wo_data.customer_id = c.id
     LEFT JOIN (
       SELECT customer_id, MAX(sent_at) AS last_sent
       FROM email_marketing_log
       WHERE negocio_id = $1
       GROUP BY customer_id
     ) eml_data ON eml_data.customer_id = c.id
     WHERE COALESCE(c.email, wo_data.customer_email) IS NOT NULL
       AND (eml_data.last_sent IS NULL OR eml_data.last_sent < NOW() - INTERVAL '24 hours')
       AND wo_data.last_order < NOW() - INTERVAL '2 days'
     ORDER BY COALESCE(c.email, wo_data.customer_email), score DESC
     ) deduped
     ORDER BY score DESC
     LIMIT $2`,
    [negocioId, limit]
  );
  return res.rows;
}

async function processCustomer(customer, newProducts, negocioId) {
  if (!customer.email) return false;

  try {
    // Excluir productos que ya le mandamos en emails anteriores O que ya compró alguna vez
    const exclusionRes = await pool.query(
      `SELECT ARRAY_AGG(DISTINCT id) AS ids FROM (
         SELECT pid AS id
         FROM email_marketing_log, UNNEST(product_ids) AS pid
         WHERE customer_id = $1 AND negocio_id = $2
         UNION
         SELECT woi.product_id AS id
         FROM web_order_items woi
         JOIN web_orders wo ON wo.id = woi.web_order_id
         WHERE wo.customer_id = $1 AND wo.negocio_id = $2
       ) sub`,
      [customer.id, negocioId]
    );
    const excluded = new Set(exclusionRes.rows[0]?.ids ?? []);
    const candidateProducts = newProducts.filter((p) => !excluded.has(p.id));

    if (candidateProducts.length === 0) {
      console.log(`  [cliente ${customer.name || "(sin nombre)"} <${customer.email}>] sin candidatos nuevos (ya comprados o ya enviados), skip`);
      return false;
    }

    const productIds = candidateProducts.map((p) => p.id);

    // Para cada producto nuevo, buscar la distancia mínima a cualquier producto que haya comprado el cliente
    const similarRes = await pool.query(
      `SELECT new_prod.id, MIN(new_prod.embedding <=> past.embedding) AS best_distance
       FROM products new_prod
       CROSS JOIN (
         SELECT DISTINCT p.embedding
         FROM web_order_items woi
         JOIN web_orders wo ON wo.id = woi.web_order_id
         JOIN products p ON p.id = woi.product_id
         WHERE wo.customer_id = $1
           AND wo.negocio_id = $2
           AND p.embedding IS NOT NULL
           AND wo.id IN (
             SELECT id FROM web_orders
             WHERE customer_id = $1 AND negocio_id = $2
             ORDER BY created_at DESC
             LIMIT $6
           )
       ) past
       WHERE new_prod.id = ANY($3)
       GROUP BY new_prod.id
       HAVING MIN(new_prod.embedding <=> past.embedding) < $4
       ORDER BY best_distance ASC
       LIMIT $5`,
      [customer.id, negocioId, productIds, SIMILARITY_THRESHOLD, MAX_PRODUCTS_PER_EMAIL, RECENT_ORDERS_LIMIT]
    );

    similarRes.rows.forEach((r) =>
      console.log(`  [cliente ${customer.name || "(sin nombre)"} <${customer.email}>] "${candidateProducts.find(p => p.id === r.id)?.name}" → mejor distancia: ${Number(r.best_distance).toFixed(4)} (umbral: ${SIMILARITY_THRESHOLD})`)
    );

    if (similarRes.rows.length === 0) {
      console.log(`  [cliente ${customer.name || "(sin nombre)"} <${customer.email}>] ningún producto supera el umbral de similitud`);
      return false;
    }

    // Ordenar los productos relevantes por mejor distancia encontrada
    const distanceMap = new Map(similarRes.rows.map((r) => [r.id, r.best_distance]));
    const relevant = candidateProducts
      .filter((p) => distanceMap.has(p.id))
      .sort((a, b) => distanceMap.get(a.id) - distanceMap.get(b.id));

    // Generar contenido del email con GPT
    const content = await generateEmailContent(customer.name, relevant);
    if (!content) return false;

    if (process.env.RECOMMENDATION_DRY_RUN === "true") {
      console.log(`[DRY RUN] ✉️  ${customer.name || "(sin nombre)"} <${customer.email}>`);
      console.log(`[DRY RUN]   Asunto: ${content.subject}`);
      console.log(`[DRY RUN]   Intro:  ${content.intro}`);
      console.log(`[DRY RUN]   Productos: ${relevant.map((p) => p.name).join(", ")}`);
      return true;
    }

    // Enviar email (lanza error si falla SMTP)
    await sendProductRecommendationEmail({
      to:           customer.email,
      customerName: customer.name,
      subject:      content.subject,
      intro:        content.intro,
      closing:      content.closing,
      products:     relevant,
    });

    // Registrar envío (solo si el email no falló)
    await pool.query(
      `INSERT INTO email_marketing_log (customer_id, negocio_id, email, product_ids, subject)
       VALUES ($1, $2, $3, $4, $5)`,
      [customer.id, negocioId, customer.email, relevant.map((p) => p.id), content.subject]
    );

    console.log(`[recommendations] → ${customer.name || "(sin nombre)"} <${customer.email}> (${relevant.length} productos, distancia mín: ${distanceMap.get(relevant[0].id).toFixed(3)})`);
    return true;
  } catch (err) {
    console.error(`[recommendations] Error cliente ${customer.id}:`, err.message);
    return false;
  }
}

async function generateEmailContent(customerName, products) {
  try {
    const productList = products
      .map((p) => `- ${p.name}${p.description ? ": " + p.description.slice(0, 80) : ""}`)
      .join("\n");

    const res = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Sos un copywriter de email marketing para un negocio mayorista argentino. Escribís emails cortos, directos y atractivos en español argentino, tono cercano y profesional.",
        },
        {
          role: "user",
          content: `Generá el contenido de un email para ${customerName || "un cliente"} sobre nuevos productos que llegaron y que pueden interesarle según sus compras anteriores.

Productos nuevos:
${productList}

Reglas:
- Asunto: atractivo, que transmita novedad y urgencia (máximo 60 caracteres, sin emojis en el asunto)
- Intro: 2-3 oraciones presentando que llegaron productos nuevos pensados para ellos, sin mencionar precios
- Closing: 1 oración de cierre amable invitando a comunicarse
- Sin emojis excesivos, máximo 1 en intro y 1 en closing

Respondé SOLO en JSON válido: {"subject": "...", "intro": "...", "closing": "..."}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 300,
    });

    return JSON.parse(res.choices[0].message.content);
  } catch (err) {
    console.error("[recommendations] Error GPT:", err.message);
    return null;
  }
}
