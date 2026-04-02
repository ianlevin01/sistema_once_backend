import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import customers from "./controllers/customersRoutes.js";
import products from "./controllers/productsRoutes.js";
import remitos from "./controllers/remitosRoutes.js";
import comprobantes from "./controllers/comprobantesRoutes.js";
import cash from "./controllers/cashRoutes.js";
import aiRoutes from "./controllers/aiRoutes.js";
import webOrders from "./controllers/webOrderRoutes.js";
import cuentaCorrienteRoutes from "./controllers/cuentaCorrienteRoutes.js";
import vendedoresRoutes from "./controllers/vendedoresRoutes.js";
import config from "./controllers/configRoutes.js";
import warehouses from "./controllers/warehousesRoutes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

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
app.use("/api/customers", customers);
app.use("/api/products", products);
app.use("/api/remitos", remitos);
app.use("/api/comprobantes", comprobantes);
app.use("/api/cash", cash);
app.use("/api/ai", aiRoutes);
app.use("/api/web-orders", webOrders);
app.use("/api/cuenta-corriente", cuentaCorrienteRoutes);
app.use("/api/vendedores", vendedoresRoutes);
app.use("/api/config", config);
app.use("/api/warehouses", warehouses);


// Server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
