# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start development server (nodemon, auto-reload)
npm run index

# No build step — project uses ES modules directly (no transpilation)
# No linter configured
# No test framework configured
```

## Architecture

This is an Express.js + PostgreSQL backend for "Sistema Oncepuntos," a business management system (ERP-like) supporting inventory, invoicing, e-commerce, customer accounting, and AI-powered product search. The codebase uses ES modules (`"type": "module"` in package.json).

### Three-Layer Pattern: Controllers → Services → Repositories

- **`src/controllers/`** — Express routers. Each file registers routes and delegates to a service. Authentication logic (`requireAuth()`) is implemented inline in route files rather than as shared middleware.
- **`src/services/`** — Business logic layer. Services orchestrate repositories and external services (S3, OpenAI). Complex logic lives here (price calculation, transaction management, order lifecycle).
- **`src/repositories/`** — Data access layer. Raw SQL queries using parameterized statements via the `pg` pool. PostgreSQL `json_agg()` and `json_build_object()` are used heavily to aggregate nested data in single queries (products with images/prices, orders with items, etc.).

### Database

- PostgreSQL on AWS RDS (`sa-east-1`). No ORM — raw SQL only.
- Connection pool in `src/database/db.js`, config in `src/configs/db-config.js`.
- Schema reference: `src/database/DBonce_antesdevendedores.sql`.

### Key Domain Concepts

**Pricing engine:** Products store `costo_usd` (USD cost). ARS prices are computed on-the-fly from a global `price_config` table (5 markup tiers + exchange rate). Prices are never stored — always calculated. `ProductService` caches `price_config` for 60 seconds in memory.

**Document types** (`orders` table `tipo` field): Presupuesto (quote), Presupuesto Web, Nota de Pedido (purchase order), Nota de Pedido Web, Reposicion (supplier replenishment), Devolucion (return), Devol a proveedor. `ComprobanteService` handles creation of all these types in a single transaction.

**Web order lifecycle:** Customer creates a web order → staff sets `reservado=true` → `WebOrderService.setReservado()` automatically creates a "Nota de Pedido Web" comprobante and links `order_id`.

**Multi-currency:** ARS/USD supported throughout. Customers, suppliers, and orders each have a `divisa` field. Conversions use the global `cotizacion_dolar` from `price_config`.

### Authentication

Two separate auth systems:
- **Internal staff** (`/api/auth`): Password + bcrypt → 12-hour JWT with `role`, `warehouse_id`, `commission_pct`.
- **E-commerce users** (`/api/shop`): Email/password → 30-day JWT with embedded `customer_id`.

### External Integrations

- **AWS S3** (`src/services/S3Service.js`): Product image upload/delete, signed URLs (1-hour expiry). Multer memory storage, no temp files on disk. Keys follow pattern `products/{uuid}-{originalname}`.
- **OpenAI** (`src/services/aiService.js`): GPT-4o-mini for product recommendation chat. Loads all products into context per request.

### API Routes (all under `/api/`)

`customers`, `products`, `comprobantes`, `remitos`, `cash`, `cuenta-corriente`, `web-orders`, `vendedores`, `proveedores`, `warehouses`, `config`, `auth`, `shop`, `users`, `ai`. Health check at `/health`.

### Environment Variables

Required in `.env`:
```
OPENAI_API_KEY
BASE_URL          # Frontend base URL (used in AI link generation)
AWS_REGION
AWS_BUCKET
AWS_ACCESS_KEY
AWS_SECRET_KEY
JWT_SECRET
```
