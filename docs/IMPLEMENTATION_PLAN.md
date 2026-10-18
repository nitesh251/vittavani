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

## Acceptance criteria

- New code is runnable from documented local-development commands.
- Product lookups retain the original query and never select an arbitrary ambiguous match.
- Inventory quantities are location-specific and changes preserve movement history.
- Production endpoints cannot trust caller-provided business identifiers or expose unauthenticated tenant data.
- Tests substantiate every feature marked complete in `IMPLEMENTATION_STATUS.md`.
- Unimplemented or unverified requirements remain explicitly marked as pending.

## Delivery boundary

This initial implementation establishes the data model, migration path, lookup pipeline, tests, and development UI. It does **not** claim to deliver a production SaaS: authentication/authorization, write workflows, reporting, speech handling, and deployment verification remain explicit follow-up work in the status document.
