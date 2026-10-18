# Architecture

Vittavani uses a small modular monolith: a Next.js/TypeScript web client calls a Python/FastAPI service, which owns validation and persistence through SQLAlchemy. PostgreSQL is the intended shared database. SQLite is supported for lightweight local tests only.

## Backend boundaries

- `backend/app/main.py`: FastAPI application and HTTP routes.
- `backend/app/config.py`: environment-backed configuration.
- `backend/app/database.py`: SQLAlchemy engine and request-scoped sessions.
- `backend/app/models.py`: business-scoped catalogue and inventory persistence models.
- `backend/app/query_understanding.py`: pure deterministic multilingual intent and entity matching.
- `backend/app/query_service.py`: database-backed product lookup and answer construction.
- `backend/app/main.py`: development-token-scoped dashboard aggregates, product/location creation, and transactional stock receipt/transfer routes.
- `backend/app/ai_service.py`: optional Groq-backed structured query interpretation; provider output is validated and never supplies inventory facts or SQL.
- `backend/app/inventory_metrics.py`: shared tenant-scoped quantity aggregation and canonical low-stock rule used by inventory search and dashboard APIs.
- `backend/alembic/`: versioned database schema changes.

Every business-owned model carries a `business_id`; foreign keys and compound uniqueness constraints keep associations within a business. Database lookups must always include the authorized business scope. The initial development-token seam is not production authentication; protected development API routes are disabled outside development mode.

## Query path

Normal Search keeps the exact input, identifies read-only lookup intent, removes recognized command phrases before resolving a product, then matches active products in this order: canonical name, aliases, normalized exact name/alias, and fuzzy token similarity. Fuzzy ties return candidate names for clarification. Optional AI mode uses Groq only to extract a validated read intent and product wording before invoking that same lookup. Locations and quantities are read only from authorized database balances, never inferred from language-model output or fabricated.

The initial write routes support product/location creation, confirmed stock receipt, and two-entry stock transfers. A transfer locks the source balance and adjusts both location balances plus both movement records in one transaction. Automatic transliteration, sales, customer credit, and production authentication are not available.

## Frontend

The Next.js home page combines database-derived catalogue/stock totals, grouped by configured unit without converting unlike quantities, low-stock/out-of-stock alerts, location rollups, and stock-movement history. Inventory supports name/alias/SKU search and status/sort filters. The assistant has Normal Search and AI Assistant modes; browser speech recognition uses Hindi/Indian English modes when supported, with editable transcripts and a typed fallback, and optional answer speech uses the browser speech synthesizer. Sales/customer balances are omitted because those records and APIs do not exist yet.

In development, the same-origin Next.js API proxy attaches `X-Dev-Token` using the server environment variable `DEV_API_TOKEN`. Do not use a `NEXT_PUBLIC_*` variable for the token; rename any legacy frontend setting to `DEV_API_TOKEN`. The backend's root `.env` remains authoritative for token validation.

The development-token proxy rejects protected API calls outside `next dev`; production use requires a separate production authentication and authorization implementation.

## Deployment and security

Use PostgreSQL and a managed identity provider/JWT verification layer before production exposure. Do not enable the development bearer token in production. Configure secrets through the hosting platform, restrict CORS to the actual frontend origin, and use TLS. Schema changes are managed with Alembic, not `create_all()`. See `IMPLEMENTATION_STATUS.md` for unimplemented security and operational controls.
