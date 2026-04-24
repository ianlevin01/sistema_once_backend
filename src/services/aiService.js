import OpenAI from "openai";
import ProductRepository from "../repositories/productRepository.js";
import S3Service from "./S3Service.js";

const ID_MARKER = /\[\[ID:([0-9a-f-]{36})\]\]/gi;

export default class AIService {
  repo = new ProductRepository();
  s3   = new S3Service();

  async chat(userMessage, negocioId, baseUrl) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const products = await this.repo.search("", negocioId);

    const productMap = new Map(products.map((p) => [p.id, p]));

    const productContext = products.map((p) => ({
      id:          p.id,
      name:        p.name,
      code:        p.code || "",
      description: p.description || "",
      category:    p.category_name || "",
    }));

    const systemPrompt = `Sos un asistente de e-commerce de Oncepuntos.
Tu trabajo es ayudar a los usuarios a encontrar productos y responder preguntas.

REGLAS:
- Respondé siempre en español, de forma clara y breve.
- Si mencionás un producto, agregá [[ID:uuid]] justo después de su nombre (reemplazá uuid por el id real del producto).
- Marcá como máximo 3 productos distintos con [[ID:uuid]].
- Para cada producto relevante, incluí un link así: ${baseUrl}?buscar=nombre
- Si no encontrás nada relevante, decilo honestamente.
- No inventes productos que no están en la lista.

PRODUCTOS DISPONIBLES:
${JSON.stringify(productContext)}
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userMessage },
      ],
      temperature: 0.4,
    });

    const rawReply = response.choices[0].message.content;

    // Extract product IDs from markers
    const productIds = [];
    let match;
    const re = new RegExp(ID_MARKER.source, "gi");
    while ((match = re.exec(rawReply)) !== null) {
      if (!productIds.includes(match[1])) productIds.push(match[1]);
    }

    // Clean markers from reply text
    const reply = rawReply.replace(new RegExp(ID_MARKER.source, "gi"), "").replace(/\s{2,}/g, " ").trim();

    // Resolve product details + first image signed URL for referenced products
    const referencedProducts = await Promise.all(
      productIds.slice(0, 3).map(async (id) => {
        const p = productMap.get(id);
        if (!p) return null;
        let image_url = null;
        if (p.images?.length > 0) {
          try { image_url = await this.s3.getSignedUrl(p.images[0].key); } catch {}
        }
        return { id: p.id, name: p.name, image_url };
      })
    );

    return {
      reply,
      products: referencedProducts.filter(Boolean),
    };
  }
}
