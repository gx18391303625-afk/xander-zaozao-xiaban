# Keyword share and link maturity

Read this reference when the user asks whether promotion is establishing a product on important search queries, when a comprehensive advertising review needs organic-plus-paid search context, or when Brand Analytics Search Terms/Search Query Performance evidence is available. It applies to both new-product and existing-product modes.

## Use the two Amazon datasets for different questions

`GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT` is the primary own-link maturity source. For the exact marketplace, ASIN and period, retain the query volume and the ASIN's impression, click, cart-add and purchase counts/shares. It answers whether the product is being shown, attracting clicks and earning purchases on each query.

`GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT` is the market-leader context. Retain every returned top-three row for a relevant search term: `searchFrequencyRank`, `clickedAsin`, `clickShareRank`, `clickShare` and `conversionShare`. It answers which ASINs currently concentrate clicks and conversions. An own ASIN that is absent from the top three is `NOT_IN_REPORTED_TOP_THREE`, not zero market share.

Do not equate `searchQueryScore` with `searchFrequencyRank`, or either field with monthly query volume. Do not replace a missing Amazon report with SellerSprite estimates or a partial screenshot. A screenshot can support only the rows and columns actually visible.

## Acquisition and coverage

Prefer compatible first-party reports. Discover the current environment's connector/API, exports and dashboard access rather than assuming a particular tool is installed. When available, connector capabilities may include:

- `spapi_brand_analytics_report_create` for only the Search Terms and Search Query Performance report types;
- `spapi_brand_analytics_report_result` for status plus filtered, normalized rows;
- `spapi_brand_analytics_compare` for two completed same-type periods.

Creating one of these report jobs is an analysis action, not an advertising-account mutation. It does not authorize campaign, Listing, price or inventory changes. Search Terms is marketplace-wide and can be very large; provide exact relevant terms, a narrow `searchTermContains`, or clicked-ASIN filters before downloading. Preserve report IDs, marketplace, period, creation/completion times, filters, row counts, truncation and any unavailable fields.

Use comparable complete periods. Weekly periods are useful during launch; monthly periods reduce noise for strategic review. Do not compare incomplete current periods to complete prior periods without labeling the mismatch. Keep Amazon's source units unchanged and compute deltas separately.

## Own/competitor performance benchmarking

For exact-query CTR/CVR trends, estimated query purchases, or parent/child total-sales comparisons, use the installed `analyze-amazon-competitors` skill's [performance-benchmarking workflow](../../analyze-amazon-competitors/references/query-performance-benchmarking.md). It owns the cross-report formulas, source compatibility, variation coverage and chart contract; this Ads layer owns any subsequent advertising diagnosis or authorized change. Bind marketplace, product, query list and dates from the current task, not a prior product's saved example.

Keep actual ASIN clicks/impressions distinct from click share. Use directly available competitor counts before share-based inference; missing top-three/top-ten rows are unknown, not zero. Cross-report conversion/purchase estimates require scope checks and explicit estimate labels, and cannot stand in for actual Ads CVR in bid/CPC economics. Keyword purchase counts and parent total units belong to separate comparisons; neither can be divided by the other's clicks. A later report retrieval date must not be relabeled as its covered period.

## Required query-level diagnostic

For each in-scope core query, report when available:

```text
query
query role and product-fit gate
period and marketplace
Amazon query volume
own ASIN impression share
own ASIN click share
own ASIN cart-add share
own ASIN purchase share
top-three clicked ASINs and their click/conversion shares
Ads impressions, clicks, spend, orders, attributed sales, CPC, CVR and ACoS
organic rank or total-sales context when source-compatible
material price, promotion, Listing, rating/review, inventory and ad changes
maturity diagnosis
evidence gaps
```

Keep Ads rows and Brand Analytics rows separate before joining on normalized query, exact marketplace and compatible period. Ad-attributed orders are not the same population as Brand Analytics purchase share. Do not sum or reconcile them as if they were identical.

For placement, rank, same-screen or product-page comparisons, also use [placement-and-competitor-cross-diagnosis.md](placement-and-competitor-cross-diagnosis.md). A prior completed SQP period remains a baseline, not post-change evidence; a later frontend snapshot is a separate observation, not a backfill of that period. Missing query rows or incompatible brand/ASIN scope must not be converted into zero own share or `NOT_ENTERED`.

## Diagnose the funnel directionally

Use stage labels as evidence summaries, not universal numeric thresholds:

- `NOT_ENTERED`: relevant demand exists but own impression share is absent or immaterial relative to the evidence quality.
- `DISCOVERABILITY_GAP`: impression coverage is the dominant weakness; first rule out eligibility, budget, bid and indexing constraints.
- `CLICK_COMPETITIVENESS_GAP`: impression share is established while click share materially lags; inspect main image, title, price, promotion, rating count, delivery and placement mix before raising bids.
- `CONVERSION_COMPETITIVENESS_GAP`: click share is established while cart-add or purchase share materially lags; inspect query intent, Listing/variation accuracy, offer and competitor conversion barriers.
- `EFFICIENT_CONVERSION_SIGNAL`: purchase share is directionally stronger than click share across sufficient comparable evidence; scaling still requires economics, attribution and inventory gates.
- `KEYWORD_POSITION_BUILDING`: impression, click and purchase shares improve across comparable periods without a conflicting deterioration in economics or offer state.
- `REPORTED_TOP_THREE`: the own ASIN appears among the Search Terms report's top-three clicked ASINs for the query.
- `STABLE_QUERY_POSITION`: own shares and reported position persist across enough comparable periods for the product's stage; do not infer permanence.
- `INSUFFICIENT_DATA`: coverage, period compatibility, sample size or attribution prevents a useful maturity conclusion.

Compare `purchase share - click share` and `click share - impression share` only as directional conversion/attraction signals. Do not treat these arithmetic differences as causal rates or incrementality.

For competing ASINs, `conversionShare > clickShare` can indicate stronger purchase capture than click capture; the reverse can indicate weaker conversion capture. Treat both as hypotheses until offer, pack, price, rating, availability and query fit are checked.

## Advertising decision boundary

Brand Analytics combines organic and paid search behavior. A share increase after an advertising change is correlation, not proof that the change caused the increase. Align it with Ads search-term/target reports, Business Reports, organic-rank evidence and the change timeline.

Use this layer to decide what problem to investigate and whether promotion is building query position. Do not use it alone to set bids, increase budgets, negate a query, claim organic ranking gains, or calculate incrementality. Those actions still require query-level Ads evidence, economics and current account state.

For a comprehensive review, include this query-share layer when compatible first-party data is accessible. If the reports are unavailable, keep advertising findings usable but mark the maturity module `UNAVAILABLE` or `PARTIAL` with the exact report/coverage reason; do not describe keyword ownership as fully assessed.
