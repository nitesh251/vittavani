# Architecture

Vittavani uses a small modular monolith: a Next.js/TypeScript web client calls a Python/FastAPI service, which owns validation and persistence through SQLAlchemy. PostgreSQL is the intended shared database. SQLite is supported for lightweight local tests only.

## Backend boundaries

- `backend/app/main.py`: FastAPI application and HTTP routes.
- `backend/app/config.py`: environment-backed configuration.
- `backend/app/database.py`: SQLAlchemy engine and request-scoped sessions.
- `backend/app/models.py`: business-scoped catalogue and inventory persistence models.
- `backend/app/query_understanding.py`: pure deterministic multilingual intent and entity matching.
- `backend/app/query_service.py`: database-backed product lookup and answer construction.
- `backend/alembic/`: versioned database schema changes.

Every business-owned model carries a `business_id`; foreign keys and compound uniqueness constraints keep associations within a business. Database lookups must always include the authenticated business scope. The initial development-token seam is not production authentication; protected development API routes are disabled outside development mode.

## Query path

The query endpoint keeps the exact input, identifies read-only lookup intent, removes recognized command phrases before resolving a product, then matches active products in this order: canonical name, aliases, normalized exact name/alias, and fuzzy token similarity. Fuzzy ties return candidate names for clarification. Locations and quantities are read only from authorized database balances, never inferred from language-model output or fabricated.

## Frontend

The Next.js app provides a small responsive Ask Vittavani interface. Text is the supported input path; speech recognition, authentication, onboarding, and the rest of the operating areas are not yet implemented.

## Deployment and security

Use PostgreSQL and a managed identity provider/JWT verification layer before production exposure. Do not enable the development bearer token in production. Configure secrets through the hosting platform, restrict CORS to the actual frontend origin, and use TLS. Schema changes are managed with Alembic, not `create_all()`. See `IMPLEMENTATION_STATUS.md` for unimplemented security and operational controls.
