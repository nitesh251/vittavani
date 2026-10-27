# Vittavani QA Test Report

**Updated:** 2026-10-27  
**Phase:** Focused second-phase QA  
**Repository:** `nitesh251/vittavani`

## Scope and report history

This phase focused on Supabase authentication readiness, tenant isolation at the backend authorization boundary, Groq availability and failure handling, and speech-input behavior.

The requested prior `docs/QA_TEST_REPORT.md` was not present in the checkout when this phase began. The first-phase summary below is preserved from the earlier QA handoff; phase-two results were run in this checkout.

## First-phase QA summary

The earlier QA handoff reported:

- Backend: 114 tests passed; frontend: 34 tests passed.
- TypeScript checks, production build, fresh PostgreSQL 16 migrations, persisted API workflows, and desktop/mobile browser checks passed.
- Fixes were made for a missing browser icon and unclear receipt/sale quantity wording.
- Live Supabase authentication and Groq were not configured. Speech recognition was unsupported in that earlier browser environment.

These broad checks were not repeated in this focused phase.

## Phase-two results

| Area | Result | Evidence and limits |
| --- | --- | --- |
| Supabase project configuration | **Blocked** | `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` were unset; repository `.env` and `frontend/.env.local` were absent. No credential values were printed. |
| Hosted Supabase sign-up, confirmation, login, refresh, and logout | **Not run** | A real Supabase project and test account were unavailable. The local JWT tests below do not verify hosted Auth, email delivery, browser cookies, or project redirect settings. |
| JWT and tenant authorization | **Passed locally** | Exercised authenticated API requests with signed RS256 JWTs, a temporary local JWKS issuer, and an isolated PostgreSQL 16 database. The test ran with `APP_ENV=production` and without the development-token bypass. It created two workspaces and verified that an unauthenticated request was denied. |
| Cross-workspace reads and writes | **Passed locally** | Lists for products, locations, stock movements, sales, customers, and suppliers remained scoped to the authenticated workspace even when a foreign `business_id` query parameter was supplied. Foreign customer ledgers, supplier histories, product/customer updates, stock receipts, sales, supplier purchases, customer payments, and supplier payments were rejected. Follow-up reads confirmed inventory and customer/supplier balances were unchanged. |
| Groq live availability | **Blocked** | `AI_PROVIDER`, `AI_MODEL`, and `GROQ_API_KEY` were unset. No live Groq requests were made. |
| Groq/provider failure handling | **Passed with mocks** | Tests cover HTTP 401/403 authentication failures, model/request and rate-limit errors, timeouts, network errors, malformed JSON/structured content, empty bodies/choices, and sanitized failures. The unconfigured-provider API/UI reports that AI is unavailable and leaves Normal Search available. |
| Browser speech input | **Partially verified** | Chromium denied microphone access and the UI displayed the permission-specific fallback while keeping text input usable. A temporary in-page recognition stub delivered a transcript into the composer; removing both recognition APIs displayed the unsupported-browser notice. No physical microphone, actual speech recognition, or Hindi/English recognition quality was tested. |

### Commands and checks

From `backend/`:

```sh
pytest -q tests/test_auth.py tests/test_ai_service.py
```

**Result:** 24 passed. This includes the signed-token tenant-scope regression test and mocked HTTP 403, empty-response, and malformed-response coverage. Pytest emitted a Starlette deprecation warning about its `httpx` test client; there were no test failures.

```sh
pytest -q tests/test_query_pipeline.py -k 'test_ai_mode_reports_unconfigured_provider_without_affecting_normal_search or test_ai_provider_failure_returns_a_sanitized_upstream_error or test_ai_mode_uses_mocked_interpretation_and_database_facts or test_voice_command_sale_commits_stock_and_is_idempotent or test_voice_receipt_adds_stock_and_records_movement'
```

**Result:** 5 passed.

A separate, clean PostgreSQL 16 database was started for the tenant exercise. `python -m alembic upgrade head` applied all four migrations successfully. The cross-tenant API exercise used locally generated test signing keys and a temporary JWKS endpoint; it was not connected to Supabase.

Frontend dependencies were installed with `npm ci`; npm reported zero vulnerabilities. Frontend suites, TypeScript, and the production build were not rerun because no frontend source files changed in this phase.

## Manual checks required when service access is available

### Supabase authentication

Use a disposable Supabase project or test users. Follow the setup in `README.md`:

1. Configure backend `SUPABASE_URL` and frontend `NEXT_PUBLIC_SUPABASE_URL` plus `NEXT_PUBLIC_SUPABASE_ANON_KEY`; ensure both URLs match.
2. Configure the Supabase Email provider, test SMTP/email confirmation, Site URL, and `/auth/callback` redirect allowlist.
3. Sign up, follow the verification email when enabled, log in, reload the protected dashboard, and log out.
4. Repeat with two test users/workspaces. Attempt to access the other workspace’s records through the API and verify that no cross-workspace data or mutations are possible.

Do not put a Supabase service-role key in the frontend.

### Groq and assistant behavior

Configure `AI_PROVIDER=groq`, a supported `AI_MODEL`, and backend-only `GROQ_API_KEY`; do not expose the key through a `NEXT_PUBLIC_*` variable. Then, using a test business with known inventory, make at most these three requests:

1. English stock lookup: “How much stock is left for Amul Butter?”
2. Hindi/Hinglish lookup: “Amul butter ka stock kitna hai?”
3. Only if an isolated test product and location are available, a small stock receipt. Check the persisted balance and movement before and after the request.

Also confirm that Normal Search remains usable if the provider is unavailable. Do not use a production business for mutation checks.

### Speech input

On a supported Android browser, test Hindi/Hinglish and English input with microphone permission granted, then denied. Confirm that recognized words populate the composer, permission/no-speech/network errors are understandable, and typing still works. On a browser without `SpeechRecognition`/`webkitSpeechRecognition`, confirm that the unsupported notice appears and text input remains usable.

## CI status

GitHub Actions run `40465394011` was still in progress at the last check, on the pre-phase-two commit `2d201a9`. No completed CI result is available for this phase’s test-only commits and report.
