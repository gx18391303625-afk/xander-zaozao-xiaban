# US seller SP account dailyBudget API

Official reference: [Profiles](https://advertising.amazon.com/API/docs/en-us/reference/2/profiles), [OpenAPI](https://d3a0d0y2hgofx6.cloudfront.net/en-us/profiles/3-0/openapi.yaml).

- `GET /v2/profiles/{profileId}` reads profile identity and `dailyBudget`.
- `PUT /v2/profiles` accepts an array containing only `{profileId, dailyBudget}`.
- Only seller Sponsored Products is supported. No campaign, bid, placement, SB/SD, portfolio or average-daily-budget feature flag is submitted.
- `xander_ads_account_budget` is read only. `ads.sp.account.budget` requires its own default-off switch and the existing prepare → approve → execute once → independent readback workflow.
- Verify the configured marketplace, currency, seller identity and profile before preparing. Missing amounts are unknown, never zero. Changed bindings/old values and unresolved writes block mutation. Unknown receipts and transport failures require reconciliation, not resubmission.

## Live verification and limits (2026-11-04)

- `dailyBudget=0` was explicitly rejected with `INVALID_ARGUMENT`, `Minimum daily budget is 1 USD`. This operation now rejects 0 locally. It does not offer a “remove cap” mode.
- An authorized USD1→USD2 write returned a success receipt; an independent console refresh showed the enabled account cap as USD2. The test was rolled back to USD1 on the console and independently refreshed. No other advertising setting was submitted.
- The Profiles GET endpoints (single and list) still returned USD1 while the console already showed USD2. A successful write with a different numeric readback is therefore `AWAITING_READBACK` (pending), not success and not permission to resend. Unresolved mutations remain locked pending reconciliation. There is no guaranteed propagation duration.
- The official schema identifies `dailyBudget` as writable but does not document how to remove the console account cap. The current Profiles, Account Budgets and Advertising Accounts contracts do not establish such a supported removal operation. Do not guess null/negative amounts or substitute a large cap for the original uncapped mode.
- Numeric `dailyBudget` is not proof of the console's selected budget mode. Missing values are not zero. USD1 is the tested minimum; writes are currently restricted to US/NA seller accounts rather than assuming other marketplaces use the same minimum.
- The daily 01:00–07:00 schedule cannot safely be migrated wholly to this API while “restore campaign-level budgets” lacks a verified endpoint. Keep that schedule on its existing browser route. The new API capability is a guarded positive-amount setter, not an Amazon-native dayparting or cap-removal feature.

## Tests

Synthetic fixtures cover exact minimal request fields, seller/profile/region binding, default-off switch, dry run, stale old values, changed bindings, invalid numbers, malformed receipts, unknown outcomes, unresolved-mutation blocking and no duplicate execution. These do not establish actual account eligibility or console mode behavior.
