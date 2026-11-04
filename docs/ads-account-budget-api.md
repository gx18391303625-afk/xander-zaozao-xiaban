# Seller SP account dailyBudget API

Official reference: [Profiles](https://advertising.amazon.com/API/docs/en-us/reference/2/profiles), [OpenAPI](https://d3a0d0y2hgofx6.cloudfront.net/en-us/profiles/3-0/openapi.yaml).

- `GET /v2/profiles/{profileId}` reads profile identity and `dailyBudget`.
- `PUT /v2/profiles` accepts an array containing only `{profileId, dailyBudget}`.
- Only seller Sponsored Products is supported. No campaign, bid, placement, SB/SD, portfolio or average-daily-budget feature flag is submitted.
- `xander_ads_account_budget` is read only. `ads.sp.account.budget` requires its own default-off switch and the existing prepare → approve → execute once → independent readback workflow.
- Verify the configured marketplace, currency, seller identity and profile before preparing. Missing amounts are unknown, never zero. Changed bindings/old values and unresolved writes block mutation. Unknown receipts and transport failures require reconciliation, not resubmission.

## Important verification boundary

The official schema identifies `dailyBudget` as writable but does not document a sentinel for removing the console's account budget cap. A read of `dailyBudget=1` alone does **not** prove whether “use campaign-level budgets” or “use daily budget cap” is selected. During an initial console round trip, the API still returned 1 after the console showed the campaign-level mode. This may reflect independent mode/value state or propagation delay; it is not evidence that 0 removes a cap.

Therefore the numeric 0 request is an explicitly warned verification candidate, not a proven “restore normal” operation. Do not migrate a live dayparting schedule to this API until both directions have been independently verified on the console. Do not infer removal from an HTTP success or numeric readback alone. The existing browser schedule remains the fallback pending that verification.

## Tests

Synthetic fixtures cover exact minimal request fields, seller/profile/region binding, default-off switch, dry run, stale old values, changed bindings, invalid numbers, malformed receipts, unknown outcomes, unresolved-mutation blocking and no duplicate execution. These do not establish actual account eligibility or console mode behavior.
