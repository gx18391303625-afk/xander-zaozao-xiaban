# Amazon Marketing Cloud analysis

Load this reference only when the question materially benefits from Amazon Marketing Cloud (AMC): path or time to conversion, exposure frequency, campaign/ad-product overlap, ordered touchpoints, new-to-brand journeys, or another aggregate user-path question that ordinary Ads reports cannot answer.

## Choose the smallest evidence source

- Use ordinary Ads API reports for routine campaign, target, search-term, placement, budget, bid, CPC, CVR and ACoS work. Do not add AMC merely to recreate an available operational report.
- Use Brand Analytics for marketplace query popularity, click/conversion shares and own-ASIN query maturity. Do not treat it as attributed ad performance.
- Use AMC when the decision depends on privacy-safe event sequences, unique reach, frequency, time lag, overlap, cross-campaign or cross-ad-product exposure, or attribution windows that require event-level joins before aggregation.

AMC availability is not a reason to delay a narrow review that does not need these questions. For a complete review that claims to answer journey, overlap, reach or frequency, missing relevant AMC evidence must remain a visible gap.

## Scope and evidence gates

- Bind the exact AMC instance, advertiser entity, marketplace, timezone and analysis window. Data-source visibility proves schema access, not that the account has rows for every ad product.
- Inspect the current data-source schema before writing SQL. Do not rely on remembered column names or assume a UI template and API table have identical fields.
- Keep Amazon's aggregation controls enabled. Query only the dimensions and metrics needed for the decision; never attempt to export or reconstruct user-level identifiers.
- Treat suppressed, thresholded, unavailable and empty results separately. None of them automatically means zero activity.
- Preserve native units. AMC Sponsored Ads spend can be returned in microcents; convert it explicitly and show the conversion rather than silently treating it as account currency.
- Label AMC results as first-party aggregate observational evidence. Path, overlap and attribution outputs do not by themselves prove incremental lift or causality; use a suitable experiment or holdout when the decision requires incrementality.

## Optional subscribed datasets

Inspect the live data-source catalog on every relevant refresh; a subscription label or an old source list is not proof that a dataset is currently queryable. When present:

- `amazon_retail_purchases` adds multi-year Amazon Retail purchase events scoped by the instance's advertiser-to-ASIN relationship. Keep these retail events distinct from ad-attributed conversions.
- `conversions_all` can include both ad-attributed and non-ad-attributed conversions. Do not sum it with another conversion table without checking row grain, scope and deduplication keys.
- `audience_segments_*`, their snapshot tables, and `segment_metadata` support aggregate in-market/lifestyle segment analysis. A segment relationship is not proof that advertising caused a purchase.

Use these sources for longer-horizon purchase behavior, ad-exposed versus non-ad-attributed comparison, and aggregate segment differences when those questions affect the decision. Do not force them into routine bid reviews, assume every tracked ASIN is covered, or interpret schema availability as nonempty data.

## Safe local route

For this workspace, use the local Amazon Ads MCP safety gateway rather than mounting Amazon's raw tool catalog:

1. Discover current AMC data sources or workflows with the allowlisted official-MCP read route.
2. Execute only an ad-hoc query or an existing workflow as an analysis job. Workflow creation/deletion, audience activation and new paid-feature subscriptions are separate capabilities and are not implied by an analysis request. Already-subscribed datasets may be read when they are present and relevant.
3. Poll the execution status, then use the bounded AMC result reader. It downloads only trusted Amazon result shards in memory, limits bytes and rows, and never returns or persists signed URLs.

Do not expose the raw AMC download-URL tool. Do not activate an AMC audience, add or change a data subscription, accept a charge, or change advertising merely because an analysis succeeded; each needs its own applicable authorization and evidence.

## Decision-oriented output

State the business question first, then the exact scope and query logic, coverage/threshold notes, result, and decision implication. Keep operational metrics, Brand Analytics shares and AMC path evidence in separate sections so their different attribution bases remain visible.

Useful reusable AMC questions include:

- Which campaign groups or ad products appear alone versus in combination before conversion?
- How long after the last or first measurable exposure do conversions occur?
- At what exposure-frequency bands do incremental conversions flatten or efficiency deteriorate?
- Which search terms, placements, ASINs or campaign groups participate in assisted paths rather than only last-touch paths?
- Are new-to-brand journeys materially different from repeat-buyer journeys?

Do not turn a descriptive pattern into an automatic bid, budget or audience change. Translate it into a proposed test or bounded optimization and apply the normal economics, authorization and live-state gates.
