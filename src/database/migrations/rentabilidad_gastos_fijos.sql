-- Migración: tabla gastos_fijos para panel de Rentabilidad
-- Correr en producción ANTES del deploy del backend
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gastos_fijos (
  id          SERIAL PRIMARY KEY,
  negocio_id  UUID        NOT NULL,
  descripcion TEXT        NOT NULL,
  monto       NUMERIC(12,2) NOT NULL CHECK (monto >= 0),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gastos_fijos_negocio_idx ON gastos_fijos (negocio_id);
