-- ─────────────────────────────────────────────────────────────────────────
-- Migración: Tabla de transportes + remitos de transporte
-- Ejecutar en AWS RDS (PostgreSQL) ANTES de deployar la nueva versión
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Tabla de empresas de transporte
CREATE TABLE IF NOT EXISTS transportes (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo       TEXT NOT NULL,
  razon_social TEXT NOT NULL,
  domicilio    TEXT,
  telefono     TEXT NOT NULL,
  email        TEXT,
  created_at   TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- 2. Migrar los 6 transportes hardcodeados en el frontend
--    (actualizar domicilio/telefono/email desde la sección Transportes del sistema)
INSERT INTO transportes (codigo, razon_social, telefono) VALUES
  ('DALF', 'DON ALFREDO', '-'),
  ('VCGO', 'VIA CARGO',   '-'),
  ('CORR', 'CORREO',      '-'),
  ('OCA',  'OCA',         '-'),
  ('ANDR', 'ANDREANI',    '-'),
  ('RET',  'RETIRA',      '-')
ON CONFLICT DO NOTHING;

-- 3. Tabla de remitos de transporte
CREATE TABLE IF NOT EXISTS transport_remitos (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  numero        SERIAL,
  customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT,
  transporte_id UUID REFERENCES transportes(id) ON DELETE SET NULL,
  envia         TEXT NOT NULL,
  bultos        INTEGER NOT NULL DEFAULT 1,
  valor         NUMERIC(12,2),
  created_at    TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- 4. Índices útiles
CREATE INDEX IF NOT EXISTS idx_transport_remitos_created_at ON transport_remitos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transport_remitos_customer_id ON transport_remitos(customer_id);
