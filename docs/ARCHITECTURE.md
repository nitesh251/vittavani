# Architecture

Vittavani uses a small modular monolith: a Next.js/TypeScript web client calls a Python/FastAPI service, which owns validation and persistence through SQLAlchemy. PostgreSQL is the intended shared database. SQLite is supported for lightweight local tests only.

## Backend boundaries

- `backend/app/main.py`: FastAPI application and HTTP routes.
- `backend/app/config.py`: environment-backed configuration.
- `backend/app/database.py`: SQLAlchemy engine and request-scoped sessions.
- `backend/app/models.py`: business-scoped catalogue and inventory persistence models.
- `backend/app/query_understanding.py`: pure deterministic multilingual intent and entity matching.
- `backend/app/query_service.py`: database-backed product lookup and answer construction.
- `backend/app/main.py`: bearer- or development-token-authenticated routes, membership-derived business context, onboarding, dashboard, and transactional inventory/sales/customer operations.
- `backend/app/auth.py`: Supabase access-token signature, issuer, audience, expiry, and subject verification against the configured project JWKS.
- `backend/app/ai_service.py`: optional Groq-backed structured query interpretation; provider output is validated and never supplies inventory facts or SQL.
- `backend/app/inventory_metrics.py`: shared tenant-scoped quantity aggregation and canonical low-stock rule used by inventory search and dashboard APIs.
- `backend/alembic/`: versioned database schema changes.

Every business-owned model carries a `business_id`; foreign keys and compound uniqueness constraints keep associations within a business. Database lookups must always include the authorized business scope. Supabase access tokens are verified independently by FastAPI, and `business_id` is resolved from `business_members`; browser-supplied tenant IDs are not authorization evidence. The explicit development-token path is accepted only when `APP_ENV=development`.

## Query path

Normal Search keeps the exact input, identifies read-only lookup intent, removes recognized command phrases before resolving a product, then matches active products in this order: canonical name, aliases, normalized exact name/alias, and fuzzy token similarity. Fuzzy ties return candidate names for clarification. Optional AI mode uses Groq only to extract a validated read intent and product wording before invoking that same lookup. Locations and quantities are read only from authorized database balances, never inferred from language-model output or fabricated.

Product/location creation, stock receipt/adjustment/transfer, sales, and customer ledger/payment operations use tenant-scoped validation and transactions. Memberships are unique per auth subject so onboarding retries return the existing workspace. Automatic transliteration, transaction reversals, team invitations, and complex roles are not available.

## Frontend

The public `/` route introduces the product; `/signup` and `/login` use Supabase Auth; `/onboarding` creates a workspace; `/dashboard` hosts the existing dashboard component. Middleware refreshes Supabase sessions and protects dashboard/onboarding routes. The dashboard retains database-derived catalogue/stock totals, low/out-of-stock alerts, location rollups, stock movements, customer accounts, and the right-column assistant. Browser speech recognition uses Hindi/Indian English modes when supported, with editable transcripts and typed fallback.

The same-origin Next.js API proxy forwards a Supabase access token from the server-managed session as a bearer token. In local development only, it can attach `X-Dev-Token` using server-side `DEV_API_TOKEN`. Do not use a `NEXT_PUBLIC_*` variable for this token; the backend's root `.env` remains authoritative for token validation.

The API proxy checks Fetch Metadata and frontend Origin for writes. Its local token fallback is limited to Next.js development; FastAPI separately rejects it outside `APP_ENV=development`. Production requires HTTPS, an exact configured frontend origin, verified Supabase identity, and membership before business data is returned.

## Deployment and security

Use PostgreSQL and Supabase Auth with an asymmetric signing key exposed through the trusted JWKS endpoint. Do not enable the development token in production. Configure database/API secrets through the hosting platform, restrict CORS and proxy origin checks to the actual frontend origin, and use TLS. Schema changes are managed with Alembic, not `create_all()`. Live provider, PostgreSQL, backup/recovery, rate-limit, and deployment verification remain pending; see `IMPLEMENTATION_STATUS.md`.
