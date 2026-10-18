# Vittavani

Vittavani is a voice-first business-assistant foundation for Indian small businesses, a product of Vinayaka Services. The current implementation provides a FastAPI inventory foundation, deterministic multilingual product lookup, a database-derived inventory dashboard, and browser voice controls with typed fallback. It is not yet a production-ready SaaS; see [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) before deployment.

## Requirements

- Python 3.12+
- Node.js 20+
- Docker Compose (for local PostgreSQL)

## Local development

1. Copy `.env.example` to `.env`. Change `DEV_API_TOKEN` to a long random local-only value. Keep `.env` untracked. The configured business ID selects the single development tenant. The Compose database uses passwordless trust authentication and is bound to loopback for local development only.
2. Start the local database: `docker compose up -d db`.
3. Install the backend: `cd backend && python -m venv .venv && . .venv/bin/activate && pip install -e '.[dev]'`.
4. Apply migrations: `alembic upgrade head` from `backend/`.
5. Create the optional sample data explicitly: `python -m app.seed_demo` from `backend/`. This command refuses non-development mode or an already existing configured business.
6. Start the API: `uvicorn app.main:app --reload` from `backend/`.
7. Configure the web app's local API connection in `frontend/.env.local`: set `NEXT_PUBLIC_API_URL=http://localhost:8000` and `DEV_API_TOKEN` to the same local-only value as the backend. `.env.local` is ignored by Git. A same-origin Next.js route attaches the token server-side during development; it is not sent in the browser bundle.
8. Install and start the frontend: `npm install && npm run dev` from `frontend/`.
9. Open `http://localhost:3000`. Health check: `http://localhost:8000/health`.

Run backend tests using `pytest` from `backend/`. Check frontend types with `npm run lint` and make a production build with `npm run build` from `frontend/`.

## Inventory workflows

The dashboard includes product creation/editing, storage-location creation, and stock receipt, adjustment, and transfer forms. Changes are sent to the FastAPI backend and the dashboard is refreshed from persisted API data after a successful write. Adjustments accept a signed quantity (negative reduces stock); the API rejects a balance below zero. Product units cannot be changed once inventory or movement history exists.

The corresponding development-token-protected endpoints are `GET /api/v1/products`, `GET /api/v1/locations`, `PUT /api/v1/products/{product_id}`, `POST /api/v1/inventory/receipts`, `POST /api/v1/inventory/adjustments`, and `POST /api/v1/inventory/transfers`. No schema migration is required for these operations. See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for test coverage and the limitation on live PostgreSQL verification.

The demo seed is optional and does not run on app startup. To reset local development data, stop the database and remove its volume with `docker compose down -v`; this deletes local database contents.

## Environment

See `.env.example` for backend defaults. `APP_ENV`, `DATABASE_URL`, `DEV_API_TOKEN`, `DEV_BUSINESS_ID`, and `FRONTEND_ORIGIN` are backend settings. The frontend reads the backend URL from `NEXT_PUBLIC_API_URL`; its same-origin route reads `DEV_API_TOKEN` server-side in development. Never place production secrets in `NEXT_PUBLIC_*` variables.

## Deployment and operations

No service is deployed by this repository. For production, provision PostgreSQL and hosting separately, configure TLS and secret variables in the hosting provider, and replace the local token with a maintained authentication provider and server-side JWT verification before exposing tenant data. Do not deploy the development seed, development token, or current API as a production multi-user service.

Backup, restore, storage, managed authentication, and production deployment procedures remain pending; see the implementation status. Do not assume provider pricing or free-tier limits—verify them before provisioning resources.

## License

No license is specified in this repository.
