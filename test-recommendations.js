import "./src/env.js";
import { runRecommendationBatch } from "./src/services/productRecommendationService.js";

runRecommendationBatch().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
