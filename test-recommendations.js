import "./src/env.js";
process.env.RECOMMENDATION_DRY_RUN = "true";
import { runRecommendationBatch } from "./src/services/productRecommendationService.js";

runRecommendationBatch().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
