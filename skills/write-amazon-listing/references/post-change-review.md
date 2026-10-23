# Listing post-change review

Use for read-only follow-up, not another rewrite. Answer what changed, whether shoppers can see it, what comparable evidence says, and whether to keep observing or propose a revision.

## Identify the change and its effective state

Reference the exact marketplace, child ASIN/variation, approved `listing_version_id`, changed fields, authorization and prior baseline. Preserve locks and fields outside scope. When project shared-data versioning exists, follow its contract and retain validated `inputBindings(id/version/sha256)`; do not silently replace invalid inputs or use an obsolete draft as the active baseline.

Record approval, submission, submission acceptance, Listings API readback, Catalog summary and rendered frontend separately, each with its actual observation time and matching field text/evidence. Acceptance or an API match does not prove frontend publication; an older summary does not invalidate newer approved text. Parent visibility does not prove every child updated. If frontend confirmation is unavailable, say so and do not claim the test period began at submission time.

## Comparable performance

Use before/after windows anchored to verified frontend effectiveness where available. Specify dates, marketplace timezone, ASIN/field scope, report generation time, attribution maturity and exclusions. Prefer comparable lengths, weekday/seasonal context and traffic sources; explain unresolved differences instead of forcing comparison. A partial or still-filling day is not a full-day baseline.

Choose metrics that answer the changed field's hypothesis. Keep sessions, page views, ordered units, sales and their conversion definitions separate. Overall business-report traffic has no impression denominator and cannot prove main-image CTR; advertising CTR describes the matching advertised ASIN/placement only. Missing data or a zero denominator yields unavailable, not zero effect. Distinguish market-wide query shares from own-account performance.

Record concurrent price/Coupon, ad bids/budgets/targeting, traffic mix, stock/Featured Offer, delivery promise, rating/review changes and other content edits that could explain movement. Set `CONFOUNDED_RISK` when co-occurring changes prevent isolating the copy effect. Before/after correlation alone is not causal attribution; do not assign all sales lift to a title edit. No universal minimum days/orders or automatic statistical significance: state the actual sample and whether it supports this decision. Do not launch A/B tests or create monitors without authorization.

## Decision and handoff

Return one compact row per reviewed change: version/fields, effective-state evidence, before/after window and metric definitions, comparison limits, recommendation and reason.

- `KEEP`: current evidence supports retaining the current content, or shows no material reason to revise; not proof that the change caused improvement.
- `OBSERVE`: propagation, sample, report maturity or comparability is insufficient; identify the missing evidence or next useful observation, without inventing a schedule.
- `REVIEW`: a supported contradiction, adverse signal or new hypothesis warrants a scoped proposed revision. State affected fields and evidence; retain the live version until separately authorized.

These are recommendations, not release readiness or mutation states. Do not automatically edit, publish, roll back, unlock copy or change advertising. A subsequent approved copy revision returns to the normal fact/policy/keyword and release checks and gets a new version. Merely reviewing performance does not create a new copy version.
