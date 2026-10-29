# Vittavani chatbot scenario catalog

This catalog describes deterministic regression scenarios in `backend/tests/test_query_pipeline.py`. Passing a parser test means the utterance was classified and its fields extracted; it does not by itself prove a live speech transcript or a persisted business action. API scenarios use isolated test data and mocked AI interpretation where noted.

## Read-only business questions

| User question | Expected behavior | Coverage |
| --- | --- | --- |
| “How much stock do I have for Amul Butter?” / “अमूल बटर कितना बचा है?” | Resolve the saved product or Hindi alias and report the persisted total, unit, and recorded locations. | Normal Search and query-pipeline regression |
| “Where did I keep Amul Butter?” / “Where do we store Amul Butter?” | Return the recorded nested location path and its positive balance; do not invent a location. | Intent and database lookup regression |
| “Show me products running low.” | Report products at their configured minimum threshold; omit zero-stock products from this list. | Threshold and report regressions |
| “Which items are out of stock?” | Return active products whose total balance is zero, independently of their minimum-stock threshold. | Deterministic lookup and mocked-AI API route |
| “Where is Rice?” when the product has no location, or a misspelled/ambiguous name | Explain the missing match/location or ask the user to choose among candidates. | Clarification and ambiguity regressions |
| “What sold the most last week?” / “How can I improve sales?” | Use persisted sales facts where available; do not fabricate figures. Recommendations are clearly separated from verified facts. | Data-backed insight/advice regressions |

## Supported actions and safety checks

| User request | Expected behavior | Coverage |
| --- | --- | --- |
| “Receive 5 packets of Amul Butter at Shelf 2.” / “Add three packets of Amul Butter to stock at Shelf 2.” | Validate product, quantity, unit, and location; persist one receipt and movement. Repeating the same idempotency key must not duplicate it. | API persistence and idempotency regressions |
| “I sold one Amul Butter at Shelf 2.” / “5 Amul Butter bik gaya at Shelf 2.” | Use the saved price, reduce stock, and record one sale/movement. Reject insufficient stock without changing balances or history. | API persistence, rollback, and idempotency regressions |
| “Can I sell one HP Laptop?” / “What if I sold one HP Laptop?” | Treat hypothetical language as a question; make no inventory change. | Parser/action-like safety regression |
| “Ramesh ne 200 rupaye de diye.” / “रमेश ने २०० रुपये दे दिए।” | Parse the customer and payment amount; on the tested API path, reduce the persisted outstanding balance and return the new balance. | Parser regression; English/Hinglish payment and balance API regression |
| “How much does Ramesh owe me?” / “Ramesh ka kitna udhar pending hai?” | Resolve the named customer and return the ledger-backed outstanding balance. | Parser and ledger API regressions |
| “Add 3 packets of Missing Widget to stock.” | Ask whether to create the unknown product; do not create a product or movement automatically. | API no-mutation regression |
| “Delete Amul Butter.” | Explain that destructive deletion is not enabled; leave data unchanged. | API no-mutation regression |
| “Create product …” with required details missing, or an incomplete transfer | Ask for the missing details; do not guess. | Command and action clarification regressions |

The parser-only scenarios also cover “मैंने 3 कीबोर्ड खरीदे”, “Ramesh gave me ₹500”, and “Ramesh ka kitna udhar pending hai?” They verify extracted intent/entities/amounts, not that those exact phrasings were spoken or committed through a production AI provider.

## Known gaps and boundaries

- The catalog is representative, not exhaustive. Natural-language variation, regional vocabulary, noisy recognition, and complex multi-part requests need real anonymized examples.
- Voice-based supplier purchases/payables, expenses, damage/expiry, returns, taxes/discounts, and general-purpose reports are not verified as chatbot workflows. Existing API capabilities must not be mistaken for voice support.
- Browser speech recognition accuracy has not been tested with a physical microphone. Speech support depends on the device/browser; text input remains the fallback.
- Groq has not been called live. AI-mode route tests mock intent interpretation; they verify that answers come from the isolated database, not that a model understands every phrasing.
- Every mutating live test must use a disposable business/database and a unique idempotency key. Do not test mutations against a real business.

## What is needed for real-question testing

1. **Representative questions and expected outcomes:** anonymized verbatim utterances in Hindi, Hinglish, and English; expected answer or clarification; and whether a request is read-only or intentionally mutating. Include common misspellings, short follow-ups, units, customer names, and local shop terminology.
2. **Isolated test workspace:** a non-production authenticated user/business with known products, Hindi aliases, units, quantities, minimum-stock thresholds, nested locations, customers and ledger entries, plus enough sales history for the questions being tested. Provide expected facts so responses can be checked.
3. **Secure test configuration:** an isolated database and test Supabase project/account for authenticated flows. For live AI, set backend-only `AI_PROVIDER=groq`, `AI_MODEL`, and `GROQ_API_KEY` through the deployment's secret manager or local ignored environment file. Do not paste API keys, access tokens, customer phone numbers, or real business records into chat or source control.
4. **Mutation authorization:** explicit approval for each bounded mutation scenario, a disposable workspace snapshot/reset path, and permission to inspect balances and movement/ledger history before and after. Read-only questions do not need mutation approval.
5. **Speech testing (optional):** a supported Android browser/device, microphone permission, and consent to test speech input. Provide expected transcript text separately from the recognized transcript to distinguish speech-recognition errors from chatbot parsing errors.

Current configuration has no live Groq or Supabase credentials, so external-provider and hosted-auth tests remain blocked until the isolated setup above is supplied.
