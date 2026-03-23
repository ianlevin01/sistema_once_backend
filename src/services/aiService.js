import OpenAI from "openai";
import ProductRepository from "../repositories/productRepository.js";



export default class AIService {
  repo = new ProductRepository();
  async chat(userMessage) {
    const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
    // 1. Traer productos (podés limitar a 50-100)
    const products = await this.repo.search(""); // todos

    // 2. Formatear productos para IA
    const productContext = products.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      code: p.code
    }));

    // 3. Prompt
    const systemPrompt = `
Sos un asistente de e-commerce.

Tu trabajo es ayudar a los usuarios a encontrar productos y responder preguntas sobre ellos.

REGLAS:
- Si el usuario busca un producto, sugerí el más parecido.
- Si encontrás uno relevante, devolvé:
  - nombre
  - breve explicación
  - link: ${process.env.BASE_URL}/{id}
- Si preguntan algo sobre un producto (ej: si tiene enchufe), usá la descripción.
- Si no estás seguro, decilo.
- Respondé SIEMPRE en español.
- Sé claro y corto.

PRODUCTOS:
${JSON.stringify(productContext, null, 2)}
`;

    // 4. Llamada a OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      temperature: 0.4
    });

    return response.choices[0].message.content;
  }
}