# Workflow and release contract

Use this contract when Stage 3 receives the standard output of product selection, competitor locking, and keyword-library work. It keeps one evidence chain from the original product candidate to the final Listing candidate. It is product-agnostic and marketplace-agnostic.

## 1. Canonical input

Prefer the upstream `listing_handoff.json` and its mirrored workbook sheet `12_文案交接`. Do not recollect the same SellerSprite or competitor data when the handoff is current and complete.

Preserve these identifiers exactly:

```text
project_id
selection_run_id
candidate_id
competitor_lock_run_id
keyword_run_id
```

When `operating_context` exists, also preserve `operating_context_sha256` exactly and verify it against the envelope's canonical JSON. The release's `upstream_snapshot` repeats both `operating_context_id` and `operating_context_sha256`.

Create, but never overwrite, these Stage 3 identifiers:

```text
listing_run_id
listing_version_id
```

If an upstream identifier is missing, record it as a gap. Do not invent a replacement that appears to preserve lineage. A changed product, offer scope, marketplace, or variation requires a new `listing_run_id`; a copy revision under the same evidence scope requires a new `listing_version_id`. A price or promotion state change by itself is an external Offer-context refresh, not permission or a requirement to rewrite locked copy; create a new Listing version only when a Listing field changes.

## 2. Three evidence lanes

Never merge the authority of these lanes:

| Lane | It may decide | It may not prove |
|---|---|---|
| Market and keyword evidence | Search language, demand vocabulary, keyword priority, intent, and candidate placement | That the sold product has an attribute, effect, audience suitability, compatibility, certification, or safety property |
| Competitor and VOC evidence | Buyer questions, comparison dimensions, common objections, information gaps, and differentiation opportunities | The user's product facts or a universal category truth |
| Own-product evidence | Product identity, offer scope, attributes, mechanisms, performance, contents, limitations, and publishable claims | Search demand or competitive superiority without matching market/comparative evidence |

A visible sentence is eligible only when its product claims are authorized by own-product evidence. Market and competitor evidence may explain why the sentence deserves space; they never upgrade claim permission.

## 3. Upstream role continuity

Consume keyword roles without silently relabeling them:

- `CORE_VERIFIED` and `SECONDARY_VERIFIED`: placement candidates, still governed by the per-row eligibility flags.
- `INDEXING_CANDIDATE`: backend Search Terms only when `listing_indexing_eligible=true`; never visible copy.
- `RELEVANT_NEEDS_VALIDATION`: research queue only.
- `LATER_STAGE_RELEVANT`: unavailable unless the current handoff explicitly sets `current_stage_eligible=true` and the relevant field eligibility flag.
- `MARKET_CONTEXT`, `HOLD_CLAIM`, `BRAND_IP_ISOLATED`, `WRONG_INTENT`, and `UNSUPPORTED`: never copy into Listing fields.

Keep the three eligibility decisions separate:

```text
listing_indexing_eligible
front_end_copy_eligible
downstream_review_eligible
```

Consume competitor roles as follows:

- `CORE_BENCHMARK`: primary comparison set for buyer questions and expected information.
- `BOUNDARY_REFERENCE`: shows price, rating-count, rating, specification, or offer boundaries; do not imitate it as the default target.
- `DIFFERENTIATION_REFERENCE`: supports a specific opportunity or gap after our matching fact is verified.
- `KEYWORD_SOURCE_ONLY`: contributes language only, never a comparison claim.
- `CONTEXT_ONLY`: market context only.

Preserve rating count, rating, price band, offer quantity, and variation scope where available. A high-review or differently priced product may be a boundary reference rather than an attainable core benchmark.

## 4. Copy plan before prose

Build and review a field-level copy plan before drafting. Each row must contain:

```text
plan_item_id
buyer_question
own_fact_ids
keyword_ids or keyword_family
competitor_context_ids and roles
target_field
message_scope_or_condition
prohibited_wording
decision: USE | HOLD | OMIT
```

The minimum decision chain is:

```text
buyer question -> own fact -> keyword family -> competitor context -> field -> prohibited wording
```

No `USE` row may lack an own-product fact for a product claim. A plan can intentionally leave a field empty when the schema does not support it or the evidence is insufficient.

## 5. Release package

Return one machine-readable `listing_release.json` in addition to the human-readable copy. The release object uses this shape:

```json
{
  "mode": "RELEASE",
  "contract_version": "1.0",
  "project_id": "...",
  "selection_run_id": "...",
  "candidate_id": "...",
  "competitor_lock_run_id": "...",
  "keyword_run_id": "...",
  "listing_run_id": "...",
  "listing_version_id": "...",
  "marketplace": "US",
  "output_locale": "en-US",
  "category_path": "...",
  "product_type": "...",
  "snapshot_at": "ISO-8601 timestamp",
  "operating_context": {"context_id": "CTX-..."},
  "operating_context_sha256": "sha256:<64 lowercase hex>",
  "upstream_snapshot": {
    "listing_handoff_path": "...",
    "received_at": "ISO-8601 timestamp",
    "integrity_status": "VERIFIED | PARTIAL | UNKNOWN",
    "operating_context_id": "CTX-...",
    "operating_context_sha256": "sha256:<64 lowercase hex>"
  },
  "product": {
    "verified_facts": [],
    "claim_gates": [],
    "forbidden_or_unsupported_claims": []
  },
  "competitor_set": {},
  "keyword_library": {},
  "policy_snapshot": {
    "verified": true,
    "verified_at": "ISO-8601 timestamp",
    "refresh_due_at": "optional ISO-8601 timestamp",
    "marketplace": "US",
    "product_type": "...",
    "sources": [],
    "field_rules": {}
  },
  "copy_plan": [],
  "listing_copy": {
    "title": "...",
    "item_highlight": "...",
    "bullets": [],
    "product_description": "",
    "search_terms": "..."
  },
  "claim_mappings": [],
  "keyword_placements": [],
  "withheld_items": [],
  "change_control": null,
  "promotion_handoff": null,
  "release_status": "READY | PROVISIONAL | BLOCKED",
  "release_notes": []
}
```

For a `READY` release, `claim_mappings` must cover every word of every non-empty visible field and Search Terms. A mapping's `exact_text` is a complete phrase in that field, with own-product `fact_ids` and their `evidence_ids`; a single mapped prefix never releases an unmapped suffix. For a high-risk fact, its mapping text must equal one complete `approved_wording` entry. Put ordinary adjacent wording in a separate mapping to its own released fact. Each Search Terms placement must equal its upstream keyword text and cite released own-product `fact_ids`; placements together must cover the entire backend value. A keyword's market evidence and eligibility never prove a product claim.

The mechanical audit takes the same release object as `release_package` and compares all copy fields after validating it. A caller-supplied `evidence_mapping_verified=true` alone can yield only a mechanical `WARN`, not full `PASS`. These structural checks cannot decide whether a source is genuine or whether a paraphrase faithfully states the cited fact; the seller must review that semantic and model/variation scope before publication.

For `READY`, the policy snapshot's marketplace and product type must exactly match the release. `verified_at` must be a valid timezone-aware timestamp and cannot be in the future. If a reviewer records `refresh_due_at`, it must be at or after `verified_at` and must not have passed when validating. A past deadline requires a new policy check before `READY`. There is no universal Amazon policy validity period: when no deadline is recorded, the script does not infer currentness from the age of `verified_at`; the release reviewer must still confirm current official rules and revisit them when the marketplace, Product Type Definition, or field policy changes.

### Claim mapping

Every non-empty visible field needs at least one claim mapping. Split a field into multiple mappings when it contains claims authorized by different facts.

```json
{
  "mapping_id": "CM001",
  "location": "title | item_highlight | bullet_1 | product_description",
  "exact_text": "exact substring from the field",
  "fact_ids": ["F001"],
  "evidence_ids": ["E001"],
  "risk_class": "LOW | MEDIUM | HIGH",
  "permission": "COPY_RELEASED | FORMAL_CLAIM_RELEASED"
}
```

### Keyword placement

```json
{
  "placement_id": "KP001",
  "keyword_id": "KW001",
  "term": "...",
  "location": "title | item_highlight | bullet_1 | product_description | search_terms",
  "exact_text": "exact substring or token represented in that field"
}
```

Preserve the canonical grouped `competitor_set` and `keyword_library` objects from Stage 2. A flat normalized array is accepted for independent or legacy jobs, but do not flatten the handoff if that would discard group, order, coverage, or source context. Keyword rows may use the canonical `keyword_original` and `library_role` field names; placements still reference the original `keyword_id`.

The package validator checks role, field eligibility, exact-text presence, fact permissions, high-risk release status, policy verification, and stable identifiers. It does not replace human policy, legal, or product review.

### Operating context and change control

Preserve the complete optional upstream `operating_context` envelope unchanged. This includes any existing `profit_objective / demand_calendar / seasonality_context / supply_routes / replenishment_policy`, together with `price_context / content_change_control / acknowledged_risks`. The release's `upstream_snapshot.operating_context_id` must match `operating_context.context_id`.

`change_control` copies the upstream decision fields and adds the baseline plus any new authorizations:

```json
{
  "decision_id": "...",
  "decided_at": "ISO-8601 timestamp",
  "copy_state": "OPEN | LOCKED | PARTIAL | UNKNOWN",
  "asset_state": "OPEN | LOCKED | PARTIAL | UNKNOWN",
  "operator_change_state": "OPEN | LOCKED | PARTIAL | UNKNOWN",
  "locked_scopes": [],
  "reopen_conditions": [],
  "baseline_listing_copy": {},
  "explicit_change_authorizations": [
    {
      "authorization_id": "...",
      "scopes": [],
      "authorized_at": "ISO-8601 timestamp",
      "source": "explicit user direction"
    }
  ]
}
```

- Copy scopes are `TITLE / ITEM_HIGHLIGHT / BULLETS / PRODUCT_DESCRIPTION / SEARCH_TERMS`; asset scopes are `IMAGES / A_PLUS`.
- A locked copy field must equal its baseline unless one explicit authorization names that scope. Image/A+ locks are references only; this Skill does not edit those assets.
- `reopen_conditions` cause another review, not a content change. Review and edit authorization remain separate.
- `release_status` remains the evidence/policy result. `operator_change_state` only reports whether changes are permitted; neither a lock nor an accepted risk upgrades release readiness.
- Planned prices stay `PLANNED_UNVERIFIED`. They are preserved for downstream context but never copied into `current_observed` or used alone for current-stage eligibility.

For `LATER_STAGE_RELEVANT.current_stage_eligible=true`, require `stage_eligibility_basis` with the matching current `stage_id`, `operating_context_id`, a timezone-aware `evaluated_at`, `basis_type=CURRENT_OBSERVED_STAGE`, and evidence IDs contained in `operating_context.current_stage.evidence_ids`.

## 6. Product Description

`product_description` is conditional. Include it only when the current Product Type Definition, listing editor, or applicable account schema exposes and needs the field. Keep it empty with a reason in `release_notes` when A+ replaces or suppresses the field, the schema omits it, or the user did not request it. This Skill does not create A+ Content.

## 7. Neutral downstream handoff

The release package may be handed to a later promotion-planning phase, but Stage 3 must not prescribe campaign structure, match type, bids, budgets, ACoS targets, launch manipulation, or review-generation tactics. It may hand off only neutral facts such as:

- released copy and field placement;
- approved and withheld keywords;
- claim and policy boundaries;
- competitor roles and evidence dates;
- product economics supplied upstream without interpreting them as ad decisions;
- unresolved gaps and refresh conditions.

When a machine-readable handoff is needed, use one optional `promotion_handoff` object that references rather than duplicates the envelope:

```json
{
  "handoff_type": "NEUTRAL_PROMOTION_INPUT",
  "operating_context_id": "...",
  "operating_context_sha256": "sha256:<64 lowercase hex>",
  "listing_release_ref": {
    "listing_run_id": "...",
    "listing_version_id": "...",
    "release_status": "READY | PROVISIONAL | BLOCKED",
    "snapshot_at": "ISO-8601 timestamp"
  },
  "change_control_decision_id": "...",
  "risk_acknowledgement_ids": [],
  "refresh_requirements": [],
  "user_business_constraints": []
}
```

`promotion_handoff` contains no campaigns, ad groups, match types, targets, negatives, bids, budgets, placement adjustments, ACoS/TACoS, or duplicated price values. Seller objectives remain labeled user constraints, not verified economics. A later advertising Skill must freshly verify live effective price, promotion, inventory, Featured Offer, advertising eligibility, placement scope and binding economics before calling a plan traffic-ready.

## 8. Refresh and version triggers

Create a new Listing version when copy changes. Re-open evidence and policy review when any of these changes:

- marketplace, category, Product Type Definition, or Amazon field policy;
- product model, variation, quantity, package contents, specification, warning, or compliance evidence;
- keyword snapshot, first-party query data, or competitor-lock snapshot materially changes;
- a claim gate is released, withdrawn, expired, or contradicted;
- return reasons, customer questions, or observed Listing performance justify a new hypothesis.

Never mutate an old release file and present it as the same reviewed version. A new keyword, policy, performance, risk or seasonal snapshot can trigger review while the user's content lock remains in force; review does not silently create a new copy version.
