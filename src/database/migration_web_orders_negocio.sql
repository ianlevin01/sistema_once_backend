-- ============================================================
-- MIGRACIÓN: agregar negocio_id a web_orders
-- Ejecutar UNA SOLA VEZ
-- ============================================================

ALTER TABLE web_orders ADD COLUMN negocio_id UUID REFERENCES negocios(id);

-- Asignar todos los pedidos web existentes al negocio por defecto
UPDATE web_orders SET negocio_id = '00000000-0000-0000-0000-000000000001';

CREATE INDEX idx_web_orders_negocio ON web_orders(negocio_id);
