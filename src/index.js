import "./env.js";
import express from "express";
import cors from "cors";
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
import shopAuthRouter from "./controllers/shopAuthRoutes.js";
import authRoutes from "./controllers/authRoutes.js";
import userRoutes from "./controllers/userRoutes.js";
import proveedorRoutes       from "./controllers/proveedorRoutes.js";
import transportesRoutes     from "./controllers/transportesRoutes.js";
import transportRemitosRoutes from "./controllers/transportRemitosRoutes.js";
import stockRoutes             from "./controllers/stockRoutes.js";
import correoRoutes            from "./controllers/correoRoutes.js";
import emailCampaignRoutes     from "./controllers/emailCampaignRoutes.js";
import rentabilidadRoutes      from "./controllers/rentabilidadRoutes.js";
import printRoutes             from "./controllers/printRoutes.js";
import passwordResetRoutes     from "./controllers/passwordResetRoutes.js";
import aiAgentRoutes           from "./controllers/aiAgentRoutes.js";
import backupRoutes            from "./controllers/backupRoutes.js";
import cron                    from "node-cron";
import { runBackup }           from "./services/backupService.js";
import { runRecommendationBatch } from "./services/productRecommendationService.js";


process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandledRejection — el proceso sigue corriendo:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[server] uncaughtException — el proceso sigue corriendo:", err.message);
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Middlewares
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  next();
});
app.use(express.json({ limit: "10mb" }));
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
app.use("/api/ai/agent", aiAgentRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/web-orders", webOrders);
app.use("/api/cuenta-corriente", cuentaCorrienteRoutes);
app.use("/api/vendedores", vendedoresRoutes);
app.use("/api/config", config);
app.use("/api/warehouses", warehouses);
app.use("/api/shop", shopAuthRouter);
app.use("/api/shop/password-reset", passwordResetRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/proveedores",        proveedorRoutes);
app.use("/api/transportes",        transportesRoutes);
app.use("/api/transport-remitos",  transportRemitosRoutes);
app.use("/api/stock",              stockRoutes);
app.use("/api/correo",             correoRoutes);
app.use("/api/email-campaign",     emailCampaignRoutes);
app.use("/api/rentabilidad",       rentabilidadRoutes);
app.use("/api/print",              printRoutes);
app.use("/api/backup",             backupRoutes);

// Server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log("")

  // Backup diario a las 04:00 ART (America/Argentina/Buenos_Aires)
  cron.schedule("0 4 * * *", () => { runBackup(); }, {
    timezone: "America/Argentina/Buenos_Aires",
  });
  console.log("[backup] Cron programado: 04:00 ART todos los días → s3://onces3/backups/oncepuntos_daily.sql.gz");

  // Recomendaciones por email: 07:30 ART todos los días
  cron.schedule("30 7 * * *", () => {
    runRecommendationBatch().catch((err) =>
      console.error("[recommendations] Error no capturado en batch:", err.message)
    );
  }, {
    timezone: "America/Argentina/Buenos_Aires",
  });
  console.log("[recommendations] Cron programado: 07:30 ART todos los días");
});
