# Hourly data and attribution review

Use this reference for current-day or recent 1–3 day Amazon advertising pacing questions, especially when the user asks whether exposure is lower, clicks are arriving more slowly, budget is burning too fast, or a recent account change caused a short-term movement.

Hourly evidence improves timing diagnosis. It does not replace complete-day Ads reports, search-term reports, Business Reports, or attribution maturity.

## 1. Confirm availability before interpreting data

Record the account, marketplace, analysis timezone, requested window, current local time, and exact `data_through` timestamp. Then verify separately:

- Amazon Marketing Stream subscription state and actual message coverage for each requested dataset;
- Rapid Retail Analytics subscription state and actual event coverage for the in-scope ASIN/SKU;
- daily Ads report and Business Report generation/attribution status;
- current live campaign, target, budget, bidding-strategy, and placement settings;
- current offer/listing state: child ASIN, price, Coupon/deal, rating, ratings count, Featured Offer/Buy Box, inventory, delivery promise, suppression, and variation availability.

An `ACTIVE` subscription proves routing is enabled, not that a requested hour contains data. Missing messages, an open hour, reporting delay, and a verified zero are different states. Use one of these labels rather than converting gaps to zero:

```text
ACTIVE_EMPTY
PARTIAL_HOUR
EXPECTED_DELAY
ATTRIBUTION_BACKFILL
VERIFIED_ZERO
COVERAGE_GAP
```

If the user requests “latest” data, refresh the live account and offer state in the current turn. Historical chat, saved plans, and old screenshots cannot override that read.

## 2. Keep source roles separate

Use each source only for the scope it actually proves:

- `sp-traffic`: own Sponsored Products hourly delivery. Use event time to examine impressions, clicks, cost, placement and available targeting dimensions. Do not call it Amazon-wide traffic.
- `sp-conversion`: own Sponsored Products attributed conversion events and later revisions. Treat recent orders/sales as provisional while the verified attribution window is open.
- `budget-usage`: budget-consumption threshold events. Use it to identify acceleration and likely exhaustion timing; it is not a direct email, phone, or chat alert unless a separate notification destination exists.
- RRA `DETAIL_PAGE_TRAFFIC_EVENT`: own retail detail-page traffic for the subscribed offer scope. It is not an advertising impression report.
- RRA sales and inventory events: own retail sales/inventory timing. Reconcile them with the exact ASIN/SKU and do not treat them as Ads-attributed orders.
- daily Ads reports: closed-day campaign, target, search-term, advertised-product and placement analysis. Continue using search-term reports for negative-keyword decisions; Marketing Stream does not remove that requirement.
- Business Reports: total sessions, units/orders and sales for TACoS and retail conversion context.

Do not sum Stream revisions or repeated budget threshold messages blindly. Deduplicate with the provider event/message identifier and preserve the latest revision semantics of the dataset.

## 3. Build one aligned timeline

Use the marketplace timezone for business interpretation and preserve UTC event timestamps in evidence. Align these events on one timeline:

1. live offer/listing changes;
2. campaign/ad-group/target bid, budget, state, negative and placement changes;
3. hourly impressions, clicks and cost;
4. budget-consumption thresholds;
5. attributed conversion events and revisions;
6. RRA detail-page traffic, retail sales and inventory events;
7. report-generation and attribution cutoffs.

For each manual or API change, record its exact applied timestamp and post-change readback. Compare like with like:

- same local-hour progression on prior comparable days;
- pre-change versus post-change hours without mixing the transition hour;
- complete days against complete days;
- promotion/price/inventory/rating context matched to each window.

Calendar-day totals at different collection times are not comparable. A partial morning should not be compared with a prior full day.

## 4. Diagnose at the right granularity

For a sales anomaly, jointly inspect advertising and the product offers within the requested scope. First split the same-hour retail change by child ASIN/colour where available; then check ad delivery, budget exhaustion and attribution backfill alongside Buy Box, availability, price/promotion and delivery. A normal offer does not prove normal ads, and exhausted budgets alone do not explain the full sales gap. Missing access remains an explicit gap; do not activate subscriptions or monitoring to fill it.

Start with the portfolio total, then drill down only where the loss or gain occurs:

```text
profile/account
campaign
ad group
target or keyword
placement
hour
advertised ASIN/SKU
```

For each layer retain impressions, clicks, spend, CTR and CPC. Add orders, units, sales, CVR and ACoS only with an explicit attribution status. Add sessions, total sales and TACoS only from compatible retail/Business Report evidence.

Diagnose in this order:

1. eligibility, inventory, Featured Offer, suppression and campaign/target state;
2. budget availability and hourly burn/exhaustion timing;
3. bids, dynamic-bidding strategy, placement adjustments and coverage;
4. impressions and impression velocity;
5. clicks, CTR and click velocity;
6. query/target relevance and search-term quality;
7. attributed conversion and retail conversion context;
8. CPC, ACoS, TACoS and contribution.

For a comprehensive existing-product review, still apply the placement completeness gate in [existing-product-optimization.md](existing-product-optimization.md). Every in-scope campaign must show current `TOP_OF_SEARCH`, `REST_OF_SEARCH`, and `PRODUCT_PAGES` adjustment values, placement performance, combined bid exposure, budget-exhaustion risk, and an explicit `KEEP`, `OBSERVE`, or `CHANGE_PROPOSAL` decision. Hourly totals do not excuse a missing placement percentage.

## 5. Interpret common short-window patterns

- Impressions slow while eligibility, inventory and budget remain healthy: inspect bid competitiveness, placement mix, target coverage, local-hour demand and recent negative/routing changes before changing CPC.
- Impressions hold but clicks slow: inspect CTR by placement/target and current offer competitiveness, including price, promotion, rating, ratings count and delivery promise.
- Clicks/spend accelerate without mature conversions: state the provisional loss exposure and wait for the verified attribution gate unless the approved learning-loss or cash boundary is already breached.
- Budget thresholds arrive earlier than comparable days: identify the campaign/placement/target driving spend before proposing a budget increase. More budget is not automatically the answer.
- RRA detail-page traffic drops with ad impressions: this supports a broader traffic/delivery issue for the own offer, but does not prove the market declined.
- Ad impressions hold while RRA retail traffic or conversion weakens: investigate offer, Listing, price, rating, inventory, delivery and traffic quality before raising bids.

Do not declare a CPC, placement or structural change causal when multiple delivery or conversion variables changed inside the same attribution window. Mark that comparison `CONFOUNDED_RISK` and state the earliest interpretable review point.

## 6. Output requirements

Lead with the observed change and its confidence. Include:

- exact window, timezone, `data_through`, source status and attribution maturity;
- current link/offer snapshot;
- portfolio and campaign-level pace comparison;
- placement percentages and performance when the review is described as comprehensive;
- budget-burn and exhaustion assessment;
- conversion and retail reconciliation status;
- search-term/negative findings from the applicable report rather than inferred from hourly aggregates;
- recommendation, expected observation, evidence gate, economics boundary and rollback condition;
- execution status separated from proposals.

If hourly data is incomplete, deliver the reliable findings and name the missing hour/source. Do not claim the review is complete or that traffic was zero.
