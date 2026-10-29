# Vittavani QA Test Report

**Updated:** 2026-10-27  
**Phase:** Focused and regression QA
**Repository:** `nitesh251/vittavani`

## Scope and report history

This report covers focused QA of Supabase authentication readiness, tenant isolation, Groq availability and failure handling, speech-input behavior, and the later frontend theme-consistency pass.

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

## Phase-three results

This phase covers the authenticated header color, login redirect/loading behavior, and conversational assistant routing and follow-ups.

| Area | Result | Evidence and limits |
| --- | --- | --- |
| Frontend regression tests | **Passed** | 40 Node tests passed, including auth error sanitization, redirect/loading safeguards, shared blue token usage, and per-user conversation IDs. |
| Frontend type check and production build | **Passed** | `npm run build` and `npm run lint` passed from `frontend/`. |
| Backend regression tests | **Passed** | 123 pytest tests passed, covering read-only general advice, data-grounded sales suggestions, persisted cash/credit-sale location follow-ups, expiry cleanup, and conversation-owner isolation. One existing Starlette/httpx deprecation warning remains. |
| Assistant clarification migration | **Passed locally** | Alembic upgraded a temporary SQLite database through `0005_assistant_conversations`; no hosted PostgreSQL migration was available in this phase. |
| AI provider behavior | **Partially verified** | Structured Groq requests and safe failures were tested with mocks. Live Groq was not configured; no live provider calls were made. |
| Supabase/browser integration | **Not run** | Hosted authentication and browser-based verification were unavailable. |
| Dependency audit | **Passed** | `npm ci` reported zero vulnerabilities; no dependencies were added. |
| GitHub Actions | **Pending** | Run `40532073717` was still in progress on the pre-change commit `b2a4c52`; it does not validate this phase's changes. |

## Phase-four results

This phase unified the shared public, authentication, onboarding, and authenticated-workspace color tokens and control states without changing page structure or application behavior.

| Area | Result | Evidence and limits |
| --- | --- | --- |
| Frontend regression tests | **Passed** | 43 Node tests passed, including global palette/alias, navy workspace header/sidebar, blue CTA, shared error states, and responsive/reduced-motion assertions. |
| TypeScript check and production build | **Passed** | `npm run lint` and `npm run build` passed from `frontend/`; all nine pages generated successfully. |
| Dependency audit | **Passed** | `npm ci` installed the existing lockfile dependencies and reported zero vulnerabilities; no dependency files changed. |
| Browser visual review | **Not performed** | This phase was validated with CSS and responsive-rule regression assertions; no authenticated desktop/mobile browser screenshot review was completed. |
| Backend regression tests | **Not rerun** | This phase changed frontend styling and frontend tests only. |
| GitHub Actions | **Pending** | Run `40543298250` was in progress on pre-change commit `b3d4f8c`; the job-log endpoint returned 404 while the run was active, so it does not validate this phase. |

## Phase-five results

This phase addressed public/auth theme inconsistencies by sharing the public footer, applying the palette to actual rendered homepage and auth surfaces, and aligning the dashboard footer treatment. The root causes were the inline homepage-only footer, no footer on Login/Signup, a separately light-styled dashboard footer, and public decorative color aliases that still resolved to purple/amber. Authentication logic, route destinations, and dashboard layout remain unchanged.

Files changed: `frontend/app/globals.css`, `frontend/app/page.tsx`, `frontend/components/auth-form.tsx`, new `frontend/components/public-footer.tsx`, `frontend/tests/global-theme.test.mjs`, and this report.

| Area | Result | Evidence and limits |
| --- | --- | --- |
| Shared header/footer components | **Passed** | Homepage and Login/Signup render the shared `PublicHeader`; homepage and both auth routes render the new `PublicFooter`. Footer links resolve to the homepage Features/FAQ anchors and `/login`. |
| Theme and layout regression tests | **Passed** | 44 frontend Node tests passed, including global tokens, public/auth component reuse, footer surfaces, primary action colors, mobile rules, and reduced motion. |
| TypeScript and production build | **Passed** | `npm run lint` and `npm run build` passed; all nine routes generated. |
| Public/auth browser review | **Passed** | Homepage, Login, and Signup were inspected at 390px and 1440px. The rendered document had no horizontal overflow; header CTA/auth submit computed to `rgb(3, 105, 161)`, and footer to Midnight Navy `rgb(20, 45, 78)`. The auth footer reached the bottom of the short desktop viewport. Homepage mobile navigation retained its links. |
| Authenticated dashboard browser review | **Blocked** | `/dashboard` redirected to Login without a Supabase session. The shared dashboard footer CSS was checked, but authenticated dashboard pages were not visually exercised. |
| Dependency audit | **Passed** | `npm ci` reported zero vulnerabilities; package manifests and lockfiles were not changed. |
| GitHub Actions | **Pending** | Run `40548846869` was in progress on the pre-change commit `ed11a19`; the active job-log endpoint returned 404, so it does not validate this phase. |

## Phase-six results

The shared public header was visibly white on the Homepage, Login, and Signup routes. This phase changes its rendered background to Midnight Navy, with high-contrast white branding, pale navigation links, cyan hover/focus accents, and the existing blue primary CTA retained. The existing responsive mobile-menu behavior and all destinations are unchanged.

| Area | Result | Evidence and limits |
| --- | --- | --- |
| Shared header regression tests | **Passed** | Tests assert the navy header surface, white brand, light links, cyan hover, white mobile-menu trigger, and the unchanged blue primary action. |
| Frontend tests | **Passed** | 44 Node tests passed. |
| TypeScript and production build | **Passed** | `npm run lint` and `npm run build` passed; all nine routes generated. |
| Browser verification | **Passed** | Homepage and Login were inspected at 390px/1440px; Signup at desktop. Computed header background was `rgb(20, 45, 78)`, brand white, navigation `rgb(224, 242, 254)`, and existing CTA `rgb(3, 105, 161)`. No horizontal overflow was observed. |
| Dependencies | **Passed** | `npm ci` used the existing lockfile and reported zero vulnerabilities; no dependency files changed. |

## Phase-seven results

This phase refined the shared public/auth header actions and added progressive scroll reveals to the public homepage. Public navigation, authentication routes and behavior, and the shared footer remain unchanged.

Files changed: `frontend/app/globals.css`, `frontend/app/page.tsx`, `frontend/components/public-header.tsx`, `frontend/components/public-footer.tsx`, new `frontend/components/public-scroll-reveals.tsx`, `frontend/tests/global-theme.test.mjs`, and this report.

| Area | Result | Evidence and limits |
| --- | --- | --- |
| Header action styles and destinations | **Passed** | “Log In” is outlined on the public homepage and Signup page; the Login-page “Create account,” homepage “Get Started,” and homepage/auth mobile account-creation actions retain the solid action-blue style. Existing `/login` and `/signup` destinations are unchanged. |
| Shared public/auth page appearance | **Passed** | Homepage, Login, and Signup were inspected at 390×844 and 1440×900. No horizontal overflow was observed. The header and shared footer both computed to Midnight Navy (`rgb(20, 45, 78)`); form content remained present at both sizes. |
| Mobile navigation | **Passed** | The homepage mobile menu opened with the existing section links, an outlined Log In action, and a solid Get Started action. Login and Signup render their appropriate Create account / Log in mobile actions. |
| Scroll reveals | **Passed** | A production browser check confirmed visible-by-default SSR content, viewport-triggered reveal, and one-time unobserve after reveal. Related feature cards use staggered delays up to 250 ms. Reveal activation is skipped for reduced-motion preference or unavailable IntersectionObserver; these fallback paths were covered by source-level regression assertions rather than browser preference emulation. |
| Frontend regression tests | **Passed** | 45 Node tests passed, including header style/destination assertions and reduced-motion/progressive-enhancement checks. |
| TypeScript and production build | **Passed** | `npm run lint` and `npm run build` passed; all nine routes generated. |
| Dependency audit | **Passed** | `npm ci` installed the existing lockfile and reported zero vulnerabilities; no dependency files changed. |
| GitHub Actions | **Pending** | Run `40568772066` was in progress on the pre-change commit `68a675e`; GitHub returned 404 for the active job logs, so it does not validate this phase. |

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

## Phase-eight results

This phase adds conversational chatbot scenario coverage and fixes deterministic query/action parsing for location questions, zero-stock reports, Hindi receipt/payment wording, and customer balance questions. The scenario catalog is in `docs/CHATBOT_SCENARIOS.md`.

| Area | Result | Evidence and limits |
| --- | --- | --- |
| Backend regression suite | **Passed** | 134 pytest tests passed after scenario changes. Coverage includes command extraction in English/Hindi/Hinglish, separate low/out-of-stock behavior, persisted receipt/sale/payment/ledger flows, clarification, idempotency, rollback, and no-mutation cases. One existing Starlette/httpx deprecation warning remains. |
| Frontend regression tests | **Passed** | 45 Node tests passed. |
| Frontend type check and production build | **Passed** | `npm run lint` and `npm run build` passed from `frontend/`; all nine routes generated. |
| AI out-of-stock routing | **Passed with mocked interpretation** | The AI-mode API route returns out-of-stock products from the isolated database; no provider call was made. |
| Live Groq and hosted Supabase | **Blocked** | `AI_PROVIDER`, `AI_MODEL`, `GROQ_API_KEY`, and hosted Supabase configuration are not available. No live credentials were requested or used. |
| Real-user question and speech coverage | **Pending** | See `docs/CHATBOT_SCENARIOS.md` for required anonymized utterances, expected answers, isolated test data, optional speech device setup, and mutation authorization. |

Commands: `cd backend && python -m pytest -q`; `cd frontend && npm test && npm run lint && npm run build`. Frontend dependencies were installed from the existing lockfile with `npm ci`; npm reported zero vulnerabilities.
