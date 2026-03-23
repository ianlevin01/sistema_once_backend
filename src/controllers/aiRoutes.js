import { Router } from "express";
import AIService from "../services/aiService.js";

const router = Router();
const svc = new AIService();

// Chat IA
router.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Falta el mensaje" });
    }

    const result = await svc.chat(message);

    return res.status(200).json({ reply: result });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error en IA" });
  }
});

export default router;