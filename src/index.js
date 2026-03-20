import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import customers from "./customers.routes.js";
import products from "./products.routes.js";
import remitos from "./remitos.routes.js";
import comprobantes from "./comprobantes.routes.js";
import cash from "./cash.routes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  next();
});
app.use(express.json());
app.use(cors());

// Health check
app.get("/health", (_, res) => {
  res.send("OK");
});

// Rutas
router.use("/customers", customers);
router.use("/products", products);
router.use("/remitos", remitos);
router.use("/comprobantes", comprobantes);
router.use("/cash", cash);



// Server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});