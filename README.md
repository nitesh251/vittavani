# Vittavani

Vittavani is a voice-first business-assistant foundation for Indian small businesses, a product of Vinayaka Services. The current implementation provides a FastAPI inventory data foundation, deterministic multilingual read-only product lookup, and a small Next.js text-query interface. It is not yet a production-ready SaaS; see [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) before deployment.

## Requirements

- Python 3.12+
- Node.js 20+
- Docker Compose (for local PostgreSQL)

## Local development

1. Copy `.env.example` to `.env`. Change `DEV_API_TOKEN` to a long random local-only value. Keep `.env` untracked. The configured business ID selects the single development tenant.
2. Start the local database: `docker compose up -d db`.
3. Install the backend: `cd backend && python -m venv .venv && . .venv/bin/activate && pip install -e '.[dev]'`.
4. Apply migrations: `alembic upgrade head` from `backend/`.
5. Create the optional sample data explicitly: `python -m app.seed_demo` from `backend/`. This command refuses non-development mode or an already existing configured business.
6. Start the API: `uvicorn app.main:app --reload` from `backend/`.
7. Configure the web app's local API token in the frontend environment. For local-only testing create `frontend/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:8000` and `NEXT_PUBLIC_DEV_API_TOKEN` set to the same value as `DEV_API_TOKEN`. This exposes a development-only token in the browser and must never be used for production.
8. Install and start the frontend: `npm install && npm run dev` from `frontend/`.
9. Open `http://localhost:3000`. Health check: `http://localhost:8000/health`.

Run backend tests using `pytest` from `backend/`. Check frontend types with `npm run lint` and make a production build with `npm run build` from `frontend/`.

The demo seed is optional and does not run on app startup. To reset local development data, stop the database and remove its volume with `docker compose down -v`; this deletes local database contents.

## Environment

See `.env.example` for backend defaults. `APP_ENV`, `DATABASE_URL`, `DEV_API_TOKEN`, `DEV_BUSINESS_ID`, and `FRONTEND_ORIGIN` are backend settings. The frontend reads `NEXT_PUBLIC_API_URL` and, in this development-only prototype, `NEXT_PUBLIC_DEV_API_TOKEN` from `frontend/.env.local`. Never place production secrets in `NEXT_PUBLIC_*` variables.

## Deployment and operations

No service is deployed by this repository. For production, provision PostgreSQL and hosting separately, configure TLS and secret variables in the hosting provider, and replace the local token with a maintained authentication provider and server-side JWT verification before exposing tenant data. Do not deploy the development seed, client-visible development token, or current API as a production multi-user service.

Backup, restore, storage, managed authentication, and production deployment procedures remain pending; see the implementation status. Do not assume provider pricing or free-tier limits—verify them before provisioning resources.

## License

No license is specified in this repository.
