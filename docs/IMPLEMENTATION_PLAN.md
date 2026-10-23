# Vittavani implementation plan

## Repository assessment

The repository initially contained only the supplied product prompt: no application code, dependencies, tests, or existing deployment configuration. The implementation therefore starts with a new, deliberately small foundation rather than replacing existing behavior.

## Milestones and acceptance criteria

1. **Assessment and planning** — inspect the starting repository and record architecture, milestones, and honest delivery status.
2. **Backend foundation** — provide a Python/FastAPI application, SQLAlchemy models, PostgreSQL configuration, Alembic migrations, and health check. Tenant ownership must be explicit in the schema.
3. **Inventory foundation** — model businesses, nested locations, products and aliases, independent location balances, and append-only stock movements.
4. **Multilingual lookup** — preserve original input; normalize Unicode and text safely; detect common Hindi, Hinglish, and English lookup intents; resolve canonical names and aliases deterministically; return ambiguity instead of guessing. Cover the pipeline with regression tests.
5. **Operations** — add safe stock receipt/transfer, transactional sales, payments, and ledger workflows with authorization and idempotency.
6. **User experience** — add responsive, accessible dashboard and operational flows, onboarding, and speech input with typed fallback.
7. **AI and voice** — add provider-independent structured intent extraction, confirmation for mutations, and audit logging.
8. **Suppliers and files** — add purchase receipts, private object storage, and validated file metadata.
9. **Production readiness** — implement authentication, tenant isolation tests, reports, CI, security controls, backups, and recovery procedures.
10. **Deployment** — document and verify local startup and production deployment.
11. **Dashboard and assistant refinement** — resolve the frontend/backend development-token configuration seam; expose real location and movement views, inventory filters, and explicit Normal Search / optional grounded AI modes. Acceptance requires authentication and API regressions, persisted-data display, and honest provider-unavailable behavior.
12. **Public identity and workspaces** — add public product/auth routes, Supabase SSR sessions, backend JWKS verification, owner onboarding, membership-derived tenant authorization, and an additive uniqueness migration. Preserve the existing dashboard component and development-only local token path.
13. **Developer guide and visual system** — document verified setup/configuration/testing and production limitations; centralize Midnight Navy/White/Teal tokens and apply them without changing dashboard information architecture.

## Acceptance criteria

- New code is runnable from documented local-development commands.
- Product lookups retain the original query and never select an arbitrary ambiguous match.
- Inventory quantities are location-specific and changes preserve movement history.
- Production endpoints cannot trust caller-provided business identifiers or expose unauthenticated tenant data.
- Tests substantiate every feature marked complete in `IMPLEMENTATION_STATUS.md`.
- Unimplemented or unverified requirements remain explicitly marked as pending.
- Supabase identity is independently verified by FastAPI; onboarding is idempotent, and protected data is selected only from the authenticated subject's membership.

## Delivery boundary

The repository now includes the original inventory/assistant workflows, customer ledger, public/auth routes, and a Supabase-backed authentication path. External Supabase configuration, live PostgreSQL verification, production operations, and unimplemented product areas remain explicit follow-up work in the status document.
