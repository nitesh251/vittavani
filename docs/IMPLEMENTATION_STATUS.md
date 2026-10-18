# Implementation status

Status reflects code in this repository; “implemented” does not imply production security or deployment.

## Implemented and tested

- **Repository assessment and milestones:** the starting repository contained only the product prompt; architecture, plan, and status are documented.
- **Backend foundation:** FastAPI app, health endpoint, SQLAlchemy engine/session setup, PostgreSQL URL configuration, and an initial Alembic migration are present.
- **Inventory schema foundation:** business, membership, nested location, product, alias, per-location balance, and append-only movement tables are modeled with business-scoped foreign keys and constraints.
- **Read-only multilingual lookup foundation:** Hindi/English/Hinglish phrase detection, Unicode normalization, aliases, fuzzy matching, ambiguity handling, and real database-backed location/quantity responses are implemented.
- **Inventory API foundation:** development-only product/location creation, positive-quantity receipts, and atomic stock transfers with source row locking, per-location balances, and append-only movement records are implemented.
- **Lookup regression tests:** equivalent supported English, Hinglish, and Devanagari alias queries; ambiguity, unknown product, missing location, multi-location stock, and empty input are covered.
- **Inventory regression tests:** product/location creation, stock receipt, balanced transfer movements, insufficient-stock rollback, and caller-supplied tenant rejection are covered.
- **Development UI:** responsive text-query page and explicit development-only seeded data command are included.

## Partially implemented

- **Tenant isolation:** schema and all API routes scope data by the business mapped to the development-only token. This is not user authentication, role-based authorization, or production-grade isolation.
- **Inventory concurrency:** PostgreSQL row locks and uniqueness constraints protect existing balance updates and transfers; live PostgreSQL/concurrent-worker behavior has not been verified.
- **Migrations:** an initial migration exists and can be run with Alembic; migration execution against a live PostgreSQL service has not been verified in this environment.
- **Local run/deploy setup:** Docker Compose and environment examples support local setup, but managed-service deployment is not performed or verified.

## Pending

- Supabase or equivalent authentication, per-user membership/roles, production bearer-token validation, CSRF/rate limiting, and cross-business API security tests.
- Stock adjustment, damage/expiry, returns, low-stock alert lifecycle, inventory UI, and concurrency verification against PostgreSQL.
- Sales, idempotency, payments, customer credit ledger, suppliers, and purchases.
- Dashboard metrics, onboarding, full navigation/operational areas, reports, pagination, and exports.
- Browser speech recognition, transcript editing/confirmation, optional LLM adapter, and command audit/retention controls.
- Private file storage, upload validation, data export/deletion workflows, backup/restore verification, CI, and end-to-end browser tests.
- Production frontend build/deployment and hosting-specific hardening.

## Security limitations

All non-health API routes require the explicit development token in the `X-Dev-Token` header and are rejected unless `APP_ENV=development`. This token is a single-business local-development convenience only; it must not be used for production. Query resolution uses saved product aliases rather than a general Hindi transliteration engine. No user authentication, role system, CSRF protection, rate limiting, or production CORS policy is delivered yet. Do not expose this app to production traffic until these controls and tenant-isolation tests are implemented.

## Environment and local commands

Copy `.env.example` to `.env`, then run `docker compose up -d db`, `cd backend && python -m venv .venv && . .venv/bin/activate && pip install -e '.[dev]'`, `alembic upgrade head`, and `python -m app.seed_demo`. Start the API with `uvicorn app.main:app --reload` from `backend/`; start the web app with `cd frontend && npm install && npm run dev`. Run backend tests from `backend/` using `pytest`.

The frontend API URL, backend database URL, development token, business ID, environment mode, and allowed frontend origin are configured using `.env.example`. Never put real secrets in source control.
