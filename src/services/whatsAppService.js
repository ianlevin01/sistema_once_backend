import pool from "../database/db.js";

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      negocio_id  UUID NOT NULL UNIQUE,
      session_id  TEXT NOT NULL,
      openwa_id   TEXT,
      openwa_url  TEXT NOT NULL DEFAULT 'http://localhost:2785',
      api_key     TEXT,
      phone       TEXT,
      features    JSONB NOT NULL DEFAULT '{"campaign_send": false}',
      created_at  TIMESTAMP DEFAULT NOW(),
      updated_at  TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS openwa_id TEXT`);
} catch (err) {
  console.error("[whatsapp] Error al inicializar tabla:", err.message);
}

class WhatsAppService {
  // Usa openwa_id (id interno de OpenWA) para construir la URL
  #fetch(session, path, opts = {}) {
    const id = session.openwa_id || session.session_id;
    const url = `${session.openwa_url}/api/sessions/${id}${path}`;
    return fetch(url, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(session.api_key ? { "X-API-Key": session.api_key } : {}),
        ...(opts.headers || {}),
      },
    });
  }

  async getSession(negocioId) {
    const { rows } = await pool.query(
      "SELECT * FROM whatsapp_sessions WHERE negocio_id = $1",
      [negocioId]
    );
    return rows[0] || null;
  }

  async upsertSession(negocioId) {
    const sessionId  = negocioId; // usamos el negocioId como nombre de sesión en OpenWA
    const openwa_url = process.env.OPENWA_URL || "http://localhost:2785";
    const api_key    = process.env.OPENWA_API_KEY || null;
    const { rows } = await pool.query(
      `INSERT INTO whatsapp_sessions (negocio_id, session_id, openwa_url, api_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (negocio_id) DO UPDATE
         SET session_id = $2,
             openwa_url = $3,
             api_key    = $4,
             updated_at = NOW()
       RETURNING *`,
      [negocioId, sessionId, openwa_url, api_key]
    );
    return rows[0];
  }

  async #resolveOpenwaId(session) {
    // Devuelve el id interno de OpenWA para esta sesión.
    // Si ya lo tenemos en BD lo devuelve directo; si no, lo busca via GET /api/sessions.
    if (session.openwa_id) return session.openwa_id;

    const res = await fetch(`${session.openwa_url}/api/sessions`, {
      headers: { ...(session.api_key ? { "X-API-Key": session.api_key } : {}) },
    });
    if (!res.ok) throw new Error("No se pudo listar sesiones de OpenWA");
    const list = await res.json();
    const found = Array.isArray(list)
      ? list.find(s => s.name === session.session_id)
      : null;
    if (!found) throw new Error(`Sesión '${session.session_id}' no encontrada en OpenWA`);
    return found.id;
  }

  async getStatus(negocioId) {
    const session = await this.getSession(negocioId);
    if (!session) return { status: "no_session" };

    try {
      const res = await this.#fetch(session, "");
      if (!res.ok) {
        console.log(`[whatsapp] getStatus HTTP ${res.status}`);
        if (res.status === 404) return { status: "disconnected" };
        return { status: "disconnected" };
      }
      const data = await res.json();
      const waStatus = data?.status ?? "";
      console.log(`[whatsapp] getStatus raw status="${waStatus}" full=`, JSON.stringify(data));
      let status = "disconnected";
      if (["CONNECTED", "connected", "ready"].includes(waStatus))                       status = "connected";
      else if (["QR", "STARTING", "qr_ready", "connecting"].includes(waStatus))       status = "qr_pending";

      if (status === "connected" && data?.phone) {
        await pool.query(
          "UPDATE whatsapp_sessions SET phone = $1, updated_at = NOW() WHERE negocio_id = $2",
          [data.phone, negocioId]
        );
      }
      return { status, phone: data?.phone || session.phone || null };
    } catch {
      return { status: "openwa_offline" };
    }
  }

  async startSession(negocioId) {
    const session = await this.upsertSession(negocioId);
    const headers = {
      "Content-Type": "application/json",
      ...(session.api_key ? { "X-API-Key": session.api_key } : {}),
    };

    try {
      // 1. Crear sesión en OpenWA (puede dar 409 si ya existe)
      const createRes = await fetch(`${session.openwa_url}/api/sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: session.session_id }),
      });

      let openwaId;
      if (createRes.ok) {
        const data = await createRes.json();
        openwaId = data.id;
      } else if (createRes.status === 409) {
        // Ya existe — buscamos el id interno
        openwaId = await this.#resolveOpenwaId(session);
      } else {
        const err = await createRes.text();
        throw new Error(`OpenWA create session error: ${err}`);
      }

      // 2. Guardar el id interno en BD para todos los llamados futuros
      await pool.query(
        "UPDATE whatsapp_sessions SET openwa_id = $1, updated_at = NOW() WHERE negocio_id = $2",
        [openwaId, negocioId]
      );
      session.openwa_id = openwaId;

      // 3. Iniciar la sesión
      const res = await this.#fetch(session, "/start", { method: "POST", body: JSON.stringify({}) });
      if (!res.ok && res.status !== 409) {
        const errText = await res.text();
        if (errText.includes("already started")) return { ok: true };
        throw new Error(`OpenWA start error: ${errText}`);
      }
      return { ok: true };
    } catch (err) {
      throw new Error(`No se pudo conectar con OpenWA: ${err.message}`);
    }
  }

  async getQR(negocioId) {
    const session = await this.getSession(negocioId);
    if (!session) throw new Error("No hay sesión configurada");
    const res = await this.#fetch(session, "/qr");
    if (!res.ok) throw new Error("QR no disponible");
    const data = await res.json();
    if (!data.qrCode) throw new Error("QR no disponible");
    return data.qrCode; // data URI: "data:image/png;base64,..."
  }

  async disconnect(negocioId) {
    const session = await this.getSession(negocioId);
    if (!session) return;
    try {
      await this.#fetch(session, "", { method: "DELETE" });
    } catch { /* silencioso — si OpenWA está offline igual borramos de BD */ }
    await pool.query(
      "UPDATE whatsapp_sessions SET phone = NULL, openwa_id = NULL, updated_at = NOW() WHERE negocio_id = $1",
      [negocioId]
    );
  }

  async getFeatures(negocioId) {
    const session = await this.getSession(negocioId);
    return session?.features ?? { campaign_send: false };
  }

  async updateFeatures(negocioId, features) {
    await pool.query(
      `UPDATE whatsapp_sessions SET features = $1, updated_at = NOW() WHERE negocio_id = $2`,
      [JSON.stringify(features), negocioId]
    );
  }

  async sendMessage(negocioId, phone, text) {
    const session = await this.getSession(negocioId);
    if (!session) throw new Error("No hay sesión de WhatsApp");
    const digits = String(phone).replace(/\D/g, "");
    if (!digits) throw new Error("Número inválido");
    const chatId = `${digits}@c.us`;
    console.log(`[whatsapp] sendMessage → chatId=${chatId} openwa_id=${session.openwa_id} text_len=${text?.length}`);
    const res = await this.#fetch(session, "/messages/send-text", {
      method: "POST",
      body: JSON.stringify({ chatId, text }),
    });
    const resText = await res.text();
    console.log(`[whatsapp] sendMessage response → ${res.status} body=${resText}`);
    if (!res.ok) throw new Error(`Error enviando WA: ${resText}`);
    return JSON.parse(resText);
  }
}

export default new WhatsAppService();
