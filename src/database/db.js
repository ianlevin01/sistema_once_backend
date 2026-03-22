import pkg from "pg";
import config from "../configs/db-config.js";

const { Pool } = pkg;

const pool = new Pool({
  ...config,
  ssl: {
    rejectUnauthorized: false
  }
});

export default pool;