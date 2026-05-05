import OpenAI from "openai";

let _openai = null;
const getOpenAI = () => {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
};

export async function generateEmbedding(text) {
  const res = await getOpenAI().embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}

export function productToText(p) {
  return [p.name, p.description, p.category_name].filter(Boolean).join(". ");
}
