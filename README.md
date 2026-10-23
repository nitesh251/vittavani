# Vittavani

Vittavani is a voice-first business assistant for Indian shopkeepers, retailers, wholesalers, and distributors. It helps owners find stock and product locations, record inventory changes and sales, track customer accounts, and ask questions in English, Hindi, or Hinglish. Vittavani is a product of Vinayaka Services.

The app combines a Next.js/TypeScript frontend, a FastAPI backend, SQLAlchemy, Alembic, and PostgreSQL. Supabase Auth provides owner identity; the existing PostgreSQL database remains the system of record for businesses and operations. Current implementation and verification limits are tracked in [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

## Features and delivery status

- **Available:** public home page; email signup/login; server-managed Supabase sessions; business-owner onboarding; protected dashboard; inventory, product aliases, location hierarchy, stock movements, sales, Customers & Accounts, customer ledger/payments, and Ask Vittavani.
- **Available:** deterministic database-backed Normal Search, supported business commands, optional Groq interpretation, and browser speech input when supported.
- **Not included:** billing, invitations/team administration, comprehensive Hindi grammar or speech accuracy guarantees, returns, transaction reversals, financial reports, private file uploads, and production hosting/operations.
- **Not yet externally verified:** login against a configured Supabase project, live PostgreSQL migration/persistence, and deployment. See status notes before production use.

## Architecture and repository map

```text
frontend/
  app/                    Next.js routes, layouts, global styles, and API proxy route
  components/             Existing dashboard UI and shared auth form
  lib/                    API proxy, quantity formatting, and Supabase clients
  tests/                  Node tests for API proxy and quantity utilities
backend/
  app/main.py             FastAPI endpoints and tenant-scoped business operations
  app/auth.py             Supabase JWKS access-token verification
  app/models.py           SQLAlchemy business, inventory, sales, and ledger models
  app/                    Query, command, AI, and transaction services
  alembic/                Additive schema migrations
  tests/                  Pytest API/query/auth regression tests
docs/                     Architecture, implementation plan, and status
docker-compose.yml        Loopback-only PostgreSQL 16 for local development
.env.example              Backend/local-development environment template
```

The browser talks to the same-origin Next.js API route. The Next.js server forwards either the authenticated Supabase access token or, only in local development, the development token. FastAPI independently verifies Supabase JWT signatures and derives `business_id` from `business_members`; API callers cannot select a tenant by supplying a business ID. The backend validates and commits business operations.

## Prerequisites

- Git.
- Python 3.12 or newer and pip.
- Node.js 20 or newer and npm.
- Docker Desktop with Docker Compose v2, for the local PostgreSQL service.
- A Supabase project for signup/login and authenticated workspaces. Supabase setup is not needed to use the explicit local development-token workflow.
- Any editor is suitable; Visual Studio Code and IntelliJ IDEA are optional.

PowerShell checks:

```powershell
git --version
py -3.12 --version
python -m pip --version
node --version
npm --version
docker --version
docker compose version
```

Installers: [Git](https://git-scm.com/downloads), [Python](https://www.python.org/downloads/), [Node.js](https://nodejs.org/en/download), [Docker Desktop](https://www.docker.com/products/docker-desktop/), [VS Code](https://code.visualstudio.com/), [IntelliJ IDEA](https://www.jetbrains.com/idea/).

## Clone and configure

```powershell
git clone https://github.com/nitesh251/vittavani.git
Set-Location .\vittavani
Copy-Item .env.example .env
```

Edit `.env` locally. Do not replace an existing `.env`; copy the example only when the file does not already exist. `.env` and `frontend/.env.local` are ignored by Git. Keep credentials out of source files, screenshots, logs, and browser-visible `NEXT_PUBLIC_*` variables, except for the intentionally public Supabase URL and publishable/anonymous key.

### Environment variables

| Variable | File | Required for | Notes |
| --- | --- | --- | --- |
| `APP_ENV` | repository `.env` | Backend | `development` enables the optional local token; use `production` in production. |
| `DATABASE_URL` | repository `.env` | Backend | SQLAlchemy URL. Example points to local Compose PostgreSQL. |
| `DEV_API_TOKEN` | both env files | Local bypass only | Use the same random local-only value in both files. Never expose with `NEXT_PUBLIC_`. Disabled by the backend outside development. |
| `DEV_BUSINESS_ID` | both env files | Local bypass only | UUID for the explicit development tenant; create its data with the optional seed command. Never used to assign new Supabase users. |
| `FRONTEND_ORIGIN` | both env files | API origin checks | Exact frontend origin, e.g. `http://localhost:3000`; set to the HTTPS production site in deployment. |
| `SUPABASE_URL` | repository `.env` | Backend authentication | Supabase project URL used to form the trusted JWT issuer and JWKS endpoint. |
| `NEXT_PUBLIC_SUPABASE_URL` | `frontend/.env.local` | Frontend auth | Public Supabase project URL; must match backend `SUPABASE_URL`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `frontend/.env.local` | Frontend auth | Public/publishable key from Supabase API settings. It is not a service-role key. |
| `NEXT_PUBLIC_API_URL` | `frontend/.env.local` | Frontend API | Backend base URL; local default is `http://localhost:8000`. |
| `AI_PROVIDER` | repository `.env` | Optional AI mode | Set to `groq` to enable the existing Groq adapter. |
| `AI_MODEL` | repository `.env` | Optional AI mode | Model supported by the configured Groq account. |
| `GROQ_API_KEY` | repository `.env` | Optional AI mode | Backend-only secret. |
| `AI_TIMEOUT_SECONDS` | repository `.env` | Optional AI mode | Defaults to 10 seconds; backend bounds it to 1–30 seconds. |
| `DEV_FRONTEND_ORIGINS` | `frontend/.env.local` | Optional local origin override | Comma-separated allowlist; defaults to localhost and 127.0.0.1 on port 3000 in development. |

The root `.env.example` is for FastAPI and local database settings. Copy `frontend/.env.local.example` to `frontend/.env.local` for Next.js. If using the local bypass, set matching `DEV_API_TOKEN` and `DEV_BUSINESS_ID` values in both files. Restart FastAPI or Next.js after changing its environment. Never configure a Supabase service-role key in the frontend; this application does not need one.

## Local database and backend

Start Docker Desktop, then from the repository root:

```powershell
docker compose up -d db
docker compose ps
docker compose exec db pg_isready -U vittavani -d vittavani
```

The Compose database is PostgreSQL 16, bound to `127.0.0.1:5432` with local trust authentication. This is for local development only; do not expose it to a network or reuse its trust settings in production.

In a new PowerShell terminal, from the repository root:

```powershell
Set-Location .\backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
python -m alembic upgrade head
```

Alembic applies the additive migrations to the configured database. The current head includes `0001_inventory`, `0002_customer_ledger`, and `0003_member_subject`; the last migration enforces one workspace membership per authenticated owner. Migrations change schema; they do not seed sample products.

Demo data is optional and is never created on startup. To create the sample business, only if `DEV_BUSINESS_ID` does not already exist:

```powershell
python -m app.seed_demo
```

The seed command works only in development and refuses to overwrite an existing configured business. It creates the sample location hierarchy and Amul Butter product for the local dev tenant.

Start FastAPI from `backend/`:

```powershell
python -m uvicorn app.main:app --reload
```

Expected local endpoints: health check `http://localhost:8000/health`; interactive API docs `http://localhost:8000/docs`; OpenAPI JSON `http://localhost:8000/openapi.json`. API settings read the repository-root `.env`.

## Supabase authentication and business setup

1. Create or select a Supabase project and copy its project URL and public/publishable API key from the Supabase project API settings.
2. Put the URL in backend `SUPABASE_URL` and frontend `NEXT_PUBLIC_SUPABASE_URL`; set `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `frontend/.env.local`. Configure the same site origin in both `FRONTEND_ORIGIN` values.
3. In Supabase **Authentication → Providers**, enable Email. Choose whether email confirmation is required for the project. With confirmation enabled, signup displays a confirmation message and the email link returns to `/auth/callback`, which establishes a session before onboarding. For production delivery, configure and verify a project email provider/SMTP sender in Supabase.
4. In Supabase **Authentication → URL Configuration**, set the local Site URL to `http://localhost:3000` and allow the redirect URL `http://localhost:3000/auth/callback`. The callback exchanges the confirmation code for a session before redirecting to onboarding. Add the actual HTTPS site and callback route in production.
5. Configure an asymmetric Supabase JWT signing key available through the project's JWKS endpoint. The backend verifies `exp`, `sub`, `iss`, and `aud` against the trusted issuer/JWKS using PyJWT; it does not accept decoded-but-unverified tokens. No signing secret is sent to the browser.
6. Restart FastAPI and Next.js. Open `/signup`, register, verify email if required, and create the business workspace. Login at `/login`; authenticated users can open `/dashboard`. Log Out ends the Supabase session.

Supabase dashboard steps are manual and require project-owner access. Local tokens remain an explicitly separate development-only option. If a user signs in without a business membership, the backend returns no tenant data and the dashboard directs them to onboarding. Repeated workspace creation by one auth subject returns its existing workspace; it does not assign the user to the demo business.

## Frontend

In another PowerShell terminal, from the repository root:

```powershell
Set-Location .\frontend
Copy-Item .env.local.example .env.local
```

Edit `.env.local` as described above, then install from the committed npm lockfile and run the development server:

```powershell
npm ci
npm run dev -- --hostname 127.0.0.1
```

Open `http://localhost:3000`. Routes:

- `/` — public home page.
- `/signup`, `/login` — public authentication pages.
- `/onboarding` — protected business workspace setup.
- `/dashboard` — protected original dashboard; its existing navigation sections remain on this route (for example `/dashboard#inventory`, `/dashboard#locations`, `/dashboard#customers`, `/dashboard#stock-movements`, and `/dashboard#ask`).
- `/api/v1/...` — same-origin server-side proxy to FastAPI.

The original dashboard component, KPI cards, Quick Actions, sidebar, hash navigation, responsive layout, and right-side Ask Vittavani panel are reused at `/dashboard`; the landing page does not duplicate the dashboard or assistant. For local dev-token use, `DEV_API_TOKEN` must match the backend setting. The browser never reads that token.

## Existing business workflows

- **Dashboard and inventory:** KPI values, products, aliases, balances, and stock activity are loaded from the authorized backend business. Product/location forms persist through FastAPI; inventory writes validate tenant ownership, units, balances, and stock before commit.
- **Locations:** nested storage locations and location-specific balances are available from the existing dashboard navigation.
- **Sales and Customers & Accounts:** customer search/create/edit, account balances, ledger history, credit-sale form, payments received, and persisted sales history are available in the existing customer screen.
- **Ask Vittavani:** Normal Search works without an LLM. Existing typed and browser speech inputs use the same query path; browser speech support varies. Optional Groq mode interprets input, while facts still come from authorized database queries. Supported operations are bounded by explicit command schemas and backend validation.
- **Limitations:** product/customer deletion, posted transaction reversals, ledger corrections, comprehensive Hindi parsing, and guaranteed browser speech recognition are not implemented. Missing or ambiguous data must be clarified rather than invented.

Voice input requires a supported browser with microphone permission; browser speech services may require internet access and can have variable Hindi/Hinglish accuracy. Text input remains available. AI mode requires `AI_PROVIDER=groq`, `AI_MODEL`, and `GROQ_API_KEY` in the backend environment; a missing key does not disable Normal Search.

## API overview

`GET /health` is public. All `/api/v1` business routes require a valid Supabase bearer access token plus a server-side business membership, except the local development-token path which is accepted only when `APP_ENV=development`. The browser does not supply a trusted `business_id`.

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/business` | Return the authenticated owner's business workspace. |
| `POST /api/v1/business` | Create an owner workspace; repeated requests return the existing workspace. Body: `{"name":"Shop name"}`. |
| `POST /api/v1/ask` | Run Normal Search or existing AI/command flow. |
| `GET /api/v1/dashboard` | Read business-scoped inventory dashboard aggregates. |
| `GET /api/v1/ai/status` | Read AI-provider availability. |
| `GET/POST /api/v1/products` | List or create products. |
| `PUT /api/v1/products/{product_id}` | Update a product in the authorized business. |
| `GET/POST /api/v1/locations` | List or create business locations. |
| `GET /api/v1/stock-movements` | Read business-scoped stock history. |
| `POST /api/v1/inventory/receipts` | Receive stock. |
| `POST /api/v1/inventory/adjustments` | Apply a signed stock adjustment. |
| `POST /api/v1/inventory/transfers` | Transfer stock between locations. |
| `GET/POST /api/v1/customers` | List or create customers. |
| `PUT /api/v1/customers/{customer_id}` | Update an authorized customer's details. |
| `GET /api/v1/customers/{customer_id}/ledger` | Read a customer ledger and balance. |
| `POST /api/v1/customers/{customer_id}/payments` | Record a payment; send an `Idempotency-Key`. |
| `GET/POST /api/v1/sales` | Read or record sales; mutation requests use an `Idempotency-Key`. |

FastAPI's interactive schema at `/docs` is the source of truth for complete request and response fields. Product and location identifiers in request bodies are validated against the authorized business. Existing API contracts are retained; onboarding adds only the `/api/v1/business` routes.

## Tests and quality checks

Run backend tests from `backend/`:

```powershell
python -m pytest
```

Run frontend checks from `frontend/`:

```powershell
npm test
npm run lint
npm run build
```

`npm test` runs the Node test suite (API-proxy security/origin behavior and exact decimal quantity utility checks). `npm run lint` is the repository's TypeScript `tsc --noEmit` check; there is no separate ESLint script or configured Playwright suite. `npm run build` runs the Next.js production build.

Validation in this implementation session: 83 backend tests passed; all 20 frontend tests passed; TypeScript check and production build passed; Alembic head applied successfully to a temporary SQLite database. The FastAPI test client emitted one upstream Starlette/httpx deprecation warning. No live PostgreSQL instance or configured Supabase project was available, so external email verification, live Supabase JWT/JWKS, production cookie behavior, PostgreSQL-specific concurrency, and deployment were not verified.

## Manual smoke-test checklist

1. Open `/` without a session; verify the public product information and signup/login links.
2. Configure Supabase, sign up, complete email verification if enabled, and create a named workspace.
3. Open `/dashboard` and refresh. It should remain accessible with the session; Log Out should end it and protected access should redirect to `/login`.
4. Confirm dashboard KPIs, Quick Actions, collapsible sidebar, and Ask panel remain in their existing layout. Test mobile width and navigation.
5. Try text queries such as `How much stock is left for Amul Butter?` and `Amul butter kahan rakha hai?` only if using the explicit demo seed. Verify responses reflect saved data rather than a hardcoded response.
6. Test voice input only in a browser that supports speech recognition and grant microphone permission; verify the transcript can be edited before asking.
7. Create/update products and locations, record a receipt or transfer, and verify balances and movement history after refresh.
8. Record a sale/payment and inspect Customers & Accounts ledger history. Verify persisted results after restarting services without deleting the database volume.
9. Create a second Supabase user and business. Verify it starts empty and cannot read or mutate the first business's product, location, sale, customer, or ledger data.
10. Configure Groq and AI mode separately; with no Groq settings, Normal Search should still work and AI mode should report unavailable.

## Troubleshooting

- **Docker unavailable:** start Docker Desktop and retry `docker compose up -d db`; use `docker compose ps` and `docker compose logs db` to diagnose.
- **Database connection refused:** check the container health with `docker compose exec db pg_isready -U vittavani -d vittavani`; confirm the backend `DATABASE_URL` matches the local database and port 5432 is free.
- **Migration error:** check the working directory is `backend/`, environment points to the intended database, and run `python -m alembic current` before changing schema. Do not drop tables or volumes to resolve migration errors.
- **Python import/dependency issue:** activate `backend/.venv`, then run `python -m pip install -e ".[dev]"`.
- **Frontend dependency/build issue:** run `npm ci` in `frontend/` and `npm run lint` to identify TypeScript errors. Do not delete or reset database state to fix a frontend issue.
- **Changed env values not applied:** stop and restart the affected FastAPI or Next.js process. Keep frontend public Supabase URL/key and backend `SUPABASE_URL` aligned.
- **Proxy returns 401/403:** verify the Supabase session, backend `SUPABASE_URL`, owner membership, exact `FRONTEND_ORIGIN`, and that production is not configured with the development token.
- **Signup/verification redirect fails:** check Supabase Email provider, confirmation policy, local Site URL, and allowed `/onboarding` redirect URL.
- **AI unavailable:** verify `AI_PROVIDER`, `AI_MODEL`, `GROQ_API_KEY` in the root `.env`; restart FastAPI. Do not put the key in frontend configuration.
- **Voice input unavailable:** use text input; check browser support and microphone permission. Speech recognition availability is browser/device dependent.
- **No inventory appears:** the demo seed is optional. Confirm the selected business has records; never seed a real or existing database without checking whether the configured business already exists.
- **A form reports an error:** inspect the FastAPI response in the browser network panel and FastAPI terminal. UI success is shown only after a successful backend response.
- **Port conflict:** stop the other service or configure a supported port and update the frontend API URL, Supabase redirect URL, and `FRONTEND_ORIGIN` consistently.

Avoid `docker compose down -v`: it permanently deletes the local PostgreSQL volume and all its data.

## Development workflow

- Add UI under `frontend/app` or reusable components under `frontend/components`; keep the existing dashboard component and API client boundaries intact.
- Add FastAPI routes in `backend/app/main.py` and put query/command behavior in the existing service modules. Use the authenticated business dependency; never accept caller-provided tenant identity.
- Change SQLAlchemy models in `backend/app/models.py`, create a new additive Alembic revision, inspect its SQL, then apply it with `python -m alembic upgrade head`.
- Add backend pytest coverage under `backend/tests/`; add frontend Node tests under `frontend/tests/`.
- Run backend tests, `npm test`, `npm run lint`, and `npm run build`; inspect `git diff` and `git status`.
- Keep `.env` and `frontend/.env.local` private. Example environment files must contain placeholders only.

## Production readiness

The repository does not deploy services. Production requires managed PostgreSQL, HTTPS frontend hosting, secret management, Supabase project configuration with an asymmetric JWT signing key/JWKS, exact CORS and frontend-origin configuration, reviewed Alembic rollout, backups and restore drills, monitoring, logging/alerting, and rate limiting. The development token/seed must not be enabled in production. Cookies are configured by the Supabase SSR integration for secure production transport; use HTTPS and verify hosting cookie/domain settings. Do not claim production readiness until live authentication, database migration, tenant isolation, and operational recovery have been verified.

No license is specified in this repository.
