import { Router } from "express";
import AIService from "../services/aiService.js";

const router = Router();
const svc = new AIService();

router.post("/chat", async (req, res) => {
  try {
    const { message, negocio_id, base_url } = req.body;

    if (!message)    return res.status(400).json({ error: "Falta el mensaje" });
    if (!negocio_id) return res.status(400).json({ error: "Falta negocio_id" });

    const result = await svc.chat(message, negocio_id, base_url ?? "");

    return res.status(200).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error en IA" });
  }
});

export default router;
