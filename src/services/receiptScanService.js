import OpenAI from "openai";
import pool from "../database/db.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VISION_PROMPT = `Sos un asistente que lee fotos de comprobantes/facturas de compra o venta de productos (mayorista).

Analizá la imagen y extraé cada línea de producto. Devolvé SOLO un JSON con esta forma exacta:
{"items": [{"codigo": "...", "nombre": "...", "cantidad": N, "precio_unitario": N}]}

Reglas:
- "codigo": el código de producto tal como aparece impreso (puede estar incompleto, cortado, o con guiones/espacios). Si no hay código visible en la línea, usá cadena vacía "".
- "nombre": la descripción del producto tal como aparece.
- "cantidad": cantidad de unidades, como número. Si no es legible, usá 1.
- "precio_unitario": el precio POR UNIDAD (no el subtotal de la línea), como número sin símbolos de moneda ni separadores de miles (usá punto decimal). Si la columna muestra el subtotal de la línea en vez del precio unitario, calculá precio_unitario = subtotal / cantidad.
- Ignorá líneas que no sean productos (totales, subtotales, impuestos, encabezados, datos del emisor/receptor).
- Si no podés leer la imagen o no hay productos, devolvé {"items": []}.`;

const VERIFY_MODEL = "gpt-4o-mini";
const VISION_MODEL = "gpt-4o";

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
      return [];
    }
    return Array.isArray(parsed.items) ? parsed.items : [];
  }

  // ── Paso 2: matchear cada línea contra el catálogo ────────────
  // Devuelve { matched: [{id, code, name, quantity, unit_price}], unmatched: [raw items] }
  async matchProducts(rawItems, negocioId) {
    const matched = [];
    const unmatched = [];
    const pendingVerification = []; // { raw, candidates }

    for (const raw of rawItems) {
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
    return {
      product_id: product.id,
      code:       product.code,
      name:       product.name,
      quantity:   Number(raw.cantidad) > 0 ? Number(raw.cantidad) : 1,
      unit_price: Number(raw.precio_unitario) || 0,
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
