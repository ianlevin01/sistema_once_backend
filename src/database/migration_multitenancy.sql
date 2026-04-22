-- ============================================================
-- MIGRACIÓN: Multi-tenancy — soporte de múltiples negocios
-- Ejecutar UNA SOLA VEZ en la base de datos de producción
-- ============================================================

-- 1. Tabla de negocios
CREATE TABLE negocios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  razon_social TEXT,
  cuit         TEXT,
  domicilio    TEXT,
  logo_key     TEXT,
  created_at   TIMESTAMP DEFAULT now()
);

-- 2. Negocio por defecto para todos los datos existentes
INSERT INTO negocios (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Oncepuntos');

-- 3. Agregar negocio_id (nullable primero para poder backfill)
ALTER TABLE users          ADD COLUMN negocio_id UUID REFERENCES negocios(id);
ALTER TABLE warehouses     ADD COLUMN negocio_id UUID REFERENCES negocios(id);
ALTER TABLE customers      ADD COLUMN negocio_id UUID REFERENCES negocios(id);
ALTER TABLE proveedores    ADD COLUMN negocio_id UUID REFERENCES negocios(id);
ALTER TABLE vendedores     ADD COLUMN negocio_id UUID REFERENCES negocios(id);
ALTER TABLE products       ADD COLUMN negocio_id UUID REFERENCES negocios(id);
ALTER TABLE categories     ADD COLUMN negocio_id UUID REFERENCES negocios(id);
ALTER TABLE orders         ADD COLUMN negocio_id UUID REFERENCES negocios(id);
ALTER TABLE cash_movements ADD COLUMN negocio_id UUID REFERENCES negocios(id);
ALTER TABLE price_config   ADD COLUMN negocio_id UUID REFERENCES negocios(id);

-- 4. Asignar todos los datos existentes al negocio por defecto
UPDATE users          SET negocio_id = '00000000-0000-0000-0000-000000000001';
UPDATE warehouses     SET negocio_id = '00000000-0000-0000-0000-000000000001';
UPDATE customers      SET negocio_id = '00000000-0000-0000-0000-000000000001';
UPDATE proveedores    SET negocio_id = '00000000-0000-0000-0000-000000000001';
UPDATE vendedores     SET negocio_id = '00000000-0000-0000-0000-000000000001';
UPDATE products       SET negocio_id = '00000000-0000-0000-0000-000000000001';
UPDATE categories     SET negocio_id = '00000000-0000-0000-0000-000000000001';
UPDATE orders         SET negocio_id = '00000000-0000-0000-0000-000000000001';
UPDATE cash_movements SET negocio_id = '00000000-0000-0000-0000-000000000001';
UPDATE price_config   SET negocio_id = '00000000-0000-0000-0000-000000000001';

-- 5. Hacer NOT NULL (customers queda nullable para soportar clientes de la tienda web global)
ALTER TABLE users          ALTER COLUMN negocio_id SET NOT NULL;
ALTER TABLE warehouses     ALTER COLUMN negocio_id SET NOT NULL;
ALTER TABLE proveedores    ALTER COLUMN negocio_id SET NOT NULL;
ALTER TABLE vendedores     ALTER COLUMN negocio_id SET NOT NULL;
ALTER TABLE products       ALTER COLUMN negocio_id SET NOT NULL;
ALTER TABLE categories     ALTER COLUMN negocio_id SET NOT NULL;
ALTER TABLE orders         ALTER COLUMN negocio_id SET NOT NULL;
ALTER TABLE cash_movements ALTER COLUMN negocio_id SET NOT NULL;
ALTER TABLE price_config   ALTER COLUMN negocio_id SET NOT NULL;
-- customers.negocio_id es nullable: clientes creados desde la tienda web tienen negocio_id = NULL

-- 6. price_config: constraint de una fila por negocio
ALTER TABLE price_config ADD CONSTRAINT price_config_negocio_unique UNIQUE (negocio_id);

-- 7. warehouses: el nombre puede repetirse entre negocios distintos
ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_name_key;
ALTER TABLE warehouses ADD CONSTRAINT warehouses_negocio_name_unique UNIQUE (negocio_id, name);

-- 8. Índices de performance para filtros por negocio
CREATE INDEX idx_users_negocio          ON users(negocio_id);
CREATE INDEX idx_warehouses_negocio     ON warehouses(negocio_id);
CREATE INDEX idx_customers_negocio      ON customers(negocio_id);
CREATE INDEX idx_proveedores_negocio    ON proveedores(negocio_id);
CREATE INDEX idx_vendedores_negocio     ON vendedores(negocio_id);
CREATE INDEX idx_products_negocio       ON products(negocio_id);
CREATE INDEX idx_categories_negocio     ON categories(negocio_id);
CREATE INDEX idx_orders_negocio         ON orders(negocio_id);
CREATE INDEX idx_cash_movements_negocio ON cash_movements(negocio_id);

-- ============================================================
-- Para crear un nuevo negocio manualmente:
--
-- INSERT INTO negocios (name, razon_social, cuit)
-- VALUES ('Nombre Negocio', 'Razón Social S.A.', '30-12345678-9')
-- RETURNING id;
--
-- Luego crear usuarios con ese negocio_id:
-- INSERT INTO users (name, email, password_hash, role, negocio_id)
-- VALUES ('Admin', 'admin@negocio.com', '<bcrypt_hash>', 'admin', '<negocio_id>');
-- ============================================================
