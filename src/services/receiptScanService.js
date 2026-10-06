import OpenAI from "openai";
import pool from "../database/db.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VISION_PROMPT = `Sos un asistente que lee fotos de comprobantes/facturas de compra o venta de productos (mayorista, Argentina).

Analizá la imagen y extraé cada línea de producto. Devolvé SOLO un JSON con esta forma exacta:
{"divisa": "ARS" o "USD", "items": [{"codigo": "...", "nombre": "...", "cantidad": N, "precio_unitario": N}]}

Reglas:
- "divisa": la moneda en la que están expresados los precios del comprobante.
  - Usá "USD" SOLO si ves indicadores explícitos de dólares: "U$S", "USD", "US$", "u$d", o la palabra "dólares"/"dolares"/"dollars".
  - El símbolo "$" solo, SIN ninguna de esas marcas, es PESOS ARGENTINOS — es la convención más común en Argentina. No asumas dólares solo por ver "$".
  - Si tenés dudas o no hay ninguna marca de moneda visible, respondé "ARS".
- "codigo": el código de producto tal como aparece impreso (puede estar incompleto, cortado, o con guiones/espacios). Si no hay código visible en la línea, usá cadena vacía "".
- "nombre": la descripción del producto tal como aparece.
- "cantidad": cantidad de unidades, como número. Si no es legible, usá 1.
- "precio_unitario": el precio POR UNIDAD (no el subtotal de la línea), como número sin símbolos de moneda ni separadores de miles (usá punto decimal), en la divisa que indicaste en "divisa". Si la columna muestra el subtotal de la línea en vez del precio unitario, calculá precio_unitario = subtotal / cantidad. Ejemplo de formato correcto: 1500.5 (NO "1.500,50", NO "$1.500", NO "1,500.50").
- Ignorá líneas que no sean productos (totales, subtotales, impuestos, encabezados, datos del emisor/receptor).
- Si no podés leer la imagen o no hay productos, devolvé {"divisa": "ARS", "items": []}.`;

const VERIFY_MODEL = "gpt-4o-mini";
const VISION_MODEL = "gpt-4o";

// La IA de visión a veces devuelve el número con formato no estándar pese al
// prompt (separadores de miles, símbolo de moneda colado, coma decimal estilo
// argentino). Number() directo falla silenciosamente a NaN en esos casos, y
// eso terminaba guardándose como precio 0. Este parser intenta limpiar los
// formatos más comunes antes de darse por vencido.
function parseFlexibleNumber(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  let s = String(raw ?? "").trim();
  if (!s) return 0;

  let n = Number(s);
  if (Number.isFinite(n)) return n;

  s = s.replace(/u\$d|us\$|u\$s|usd|ars|\$|\s/gi, "");
  n = Number(s);
  if (Number.isFinite(n)) return n;

  const hasComma = s.includes(",");
  const hasDot   = s.includes(".");
  if (hasComma && hasDot) {
    // Mezcla de separadores: el último símbolo no-dígito es el decimal, el resto son de miles.
    const lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
    const intPart  = s.slice(0, lastSep).replace(/[.,]/g, "");
    const decPart  = s.slice(lastSep + 1).replace(/[^\d]/g, "");
    n = Number(decPart ? `${intPart}.${decPart}` : intPart);
  } else if (hasComma) {
    // Solo coma, sin punto: tratarla como separador de miles (ej. "1,500" = 1500).
    n = Number(s.replace(/,/g, ""));
  }

  return Number.isFinite(n) ? n : 0;
}

export default class ReceiptScanService {
  // ── Paso 1: IA de visión extrae las líneas de la foto ─────────
  async analyzeImage(base64Image, mimetype) {
    const response = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: VISION_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mimetype};base64,${base64Image}` } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    let parsed;
    try {
      parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    } catch {
      return { divisa: "ARS", items: [] };
    }
    return {
      divisa: parsed.divisa === "USD" ? "USD" : "ARS",
      items:  Array.isArray(parsed.items) ? parsed.items : [],
    };
  }

  // ── Paso 2: matchear cada línea contra el catálogo ────────────
  // Si la foto está en USD, convierte cada precio a su equivalente en ARS con
  // la cotización actual del negocio ANTES de matchear — el comprobante nuevo
  // arranca sin cliente/proveedor (divisa ARS por default), así que el valor
  // numérico que se precarga tiene que ser el que corresponde en pesos.
  // Devuelve { matched: [{id, code, name, quantity, unit_price}], unmatched: [raw items] }
  async matchProducts(rawItems, negocioId, divisa = "ARS") {
    let items = rawItems;
    if (divisa === "USD") {
      const cotizRes = await pool.query(
        `SELECT cotizacion_dolar FROM price_config WHERE negocio_id = $1 LIMIT 1`,
        [negocioId]
      );
      const cotizacion = Number(cotizRes.rows[0]?.cotizacion_dolar || 1000);
      items = rawItems.map((raw) => ({
        ...raw,
        precio_unitario: parseFlexibleNumber(raw.precio_unitario) * cotizacion,
      }));
    }

    const matched = [];
    const unmatched = [];
    const pendingVerification = []; // { raw, candidates }

    for (const raw of items) {
      const codigo = String(raw.codigo || "").trim();
      if (!codigo) {
        unmatched.push(raw);
        continue;
      }

      const exact = await pool.query(
        `SELECT id, code, name FROM products
         WHERE negocio_id = $1 AND active = true AND deleted_at IS NULL
           AND LOWER(TRIM(code)) = LOWER($2)
         LIMIT 1`,
        [negocioId, codigo]
      );
      if (exact.rows[0]) {
        matched.push(this._toMatchedItem(exact.rows[0], raw));
        continue;
      }

      // Código no encontrado tal cual: partir a la mitad y buscar por fragmentos,
      // porque a veces el código en la foto viene incompleto o con un caracter distinto.
      if (codigo.length >= 4) {
        const mid   = Math.ceil(codigo.length / 2);
        const half1 = codigo.slice(0, mid);
        const half2 = codigo.slice(mid);
        const fuzzy = await pool.query(
          `SELECT id, code, name FROM products
           WHERE negocio_id = $1 AND active = true AND deleted_at IS NULL
             AND (code ILIKE $2 OR code ILIKE $3)
           LIMIT 6`,
          [negocioId, `%${half1}%`, `%${half2}%`]
        );
        if (fuzzy.rows.length > 0) {
          pendingVerification.push({ raw, candidates: fuzzy.rows });
          continue;
        }
      }

      unmatched.push(raw);
    }

    if (pendingVerification.length > 0) {
      const { resolved, rejected } = await this._verifySemantic(pendingVerification);
      matched.push(...resolved);
      unmatched.push(...rejected);
    }

    return { matched, unmatched };
  }

  _toMatchedItem(product, raw) {
    const qty = parseFlexibleNumber(raw.cantidad);
    return {
      product_id: product.id,
      code:       product.code,
      name:       product.name,
      quantity:   qty > 0 ? qty : 1,
      unit_price: parseFlexibleNumber(raw.precio_unitario),
    };
  }

  // ── Paso 3: IA de texto decide si algún candidato coincide semánticamente ──
  async _verifySemantic(pending) {
    const prompt = `Para cada ítem de "items", decidí cuál de sus "candidatos" (si alguno) es el MISMO producto que el de la foto, comparando los nombres semánticamente (pueden estar abreviados, en otro orden de palabras, etc). Si ningún candidato es razonablemente el mismo producto, usá null.

Devolvé SOLO un JSON: {"resultados": [{"indice": N, "candidato_id": "uuid o null"}]}

Items:
${JSON.stringify(
  pending.map((p, i) => ({
    indice: i,
    nombre_foto: p.raw.nombre || "",
    candidatos: p.candidates.map((c) => ({ id: c.id, nombre: c.name })),
  })),
  null,
  2
)}`;

    let resultados = [];
    try {
      const response = await openai.chat.completions.create({
        model: VERIFY_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0,
      });
      const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
      resultados = Array.isArray(parsed.resultados) ? parsed.resultados : [];
    } catch {
      // Si falla la verificación, ningún candidato se da por confirmado.
    }

    const resolved = [];
    const rejected = [];
    pending.forEach((p, i) => {
      const result      = resultados.find((r) => r.indice === i);
      const candidateId = result?.candidato_id || null;
      const match       = candidateId ? p.candidates.find((c) => c.id === candidateId) : null;
      if (match) resolved.push(this._toMatchedItem(match, p.raw));
      else rejected.push(p.raw);
    });

    return { resolved, rejected };
  }
}
