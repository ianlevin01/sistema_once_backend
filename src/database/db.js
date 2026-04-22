import pkg from "pg";
import config from "../configs/db-config.js";

const { Pool } = pkg;

const pool = new Pool({
  ...config,
  ssl: {
    rejectUnauthorized: false
  },
  options: "-c timezone=America/Argentina/Buenos_Aires"
});

// Eliminás el pool.on('connect') completamente

export default pool;