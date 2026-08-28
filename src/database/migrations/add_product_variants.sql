CREATE TABLE IF NOT EXISTS product_variants (
  id           SERIAL PRIMARY KEY,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tipo         VARCHAR(10) NOT NULL CHECK (tipo IN ('color', 'tamaño')),
  nombre       VARCHAR(100),
  hex          VARCHAR(7),
  alto         NUMERIC(10,2),
  ancho        NUMERIC(10,2),
  profundidad  NUMERIC(10,2),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);
