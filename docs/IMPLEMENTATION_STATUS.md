# Implementation status

Status reflects code in this repository; “implemented” does not imply production security or deployment.

## Implemented and tested

- **Repository assessment and milestones:** the starting repository contained only the product prompt; architecture, plan, and status are documented.
- **Backend foundation:** FastAPI app, health endpoint, SQLAlchemy engine/session setup, PostgreSQL URL configuration, and an initial Alembic migration are present.
- **Inventory schema foundation:** business, membership, nested location, product, alias, per-location balance, and append-only movement tables are modeled with business-scoped foreign keys and constraints.
- **Read-only multilingual lookup foundation:** Hindi/English/Hinglish phrase detection, Unicode normalization, aliases, fuzzy matching, ambiguity handling, and real database-backed location/quantity responses are implemented.
- **Lookup regression tests:** equivalent supported English, Hinglish, and Devanagari alias queries; ambiguity, unknown product, missing location, multi-location stock, and empty input are covered.
- **Development UI:** responsive text-query page and explicit development-only seeded data command are included.

## Partially implemented

- **Tenant isolation:** schema and lookup service scope data by business; the HTTP development token maps to one configured business. This is not user authentication, role-based authorization, or production-grade isolation.
- **Migrations:** an initial migration exists and can be run with Alembic; migration execution against a live PostgreSQL service has not been verified in this environment.
- **Local run/deploy setup:** Docker Compose and environment examples support local setup, but managed-service deployment is not performed or verified.

## Pending

- Supabase or equivalent authentication, per-user membership/roles, production bearer-token validation, CSRF/rate limiting, and cross-business API security tests.
- Product/location write APIs and UI, stock receipts/adjustments/transfers, concurrency controls/row locking, and low-stock alert lifecycle.
- Sales, idempotency, payments, customer credit ledger, suppliers, and purchases.
- Dashboard metrics, onboarding, full navigation/operational areas, reports, pagination, and exports.
- Browser speech recognition, transcript editing/confirmation, optional LLM adapter, and command audit/retention controls.
- Private file storage, upload validation, data export/deletion workflows, backup/restore verification, CI, and end-to-end browser tests.
- Production frontend build/deployment and hosting-specific hardening.

## Security limitations

All non-health API routes require the explicit development bearer token and are rejected unless `APP_ENV=development`. This token is a single-business local-development convenience only; it must not be used for production. No user authentication, role system, CSRF protection, rate limiting, or production CORS policy is delivered yet. Do not expose this app to production traffic until these controls and tenant-isolation tests are implemented.

## Environment and local commands

Copy `.env.example` to `.env`, then run `docker compose up -d db`, `cd backend && python -m venv .venv && . .venv/bin/activate && pip install -e '.[dev]'`, `alembic upgrade head`, and `python -m app.seed_demo`. Start the API with `uvicorn app.main:app --reload` from `backend/`; start the web app with `cd frontend && npm install && npm run dev`. Run backend tests from `backend/` using `pytest`.

The frontend API URL, backend database URL, development token, business ID, environment mode, and allowed frontend origin are configured using `.env.example`. Never put real secrets in source control.
