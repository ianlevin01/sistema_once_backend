-- Agrega configuración de redondeo por nivel de precio
-- Valores: NULL o 0 = sin redondeo, 1 = unidad, 10 = decena, 100 = centena, 1000 = millar
-- El redondeo es siempre hacia ARRIBA (ceiling)

ALTER TABLE price_config
  ADD COLUMN IF NOT EXISTS round_precio_1  INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS round_precio_2  INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS round_precio_3  INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS round_precio_4  INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS round_precio_5  INTEGER DEFAULT NULL;
