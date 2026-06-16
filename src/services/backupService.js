import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { spawn } from "child_process";
import { createGzip } from "zlib";
import dbConfig from "../configs/db-config.js";

const BUCKET = "onces3";
const S3_KEY = "backups/oncepuntos_daily.sql.gz";

const s3 = new S3Client({
  region: "sa-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

function dumpAndCompress() {
  return new Promise((resolve, reject) => {
    const pgDump = spawn(
      "pg_dump",
      ["-h", dbConfig.host, "-p", String(dbConfig.port), "-U", dbConfig.user, "-d", dbConfig.database, "--no-password"],
      { env: { ...process.env, PGPASSWORD: String(dbConfig.password || "") } }
    );

    const gzip = createGzip();
    const chunks = [];
    let exitCode = null;
    let gzipDone = false;

    const trySettle = () => {
      if (!gzipDone || exitCode === null) return;
      if (exitCode !== 0) {
        reject(new Error(`pg_dump terminó con código ${exitCode}`));
      } else {
        resolve(Buffer.concat(chunks));
      }
    };

    pgDump.stdout.pipe(gzip);

    gzip.on("data", (chunk) => chunks.push(chunk));
    gzip.on("end", () => { gzipDone = true; trySettle(); });
    gzip.on("error", reject);

    pgDump.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.error("[backup] pg_dump:", msg);
    });

    pgDump.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new Error("pg_dump no encontrado — instalá: sudo apt-get install -y postgresql-client"));
      } else {
        reject(err);
      }
    });

    pgDump.on("close", (code) => { exitCode = code; trySettle(); });
  });
}

export async function runBackup() {
  const start = Date.now();
  console.log("[backup] Iniciando backup de base de datos...");
  try {
    const buffer = await dumpAndCompress();

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: S3_KEY,
      Body: buffer,
      ContentType: "application/gzip",
    }));

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
    console.log(`[backup] ✅ OK — ${sizeMB} MB comprimido → s3://${BUCKET}/${S3_KEY} (${elapsed}s)`);
    return { ok: true, sizeMB: Number(sizeMB), elapsed: Number(elapsed) };
  } catch (err) {
    console.error("[backup] ❌ Error:", err.message);
    return { ok: false, error: err.message };
  }
}
