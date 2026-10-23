# Field writing and scoped edits

Read this for ordinary field drafts and Search Terms-only work, or alongside the full copy-plan reference for complete Listings. It does not replace the release gate in [SKILL.md](../SKILL.md).

## Scoped evidence and current rules

Use only the requested fields. Confirm the exact brand/model/variation, single-unit versus sellable multipack scope and own-product fact sources. Do not infer package quantity from a picture, features from icons/ports, or single-unit battery capacity from the sum of components. Preserve conflicting or missing facts; omit unsupported dependent language. Seller answers are seller-confirmed facts, not laboratory or regulatory reports.

Maintain the compact buyer-question/fact/keyword/field/scope copy plan from the entrypoint. Record ordinary confirmed facts for a conservative draft; release still requires formal publication statuses and validators. Certification, safety, health, children, environmental, comparative and quantitative-performance claims require [input-and-evidence.md](input-and-evidence.md) and [policy-and-claims.md](policy-and-claims.md), including exact sold-model/test-sample scope. Do not use competitors or search demand to prove own-product claims.

Retain upstream IDs, roles and eligibility. CORE_VERIFIED/SECONDARY_VERIFIED require the relevant front-end or indexing flag. INDEXING_CANDIDATE is backend-only with indexing eligibility. LATER_STAGE_RELEVANT additionally requires current_stage_eligible=true grounded in observed current stage, not a planned price. RELEVANT_NEEDS_VALIDATION, MARKET_CONTEXT, HOLD_CLAIM, BRAND_IP_ISOLATED, WRONG_INTENT and UNSUPPORTED never enter either visible copy or ST. Downstream-review eligibility is not placement permission. If role interpretation is disputed, read [copy-and-keywords.md](copy-and-keywords.md); do not relabel. A missing library does not authorize inventing measured keyword evidence.

Verify current official marketplace/category rules for changed fields: limits, forbidden content, availability, schema/format, repeated-word and ST redundancy requirements. Record date and sources. Current-policy verification or publishability analysis uses the policy reference; absent live verification, use its dated baseline and mark the draft PROVISIONAL. Do not assume a universal title length or 250-byte ST allowance. Unknown marketplace/category cannot be publish-ready.

Supplied content locks/change-control or a versioned release require [workflow-and-release-contract.md](workflow-and-release-contract.md). Keep untouched fields intact. Review triggers and risk acknowledgements are not edit permission or claim release. Any intended READY result requires the complete package and both validators, even for one field.

## Title method

Start from this flexible architecture:

```text
Brand + precise product identity + one to three decisive verified attributes
```

Select attributes that help the shopper identify, filter, or avoid buying the wrong item. Typical candidates are offer quantity, compatibility, size, material, model, format, or one genuinely differentiating function.

Apply these rules:

- Use the runtime-verified hard character limit and keep a small safety margin when practical.
- Make the product identity understandable before adding secondary keywords.
- Use one expression per keyword cluster.
- Include brand exactly as confirmed.
- Include quantity or compatibility when omission could mislead.
- Move long use cases, secondary functions, and supporting details to Item Highlights or bullets.
- Remove promotional language, subjective praise, unnecessary capitalization, and decorative punctuation.
- Follow the current official repeated-word and forbidden-character rules.

Do not automatically use every available character. A shorter, unambiguous title can be stronger on mobile.

## Item Highlights method

When the target marketplace and category support Item Highlights:

- follow the current verified limit;
- add one concise material, use case, or comparison-helpful detail;
- use a supported keyword only when natural;
- avoid repeating the title word for word;
- do not move a legally necessary warning out of its required field merely to improve copy.

If a current official announcement supports Item Highlights but the seller's actual edit form or Product Type Definition cannot be inspected, prepare the field and label submission availability as unverified. Do not omit it silently or repurpose bullet one as the field.

Treat Item Highlights as a separate indexed and visible field only when the current official source confirms it for the target marketplace.

## Five-bullet method

Choose the five strongest buyer questions for the product and category. Do not impose the same order on every product.

Possible themes include:

- core outcome and primary differentiation;
- performance, construction, or operating mechanism;
- sizing, fit, compatibility, capacity, or selection information;
- operation, maintenance, installation, or safety boundary;
- package contents, warranty boundary, storage, or care.

Use this sentence logic:

```text
buyer-relevant outcome → verified feature or mechanism → useful proof/detail → material condition or scope
```

Write each bullet so its opening phrase remains meaningful on mobile. Use a short header only when it complies with the current category rules and improves scanning.

Keep the bullets distinct:

- Assign one primary decision question to each bullet.
- Do not repeat a specification unless the second occurrence adds necessary context.
- Do not restate the title as bullet one.
- Prefer exact details to `premium`, `high quality`, `perfect`, `must-have`, or `ideal gift`.
- Do not invent a fifth theme when the facts support only four.
- State conditions that materially affect runtime, compatibility, performance, care, or safe use.

## Backend Search Terms method

Treat Search Terms as a complementary relevance field, not a second title and not a place to hide risky claims.

Build the field in this order:

1. Create a normalized inventory from the title, brand, Item Highlight, bullets, and known structured attributes. Case-fold text, split punctuation and hyphens for comparison, and collapse obvious singular/plural or spelling variants where the marketplace guidance says one form is sufficient.
2. Start candidates with high-relevance measured terms that add a missing synonym, alternate name, abbreviation, regional variant, audience, or use-case concept. Then consider market observations. Label model-generated candidates as hypotheses and use them only when directly relevant.
3. Require each attribute, audience, compatibility, effect, or use-case term to map to a permitted product fact. Product-identity synonyms must describe the same product type without changing category intent.
4. Remove terms already represented in the front-end or structured attributes. When a target phrase contains words already indexed elsewhere, add only the missing meaningful token rather than repeating the whole phrase.
5. Build an explicit exclusion inventory from the seller's brand, competitor brands, supplied ASINs or ISBNs, and known trademarks. Remove those exclusions plus stop words, temporary or promotional language, subjective claims, offensive terms, unsupported medical or safety language, and irrelevant high-volume traffic. If the brand, ASIN, or structured-field inventory is incomplete, label the Search Terms audit provisional.
6. Keep one normalized occurrence of each term and one singular or plural form unless the two forms have distinct meanings. Do not add common misspellings when Amazon states that its systems already compensate for them.
7. Format as one lowercase, space-separated, punctuation-free line unless the verified marketplace or product-type schema requires otherwise.
8. Count UTF-8 bytes after final formatting. Stay below the runtime-verified limit and leave unused space when no additional high-relevance term survives the filters.

Prioritize candidates by this order:

```text
measured relevance and conversion evidence
→ directly relevant measured search volume
→ high-confidence market observation
→ evidence-backed model hypothesis
```

Do not claim that inclusion guarantees indexing, ranking, or traffic. If the existing front-end and structured fields are unavailable, state that cross-field redundancy remains unverified.

## Product Description method

Draft only when the current Product Type Definition, account editor or applicable schema exposes and needs it. If unsupported, suppressed, unnecessary or not requested, leave it empty and record why. It is a visible claim-bearing field with the same evidence mapping as title/bullets, not a substitute for A+ Content; this Skill does not create A+.

## Scoped QA and delivery

Check values, units, quantity/variation, conditions, native language and eligible keyword placement. Avoid synonym chains and keyword density targets. Exclude promotions, contact details, irrelevant terms, unsupported guarantees and competitor marks; necessary truthful third-party compatibility needs separate trademark/policy review. Reject invented facts or hard-rule violations, regardless of readability.

For every changed field, retain exact claim-to-fact mapping and its conditions; do not convert unknown claims into safer-sounding assertions. Sensitive released claims retain authorized wording and material punctuation. For ST, own-product evidence and all claim restrictions still apply; it cannot hide a claim omitted from visible copy.

Return one paste-ready version of the requested field(s), relevant character/UTF-8 counts and rule snapshot, changed evidence/keyword notes, preserved scope and material gaps. ST-only additionally summarizes exclusions; missing current visible fields, brand/ASIN inventory or structured attributes makes cross-field redundancy PROVISIONAL. Do not generate unrequested fields, a full score or JSON merely for a scoped draft. A full creation/rewrite, formal release, requested package or READY claim still follows the entrypoint's complete validation gate.
