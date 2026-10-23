# Copy, keyword, and differentiation method

Use this method to optimize relevance and buyer clarity without relying on unverified claims about Amazon's private algorithms.

## Contents

1. Keyword evidence and clustering
2. Placement rules
3. Competitor analysis
4. Title method
5. Item Highlights method
6. Five-bullet method
7. Backend Search Terms method
8. Conversion and localization audit
9. Standard handoff roles and copy plan

## Keyword evidence and clustering

Record each term's source, relevance, data, supported fact, risk, and proposed placement.

| Group | Meaning | Primary use |
|---|---|---|
| `K1` | Exact product identity: what the item is | Title; choose one natural primary expression |
| `K2` | Decision attributes: quantity, material, size, compatibility, model, format | Title when decisive; otherwise the relevant bullet |
| `K3` | Function or problem-to-solve terms | Bullets supported by product facts |
| `K4` | Audience and use-case terms | Visible copy when decision-relevant; otherwise backend Search Terms when genuine, safe, and not redundant |
| `K5` | Synonyms, spelling, singular/plural, abbreviations, alternate names, and regional variants | Primarily backend Search Terms; use visibly only when natural and decision-relevant |
| `KX` | Irrelevant, trademarked, unsafe, misleading, or unsupported terms | Exclude |

Classify the evidence behind keyword importance:

- Search-query performance, advertising search-term reports, Brand Analytics, or reliable keyword-tool exports: measured input.
- Amazon autocomplete, search results, competitor language, and reviews: market observations.
- Model suggestions: hypotheses only.

Do not invent search volume, conversion rate, or keyword priority.

Normalize and cluster terms:

1. Normalize case, spaces, hyphens, singular/plural, and regional spelling.
2. Group terms with the same product intent.
3. Select one grammatically natural primary expression for each cluster.
4. Preserve distinct terms only when they represent a distinct buying intent.
5. Reject a high-volume term when it is weakly relevant or unsupported.

Never optimize for a keyword-density percentage. Natural repetition required by grammar is acceptable; mechanical repetition is not.

The `K1/K2/K3/K4/K5/KX` groups describe semantic intent only. They must not replace the role and eligibility assigned by the upstream keyword-library Skill.

## Placement rules

Prioritize in this order:

1. Put the exact product identity and highest-value supported decision attribute early in the title.
2. Give each bullet one primary cluster and, at most, one natural secondary cluster.
3. Use Item Highlights for a concise material or use-case detail when the field exists and the detail does not fit the title.
4. Reserve unrepresented synonyms and alternate names for backend Search Terms; do not turn the five bullets into a keyword list.

Require every attribute, function, audience, and use-case keyword to map to a permitted fact. A keyword is not permission to make the corresponding claim.

When upstream roles exist, apply these gates before placement:

| Upstream role | Visible fields | Backend Search Terms | Treatment |
|---|---|---|---|
| `CORE_VERIFIED` | Only when `front_end_copy_eligible=true` | Only when `listing_indexing_eligible=true` | Primary candidate, subject to natural language and claim evidence |
| `SECONDARY_VERIFIED` | Only when `front_end_copy_eligible=true` | Only when `listing_indexing_eligible=true` | Secondary candidate |
| `INDEXING_CANDIDATE` | Never | Only when `listing_indexing_eligible=true` | Backend-only candidate |
| `RELEVANT_NEEDS_VALIDATION` | Never | Never | Research queue |
| `LATER_STAGE_RELEVANT` | Only when `current_stage_eligible=true` and front-end eligible | Only when `current_stage_eligible=true` and indexing eligible | Explicit current-stage release required |
| `MARKET_CONTEXT` | Never | Never | Context only |
| `HOLD_CLAIM` | Never | Never | Await claim evidence or permission |
| `BRAND_IP_ISOLATED` | Never | Never | Isolate trademark/brand/IP terms |
| `WRONG_INTENT` | Never | Never | Exclude |
| `UNSUPPORTED` | Never | Never | Exclude |

`downstream_review_eligible=true` is only permission to pass a row for later review. It is not permission to place it in any Listing field.

Avoid constructions such as:

```text
Stainless Steel Water Bottle Insulated Bottle Drinking Bottle Sports Bottle
```

Prefer one clear identity followed by differentiating facts.

## Competitor analysis

Use the locked competitor set when supplied. Do not silently replace it with a new five-to-ten-ASIN sample. Compare products with similar use, price band, size/specification, offer quantity, rating, and rating-count barrier, while preserving the upstream role of each ASIN.

Build a private working matrix:

| Dimension | Our evidence | Competitor visible fact | Review/pain-point evidence | Status |
|---|---|---|---|---|
| Attribute or function | Fact ID and scope | Exact page observation | Sample theme, not a category fact | advantage / parity / disadvantage / unknown |

Apply these boundaries:

- Use competitor pages to identify market language, missing information, and buyer questions.
- Treat review complaints as sample themes, not universal truths.
- Never use a competitor page as evidence that the user's product has the same feature.
- Do not copy competitor sentences or distinctive creative expression.
- Do not place competitor brands, ASINs, or models into customer-facing copy or keywords.
- Mention compatibility with a third-party brand only when accurate and necessary, and audit trademark phrasing separately.
- Do not call an attribute an advantage unless our fact is verified and the comparison set supports the conclusion.
- Use `CORE_BENCHMARK` to establish the attainable primary comparison set; use `BOUNDARY_REFERENCE` to show rating-count, rating, price, specification, or offer boundaries without treating an entrenched leader as the default peer.
- Use `DIFFERENTIATION_REFERENCE` only for the specific gap it documents; use `KEYWORD_SOURCE_ONLY` for language, and `CONTEXT_ONLY` for context.
- Preserve all supplied ASINs and their order in the audit trail even when only a subset informs visible copy.

Express differentiation with self-contained facts:

```text
Three temperature settings let you choose 113°F, 131°F, or 140°F
```

Avoid unsupported comparisons:

```text
Heats faster and lasts longer than other brands
```

Default-block `better`, `faster`, `stronger`, `longer-lasting`, `more durable`, `best`, `No. 1`, `leading`, `ultimate`, `unmatched`, and competitor comparisons unless claim-matched comparative testing and policy review support the exact wording.

## Title method

Read [field-writing.md — Title method](field-writing.md#title-method).

## Item Highlights method

Read [field-writing.md — Item Highlights method](field-writing.md#item-highlights-method).

## Five-bullet method

Read [field-writing.md — Five-bullet method](field-writing.md#five-bullet-method).

## Backend Search Terms method

Read [field-writing.md — Backend Search Terms method](field-writing.md#backend-search-terms-method).

## Conversion and localization audit

High-conversion copy is a hypothesis to test, not a guarantee. Improve its odds by checking:

- Can the shopper identify the exact offer immediately?
- Do the first title words and first phrase of each bullet carry useful information?
- Does each benefit have a credible feature, mechanism, or specification behind it?
- Are the major reasons for a wrong purchase answered: quantity, size, fit, compatibility, contents, limitations, or variation?
- Does the copy differentiate through specifics rather than adjectives?
- Is the language idiomatic for the target marketplace rather than translated word for word?
- Are units, decimal marks, spelling, capitalization, and terminology localized?
- Do backend Search Terms add missing intent instead of repeating visible or structured fields, and are they within the verified UTF-8 byte limit?
- Are warnings and limitations clear without turning the bullets into legal boilerplate?

Use observed CTR, conversion, search-query, returns, and customer-question data for later iteration. Describe changes as observed associations; do not claim they prove an A9, A10, COSMO, Rufus, or other private-algorithm mechanism.

## Standard handoff roles and copy plan

Before drafting any Listing field, create a compact `copy_plan`. Each row must answer:

| Required field | Question |
|---|---|
| `buyer_question` | What purchase decision or objection is this message resolving? |
| `own_fact_ids` | Which released facts authorize every product claim? |
| `keyword_ids` or `keyword_family` | Which search language is relevant and eligible for this field? |
| `competitor_context_ids` | Which competitor role, VOC theme, or information gap explains why this matters? |
| `target_field` | Title, Item Highlight, a specific bullet, Product Description, or Search Terms? |
| `message_scope_or_condition` | Which variation, quantity, test condition, or use boundary must remain visible? |
| `prohibited_wording` | Which absolute, comparative, health, safety, certification, IP, or unsupported wording must be avoided? |
| `decision` | `USE`, `HOLD`, or `OMIT`? |

Apply this sequence:

1. Rank buyer questions using market/VOC/competitor evidence.
2. Remove questions that have no released own-product fact to answer them truthfully.
3. Select eligible keyword language without changing the question or claim scope.
4. Assign each surviving message to the smallest useful Listing field.
5. Draft prose from the plan.
6. Map exact text back to Fact IDs and keyword IDs.
7. Validate the release package, then run the mechanical audit.

Product Description is conditional. Use it only when the current marketplace/Product Type Definition or account editor exposes and needs it. It remains a visible claim-bearing field, so every product claim in it needs the same evidence mapping as the title and bullets. This Skill does not create A+ Content.

On refresh, do not rewrite merely because a high-volume term appeared. Re-open the copy plan when current first-party query data, returns, customer questions, competitor position, product facts, policy, or schema create evidence that a different buyer question or field placement deserves priority. Keep every prior `listing_version_id` immutable.
