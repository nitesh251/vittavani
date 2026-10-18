# Implementation status

Status reflects code in this repository; “implemented” does not imply production security or deployment.

## Implemented and tested

- **Repository assessment and milestones:** the starting repository contained only the product prompt; architecture, plan, and status are documented.
- **Backend foundation:** FastAPI app, health endpoint, SQLAlchemy engine/session setup, PostgreSQL URL configuration, and an initial Alembic migration are present.
- **Inventory schema foundation:** business, membership, nested location, product, alias, per-location balance, and append-only movement tables are modeled with business-scoped foreign keys and constraints.
- **Read-only multilingual lookup foundation:** Hindi/English/Hinglish phrase detection, Unicode normalization, aliases, fuzzy matching, ambiguity handling, and real database-backed location/quantity responses are implemented.
- **Inventory API:** development-only product/location creation and reads, product edits, stock receipts, positive/negative stock adjustments, and atomic stock transfers are implemented. Inventory writes validate tenant-owned products/locations and units, lock the product and balance rows, persist balances and movement records in one transaction, and reject negative stock.
- **Lookup regression tests:** equivalent supported English, Hinglish, and Devanagari alias queries; ambiguity, unknown product, missing location, multi-location stock, and empty input are covered.
- **Inventory regression tests:** product create/edit and tenant-scoped reads, location hierarchy reads, stock receipt/adjustments/transfers, movement history, invalid quantity/unit/location/tenant rejection, unit-change protection, forced transaction rollback, and exact quantity formatting are covered using SQLite.
- **Dashboard:** tenant-scoped aggregates, low/out-of-stock counts, per-unit and per-location stock (without converting unlike units), low-stock alerts, and recent stock movement data are served from inventory records; unsupported sales and customer-credit metrics are omitted.
- **Development UI:** responsive dashboard and inventory management forms for product creation/editing, receipts, adjustments, transfers, and location creation; successful mutations refresh the dashboard and inventory from the API. Existing text-query and voice flows remain available; browser speech recognition has language choices, transcript editing, listening/error/unsupported handling, and typed fallback. Optional answer speech includes a saved preference, unsupported-browser explanation, and stop control.
- **Server-side API proxy:** the Next.js same-origin API route attaches the development token server-side; the token is not embedded in or sent by the browser bundle.
- **Development authentication configuration:** the proxy reads only server-side `DEV_API_TOKEN`, which must match the root `.env` token; the backend still enforces `X-Dev-Token`. Do not use the browser-public `NEXT_PUBLIC_*` prefix for credentials.
- **Inventory browsing:** product search covers canonical names, aliases, and SKUs; stock status and sort filters are available. Locations display hierarchy paths and unit-grouped stock, and stock history displays tenant-scoped locations, movement notes, timestamps, and actual records.
- **Product stock status:** the product API calculates `in_stock`, `low_stock`, `out_of_stock`, or `inactive` using the backend's configured low-stock rule; the UI filters and labels products from that API result.
- **Assistant modes:** Normal Search uses the deterministic database lookup. Optional Groq mode interprets a query into a validated read intent and product name before using the same database lookup; no LLM-supplied quantity, location, or SQL is trusted. AI status/configuration failures are surfaced with Normal Search as the fallback.
- **Quantity display:** shared Decimal formatting avoids exponent notation, redundant trailing zeroes, and floating-point conversion; APIs provide formatted unit labels with Indian digit grouping, and the UI displays those labels consistently.
- Backend quantity-formatting and API label fields have regression coverage. Low-stock alerts are separate from out-of-stock counts and do not include zero balances.
- **Dashboard tests:** tenant-scoped inventory totals, mixed-unit grouping without combining incompatible quantities, low-stock alerts, recent movements, empty-business result, and omission of unsupported sales/credit metrics are covered.
- **Authentication and assistant tests:** API requests reject missing and invalid development tokens; Normal Search uses the saved Hindi alias and persisted test balances; AI mode uses a mocked interpretation against database facts, reports missing configuration without disabling Normal Search, and rejects malformed provider JSON.
- **Browser smoke checks:** headless Chromium verified dashboard real-data/error/empty states, Hindi/Hinglish lookup, editable mock-recognition transcript, unsupported/denied/empty recognition fallbacks, and optional spoken-answer controls. Real microphone hardware and speech-engine accuracy are not verified.

## Partially implemented

- **Tenant isolation:** schema and all API routes scope data by the business mapped to the development-only token. This is not user authentication, role-based authorization, or production-grade isolation.
- **Inventory concurrency:** product and existing balance rows are locked during stock mutations; unique business/product/location balance constraints handle competing first inserts. Live PostgreSQL and concurrent-worker behavior have not been verified.
- **Migrations:** an initial migration exists and can be run with Alembic; migration execution against a live PostgreSQL service has not been verified in this environment.
- **Local run/deploy setup:** Docker Compose and environment examples support local setup, but managed-service deployment is not performed or verified.

## Pending

- Supabase or equivalent authentication, per-user membership/roles, production bearer-token validation, CSRF/rate limiting, and cross-business API security tests.
- Damage/expiry, returns, low-stock alert lifecycle, and concurrency verification against PostgreSQL.
- Sales, idempotency, payments, customer credit ledger, suppliers, and purchases.
- Real microphone hardware, actual browser permission dialogs, and Hindi/Hinglish recognition accuracy across devices have not been verified.
- Onboarding, sales, customer udhaar, reports, product/location pagination, and exports.
- Mutation confirmations for AI-initiated stock writes (AI mode currently only handles read queries), command audit/retention controls.
- Private file storage, upload validation, data export/deletion workflows, backup/restore verification, CI, and end-to-end browser tests.
- Production frontend build/deployment and hosting-specific hardening.

## Persistence verification limits

The receipt and transfer write paths already used database transactions and movement rows; this task added the missing product-update and adjustment APIs and connected the frontend to real reads/writes. The regression suite verifies persisted balances and movements with isolated in-memory SQLite, including forced rollback. A separate disposable-SQLite smoke test exercised the same-origin Next.js proxy through a +5 receipt and -2 transfer (20 → 25 total; 23 at source and 2 at destination), and confirmed the development token was absent from rendered HTML. PostgreSQL persistence against the supplied Amul Butter/Shelf 2 records was not manually verified: no configured local database credentials or running local database service were available during this task. No demo seed, database reset, migration, or volume operation was performed. Use the local PostgreSQL database containing the stated records before running the requested manual check.

## Security limitations

All non-health API routes require the explicit development token in the `X-Dev-Token` header and are rejected unless `APP_ENV=development`. This token is a single-business local-development convenience only; it must not be used for production. Query resolution uses saved product aliases rather than a general Hindi transliteration engine. No user authentication, role system, CSRF protection, rate limiting, or production CORS policy is delivered yet. Do not expose this app to production traffic until these controls and tenant-isolation tests are implemented.

## Environment and local commands

Copy `.env.example` to `.env`, then run `docker compose up -d db`, `cd backend && python -m venv .venv && . .venv/bin/activate && pip install -e '.[dev]'`, `alembic upgrade head`, and `python -m app.seed_demo`. Start the API with `uvicorn app.main:app --reload` from `backend/`; start the web app with `cd frontend && npm install && npm run dev`. Run backend tests from `backend/` using `pytest`.

Backend defaults and optional AI setting names are documented in `.env.example`; the frontend API URL and matching server-side development token belong in ignored `frontend/.env.local`. For PowerShell restart steps and Groq setup, see the README. The frontend proxy requires `DEV_API_TOKEN`; never put real secrets in source control or browser-accessible `NEXT_PUBLIC_*` variables.
