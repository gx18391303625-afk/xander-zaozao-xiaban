# Input and evidence protocol

Use this protocol for any Amazon product. Do not bind it to one brand, product, marketplace, or category.

## Contents

1. Quick intake
2. Professional schema
3. Evidence levels
4. Scope and conflict rules
5. Readiness gate
6. Question policy
7. Upstream handoff compatibility

## Quick intake

Accept casual input, but normalize it into these fields before drafting:

```text
Target marketplace and category:
Output language:
Brand exactly as registered/packaged:
Core product keyword—what the item is:
Offer scope—model, variation, quantity, single/set, package contents:
Product facts—with units and whether each value is per unit or per set:
Primary selling points—and the facts that prove each one:
Traffic keywords—with priority, volume, and source when available:
Existing title, Item Highlight, bullets, Search Terms, and structured attributes (for rewrites, audits, or ST-only work):
Compliance, warnings, certifications, or test reports:
Competitor ASINs/URLs, target buyers, use cases, tone, and banned terms (optional):
```

The user's preferred four inputs—brand, product keyword, traffic keywords, and selling points—remain central, but marketplace/category and offer scope are also required to prevent policy and quantity errors.

If the user has no keyword data, record `no measured keyword data`. Do not relabel model suggestions as traffic keywords.

## Professional schema

Normalize complex projects into this structure. Natural-language input is acceptable; do not force the user to write YAML.

```yaml
contract_version: "1.0"
project_id: ""
selection_run_id: ""
candidate_id: ""
competitor_lock_run_id: ""
keyword_run_id: ""
listing_run_id: ""
listing_version_id: ""

marketplace: US
output_locale: en-US
category_path: ""
product_type: ""
media_product: false

brand:
  display_name: ""
  registration_or_packaging_match: confirmed|unconfirmed|not_applicable

core_product_keyword: ""

existing_listing:
  title: ""
  item_highlight: ""
  bullets: []
  search_terms: ""
  known_structured_attribute_terms: []

offer_scope:
  model: ""
  variation: ""
  quantity: ""
  set_or_single: ""
  package_contents: []

product_facts:
  - fact_id: F001
    attribute: ""
    value: ""
    unit: ""
    scope: per_unit|per_set|per_package|variation_specific|all_variations
    source: "file/page, URL, test report, label photo, or seller confirmation"
    evidence_ids: []
    evidence_type: TEST_REPORT|CERTIFICATE|MANUAL|PACKAGE|LABEL|ENGINEERING_SPEC|SELLER_CONFIRMATION|DERIVED|MARKET|UNKNOWN|CONFLICT
    evidence_level: E3|E2|E1|D|M|U|X  # legacy compatibility only
    risk_class: LOW|MEDIUM|HIGH
    research_status: VERIFIED|PARTIAL|PENDING|CONTRADICTED|UNKNOWN|NOT_APPLICABLE
    publication_status: COPY_RELEASED|FORMAL_CLAIM_RELEASED|HOLD_FEATURE|HOLD_CLAIM|WITHHELD|CONTRADICTED|NOT_APPLICABLE
    approved_wording: []
    forbidden_wording: []

selling_points:
  - proposition: ""
    supporting_fact_ids: []

traffic_keywords:
  - term: ""
    priority: high|medium|low
    search_volume: null
    conversion_data: null
    source: ""
    related_fact_ids: []

compatibility: []
materials_or_ingredients: []
dimensions_and_weight: []
performance_metrics: []
battery_or_power: []
age_or_user_restrictions: []
warnings: []
warranty: []
certifications_and_test_reports: []
regulated_claims: []

variation_fact_matrix: []

target_customer: []
use_cases: []
buyer_pain_points: []
competitors:
  - competitor_id: ""
    asin_or_url: ""
    marketplace: ""
    role: CORE_BENCHMARK|BOUNDARY_REFERENCE|DIFFERENTIATION_REFERENCE|KEYWORD_SOURCE_ONLY|CONTEXT_ONLY
    price_snapshot: null
    rating_snapshot: null
    ratings_count_snapshot: null
    observed_facts: []
    observed_review_themes: []

tone: "clear, specific, credible"
must_use_terms: []
avoid_terms: []
seller_constraints: []

operating_context: null  # when supplied, preserve the complete upstream envelope unchanged
operating_context_sha256: null  # required with operating_context; canonical upstream hash
change_control: null     # required only when the supplied envelope contains content_change_control
```

Activate conditional fields only when relevant. For example, do not ask every non-electrical product for battery information.

When the standard `listing_handoff.json` exists, its stable IDs, fact IDs, evidence IDs, competitor IDs, keyword IDs, roles, and eligibility flags are canonical. Do not generate replacements merely to fit this legacy schema.

The optional `operating_context` is also canonical. Preserve the whole envelope, including upstream `profit_objective / demand_calendar / seasonality_context / supply_routes / replenishment_policy`, plus `price_context / content_change_control / acknowledged_risks`; do not split or rename those objects. Treat them as operating context, not own-product evidence.

- `price_context.current_observed` requires an observation time and evidence IDs. Every future phase remains `PLANNED_UNVERIFIED`; a plan cannot prove the current price or current stage.
- `demand_calendar` holds the horizon and demand scenarios; `seasonality_context` is a sourced current-season observation; `current_stage` is the seller's evidenced operating stage. Listing preserves all three but does not merge them or infer one from another.
- `profit_objective.contribution_rate_basis` is the only canonical rate-basis field and must be `NET_SALES_REVENUE`; legacy `rate_basis` is read only for compatibility and is never written into a new release.
- `content_change_control` determines whether an existing field may be changed. It does not prove that the locked content is compliant, accurate, effective, or publish-ready.
- `acknowledged_risks[].does_not_change_evidence_or_publication_status` must remain `true`. Risk acceptance cannot release a held or contradicted fact.
- `reopen_conditions` trigger review only. A locked field changes only with a new `explicit_change_authorization` that names its exact scope.
- `operating_context_sha256` must match the canonical upstream hash and the actual envelope content. A matching `context_id` alone is insufficient; any legitimate context revision requires a new append-only snapshot and hash rather than silent mutation.

## Evidence levels

| Level | Meaning | Listing use |
|---|---|---|
| `E3` | Claim-matched test, certification, regulatory record, or formal third-party evidence | Allow sensitive claims only within the document's exact model, scope, date, and wording |
| `E2` | Manual, package, product label, engineering specification, or official brand document | Allow ordinary product facts; do not upgrade it into certification or independent testing |
| `E1` | Explicit seller confirmation | Allow ordinary facts; do not use alone to prove certification, medical effect, legal compliance, or absolute safety |
| `D` | Transparent mathematical or linguistic derivation from allowed facts | Allow exact unit conversions and non-misleading equivalents; keep source inputs traceable |
| `M` | Market material such as competitor pages, reviews, search suggestions, or third-party keyword data | Use for insight and prioritization only; never use it to prove the user's product |
| `U` | Unknown, absent, vague, or implied | Withhold |
| `X` | Conflicting, prohibited, or materially high-risk without adequate evidence | Block and explain |

Record both source and scope. A bare value is not enough.

The `E3/E2/E1/D/M/U/X` levels are a compatibility view for older or informal inputs. For a standard upstream handoff, preserve the original fields:

```text
evidence_type
risk_class
research_status
publication_status
```

Use these release rules:

- `COPY_RELEASED`: ordinary, scope-matched factual copy may be used.
- `FORMAL_CLAIM_RELEASED`: required for high-risk or formally reviewed wording, limited to its approved wording and scope.
- `NOT_APPLICABLE`: usable only when the record truly contains no product claim requiring publication permission; it never converts an unverified fact into a claim.
- `HOLD_FEATURE`, `HOLD_CLAIM`, `WITHHELD`, `CONTRADICTED`, `PENDING`, `UNKNOWN`, or any missing permission: do not publish the dependent wording.

High-risk includes certification, safety, medical or health effect, quantitative performance outside ordinary specifications, child suitability, environmental, legal/compliance, absolute, and comparative superiority claims. Seller confirmation alone does not release these claims.

## Scope and conflict rules

Apply these rules before writing:

- Bind every quantity, size, weight, capacity, runtime, material, compatibility statement, and package item to its scope.
- Do not turn a combined-set value into a per-unit value or vice versa.
- Do not add independent component capacities and present the sum as one battery or one unit. If a combined total helps the buyer, label the arithmetic and physical arrangement explicitly.
- Do not apply one variation's color, dimension, ingredient, power, or included accessory to all variations without confirmation.
- Treat input power, battery voltage, capacity, and energy as different attributes.
- Calculate energy only from confirmed values: `Wh = nominal volts × Ah`.
- Treat rounded conversions as derived values and preserve sensible precision.
- Do not infer a feature from a port, icon, illustration, or ambiguous translation.
- Do not infer package quantity from plural nouns or illustration count.
- Do not infer compatibility from visual similarity.
- Do not infer protection functions from a general safety warning.
- Do not infer a certification from an unidentifiable certificate stamp or logo.
- Keep both sides of a conflict and ask the user. Never choose the more marketable value.
- Treat competitor content as market evidence even when it describes an apparently identical factory product.
- Apply the same evidence gate to backend Search Terms. A keyword source proves search interest, not that the user's product has the named feature, audience suitability, compatibility, effect, certification, or use case.
- A market, keyword, competitor, review, or VOC record can prioritize a message but cannot be listed as the own-product Fact ID that authorizes the message.
- Preserve the original Fact ID and Evidence ID in every claim mapping. Do not cite only a filename when the upstream package has stable IDs.

## Readiness gate

### BLOCKED

Block a publish-ready result when any of these applies:

- marketplace or category is unknown;
- brand, product identity, actual offer quantity, or material variation is unclear;
- a core fact has conflicting sources;
- compatibility or included contents could cause a wrong purchase;
- the product may require a compliance boundary that cannot be determined;
- fewer than five distinct, truthful decision points exist and the user expects five bullets;
- the user requires an unsupported sensitive claim.

When blocked, return the evidence collected so far and up to five questions. If the user requests a concept draft, label it `NOT FOR PUBLICATION` and use no unsupported specifics.

### PROVISIONAL

Allow a conservative draft when core facts are sufficient but one or more optimization inputs are missing:

- measured keyword priority or volume;
- target buyer or use-case detail;
- competitor sample;
- nonessential performance data;
- live official policy access.

Omit unknown content. Do not use placeholders inside the Listing.

### READY

Use `READY` only when:

- core facts are consistent and scoped;
- sensitive claims have claim-matched evidence;
- current official marketplace/category rules are verified;
- the facts support the requested deliverable; require five distinct buyer-relevant points only when five bullets are requested;
- the final audit has no hard failure.
- every requested backend Search Terms field has a verified format and byte limit and passes relevance, redundancy, and prohibited-term checks.
- all stable upstream IDs are present and refer to the same product, marketplace, offer, and variation;
- every non-empty visible field has claim mappings to released own-product facts;
- every placed keyword complies with its upstream role and field-level eligibility flag.

## Question policy

- Ask no more than five questions at once.
- Order questions by misleading-purchase risk, compliance risk, conversion value, then SEO value.
- Ask only questions whose answers can materially change the copy.
- Do not re-ask a question the user already answered.
- When the user says `unknown`, omit the dependent claim and continue if safe.
- Explain the exact evidence needed for a withheld claim.
- Do not let optional competitor or keyword data block a conservative product-fact draft.

## Upstream handoff compatibility

The canonical Stage 2 package normally contains:

- `product`: verified facts, allowed claims, claim gates, and forbidden or unsupported claims;
- `competitor_set`: all retained ASINs grouped by role, with snapshot context;
- `keyword_library`: source-traceable keyword rows with role, intent, evidence, source ASINs, and separate field eligibility flags;
- `customer_and_competition`: VOC themes, buyer questions, differentiation observations, and gaps;
- `coverage`: source coverage, pagination, failed calls, truncation, and unresolved gaps.

Treat blanks honestly. A blank rating count is not zero; an unavailable SellerSprite field is not negative evidence; incomplete pagination is not full coverage. Copy readiness must not hide upstream coverage gaps.

If only the workbook mirror is available, reconstruct the same IDs and roles without changing their meaning. If both JSON and workbook exist and conflict, keep both values, mark the integrity status `PARTIAL` or `UNKNOWN`, and resolve before `READY`.
