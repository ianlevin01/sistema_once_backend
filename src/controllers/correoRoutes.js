import { Router } from "express";
import { getRates, getAgencies } from "../services/correoArgentinoService.js";

const router = Router();

// POST /api/correo/rates
// Body: { postalCode, weight? }
// Returns all rates (D+S) with price > 0
router.post("/rates", async (req, res) => {
  const { postalCode, weight } = req.body;
  if (!postalCode) return res.status(400).json({ message: "postalCode requerido" });
  try {
    const rates = await getRates(postalCode.trim(), weight ? { weight: parseInt(weight) } : {});
    return res.json(rates);
  } catch (err) {
    console.error("correo /rates error:", err.message);
    return res.status(502).json({ message: "No se pudo calcular el costo de envío" });
  }
});

// GET /api/correo/agencies?province=X
router.get("/agencies", async (req, res) => {
  const { province } = req.query;
  if (!province) return res.status(400).json({ message: "province requerido" });
  try {
    const agencies = await getAgencies(province);
    return res.json(agencies);
  } catch (err) {
    console.error("correo /agencies error:", err.message);
    return res.status(502).json({ message: "No se pudieron obtener las sucursales" });
  }
});

export default router;
