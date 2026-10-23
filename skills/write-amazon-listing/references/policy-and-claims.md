# Policy and claims verification

Treat this file as a dated baseline and a verification procedure, not as permanent law. Recheck current official sources at execution time.

## Contents

1. Source hierarchy
2. Runtime policy snapshot
3. Dated US baseline
4. Claim-risk gates
5. Regulated-document evidence chain
6. Algorithm and performance language

## Source hierarchy

Use sources in this order:

1. Current signed-in Seller Central help and the target category style guide or listing template.
2. Official Amazon News and Announcements or Amazon staff clarification.
3. Applicable government regulator, statute, standard owner, or accredited certification record for regulated claims.
4. User-provided reports, certificates, engineering documents, packaging, and labels.
5. Third-party articles, tools, competitor pages, and forums only for hypotheses and market context.

Resolve conflicts by scope, jurisdiction, category, effective date, and source authority. A third-party article cannot override Amazon or a regulator.

If an official Seller Central help page requires login, use the user's signed-in page or ask the user to paste/export the relevant category rule. An official announcement can establish a baseline, but it may not contain every exception.

## Runtime policy snapshot

Capture this before drafting:

```yaml
verified_at:
marketplace:
category_path:
product_type:
seller_or_vendor:
parentage_level:
media_product:
title:
  max_characters:
  forbidden_characters:
  max_word_repetition:
  format_or_category_exceptions:
item_highlights:
  available:
  max_characters:
  searchable_and_visible:
bullets:
  count:
  min_characters:
  max_characters:
  punctuation_and_format:
  prohibited_content:
product_description:
  available:
  required_by_schema:
  max_characters_or_bytes:
  relationship_to_a_plus:
search_terms:
  attribute_name:
  available:
  required_by_schema:
  required_for_this_task:
  max_utf8_bytes:
  delimiter_and_format:
  lowercase_required_or_recommended:
  redundancy_rules:
  prohibited_content:
regulated_product_checks: []
official_sources: []
unverified_boundaries: []
```

Do not silently use US rules for Canada, Mexico, Europe, Japan, Australia, India, or another store. Do not use one category's style guide for another.

When available, verify the actual Product Type Definition and submission schema for the marketplace, product type, and parent/child level. The schema can reveal field availability, limits, required attributes, and conditional rules that a general help page cannot. Check the Seller Central edit form or the official Product Type Definitions API, then preserve any unresolved conflict in the policy snapshot.

Do not assume Product Description exists, is required, or is customer-visible for every product type or account state. Record it separately from A+ Content. If A+ suppresses or replaces the displayed description, or the Product Type Definition omits the attribute, leave the Listing package field empty with the verified reason; do not manufacture description copy merely to complete a template.

- [Amazon SP-API: Retrieve a Product Type Definition](https://developer-docs.amazon.com/sp-api/docs/retrieve-a-product-type-definition)
- [Amazon SP-API: Manage Product Listings](https://developer-docs.amazon.com/sp-api/docs/manage-product-listings-guide)

## Dated US baseline

Baseline captured: **2026-07-24**; official follow-up checked **2026-08-23**. Recheck before every publish-ready result.

### Product title and Item Highlights

Amazon announced that, starting **2026-07-27**, titles in all non-media categories must contain no more than **75 characters including spaces**. Amazon also introduced an additional **125-character Item Highlights** field for materials or recommended use cases and described it as searchable and visible with the title in search results and on product detail pages.

Amazon's later official Q&A confirms that Item name and Item highlights are both search inputs, that the 200 available characters are split into 75 for Item name and 125 for Item highlights, and that Item highlights display beneath Item name on desktop and mobile effective **2026-08-10**. The Q&A also says visible character count can vary by screen or display settings.

- [Amazon: Updates to improve your product titles begin on July 27](https://sellercentral.amazon.com/seller-forums/discussions/t/145b6d0f-999c-4555-896c-c694bda2e470)
- [Amazon: Answers to your product title update questions](https://sellercentral.amazon.com/seller-forums/discussions/t/302aaac6-6f2b-4d86-bcd2-36fe24f0e6cd?postId=302aaac6-6f2b-4d86-bcd2-36fe24f0e6cd)
- [Signed-in Product title requirements and guidelines](https://sellercentral.amazon.com/help/hub/reference/GYTR6SYGFA5E3EQC)

For a draft that will remain live on or after 2026-07-27, target the new 75-character non-media limit even during the transition unless a current category exception says otherwise.

Amazon's 2025 title update also prohibited `!`, `$`, `?`, `_`, `{`, `}`, `^`, `¬`, and `¦` unless part of the brand name, and limited the same word to no more than twice, except prepositions, articles, and conjunctions. Verify that the current help page has not superseded or narrowed these rules.

- [Amazon: New product title requirements effective January 21, 2025](https://sellercentral.amazon.com/seller-forums/discussions/t/533f9cf7-3b5e-4974-b523-02e4a1a42c5f)

Media products are excluded from the announced 75-character change; verify their category rule separately.

### Bullet points

Amazon's official 2024 update restricts special characters, emojis, and some phrases such as refund-related guarantees, and calls for clear, concise bullets. Amazon's official quick tip describes up to five bullets, feature-plus-benefit writing, useful sizing data, product-specific facts, and exclusion of pricing, shipping, or company information.

- [Amazon: Updated bullet point requirements](https://sellercentral.amazon.com/seller-forums/discussions/t/65f8e647-977d-49ac-9036-2049b96720b2)
- [Signed-in Product bullet point requirements](https://sellercentral.amazon.com/gp/help/GX5L8BF8GLMML6CX)
- [Amazon Quick Tip: Bullet Points](https://sellercentral.amazon.com/seller-forums/discussions/t/cfc077c4-2df4-471e-8c45-749b21c7d0a9)

Do not hardcode an unverified universal bullet character limit. Confirm the current help page, category template, and any feed-field limit at runtime.

### Backend Search Terms

US baseline checked: **2026-08-05**. Recheck the actual Product Type Definition or Seller Central field before every publish-ready result.

Amazon's current Search Terms guidance limits the field to 250 bytes, recommends generic words, spelling variations, abbreviations, and alternate names, and instructs sellers to use spaces without punctuation, avoid repeated words and unnecessary stop words, and omit information already present in title, brand, or other fields. For a conservative baseline, keep the final UTF-8 value below 250 bytes unless the current schema clearly defines an inclusive maximum.

Amazon also prohibits or warns against the seller's brand, other brand names, ASINs, temporary statements such as `new` or `on sale`, subjective claims such as `best`, `cheapest`, or `amazing`, and abusive terms. Treat these as blocked Search Terms, not merely low-priority words.

- [Amazon Quick Tip: Search Terms](https://sellercentral.amazon.com/seller-forums/discussions/t/923d53dc-a182-4475-a164-6b2500dbaf2d)
- [Amazon: Optimize your search terms](https://sellercentral.amazon.com/seller-forums/discussions/t/62e0e515a6e991d171d3ccee7be36304)

Backend invisibility does not relax evidence, trademark, medical, safety, age, compatibility, or category-relevance requirements. Search Terms do not guarantee indexing, placement, or conversion.

### Product detail accuracy

Require customer-facing claims to describe only the product sold under the ASIN and to remain consistent across title, bullets, attributes, images, package, and variation data.

- [Signed-in Amazon Product Detail Page Rules](https://sellercentral.amazon.com/gp/help/G200390640)
- [Signed-in Amazon General Listing Restrictions](https://sellercentral.amazon.com/help/hub/reference/G201707070)

## Claim-risk gates

Apply the strictest relevant gate. This list is illustrative, not exhaustive.

| Claim family | Default treatment | Minimum evidence direction |
|---|---|---|
| Dimensions, quantity, material, package contents, runtime, capacity, compatibility | Withhold if scope is missing | Exact model/variation source with per-unit/per-set scope |
| Certification or approval: UL, ETL, FCC, CE, RoHS, FDA, UN38.3, organic, food grade | Block generic or logo-only claims | Verifiable document/record matching model, standard, entity, date, and exact claim |
| Safety or protection: child-safe, non-toxic, overheat protection, fireproof, waterproof | Block absolute or unsupported claims | Claim-matched test and applicable regulatory review; state limits |
| Medical or health: treats, relieves disease/pain, improves circulation, therapeutic | Block by default | Applicable regulatory classification plus competent substantiation for exact use and wording |
| Antimicrobial, disinfecting, pest-control, repellent | Block pending category-specific review | Applicable regulator registration/exemption and substantiation |
| Environmental: biodegradable, compostable, carbon neutral, eco-friendly | Withhold broad wording | Specific, qualified claim with lifecycle or standard evidence as applicable |
| Children or age suitability | Withhold if design and testing boundary is unclear | Intended-age documentation and applicable children's-product testing/certification |
| Comparative or superlative: better, faster, longest, best, No. 1 | Block by default | Defined comparison set, same-condition testing, current substantiation, and policy review |
| Warranty, guarantee, refund, lifetime | Keep out of bullets if prohibited; otherwise qualify | Actual marketplace fulfillment terms, responsible entity, duration, exclusions, and policy review |
| Third-party compatibility and trademarks | Use only when necessary and accurate | Exact compatibility evidence and non-affiliation-safe phrasing |
| Origin: Made in USA or other country claim | Withhold if sourcing boundary is unclear | Applicable origin standard and supply-chain evidence |

Never convert absence of known harm into `safe`, absence of failure into `durable`, a warning into a protection feature, or a component certificate into whole-product certification.

For regulated products, verify the exact product type and marketplace before deciding which regulator or standard applies. Do not guess a UL standard, FDA class, battery transport classification, children's-product status, pesticide category, or food-contact requirement.

## Regulated-document evidence chain

When the user supplies an SDS/MSDS, test report, certificate, declaration, or test summary, identify the document type before using it. Similar names and overlapping data do not make the documents interchangeable.

Extract and compare the issuing entity, report number, manufacturer, tested sample or model, specification, standard and revision, test dates, results, responsible person, and required contact details. Then verify a continuous identity chain from the sold ASIN/model to the tested finished product or component. A matching voltage, capacity, material, dimension, generic model family, file name, or folder name is not identity evidence. Require a label, BOM, specification, purchase record, or supplier/manufacturer declaration when the report does not name the sold product.

Keep component evidence within component scope. A cell report does not certify the finished device, and a component certificate must not become a whole-product claim.

For lithium cells, batteries, and products containing them:

- Treat an SDS/MSDS as composition, hazard-communication, handling, and transport-context evidence. It does not by itself prove successful UN 38.3 testing.
- Treat a full UN 38.3 laboratory report as evidence for the exact tested cell or battery design only. Do not assume it satisfies the separate test-summary requirement in UN Manual subsection 38.3.5.
- Check a purported test summary for, at minimum, manufacturer name and contact details; test-laboratory name and contact details; unique report ID and date; lithium type, mass, watt-hour rating or lithium content, physical description, and model number; tests and pass/fail results; Manual revision and amendments; assembled-battery references when applicable; and a responsible person's name and title.
- Determine test applicability from whether the sample is a cell, single-cell battery, or battery. Do not mark a non-applicable omitted test as a failure.
- Treat an unchanged design's test summary as not expiring solely because of age, while still checking whether Amazon, a carrier, destination, or changed design creates a newer requirement.
- Keep `UN38.3 certified`, `TSA approved`, `airline approved`, and broad `safe` wording out of customer-facing copy unless a current rule and claim-matched evidence explicitly support the exact wording. Prefer using transport documents for backend compliance.

If the document is internally plausible but cannot be independently authenticated, label it `supplied document reviewed; issuer verification pending`. If the sold model-to-report chain is incomplete, keep the affected compliance claim withheld and do not set the Listing to `READY` where that documentation is required.

## Algorithm and performance language

Amazon does not publish a complete ranking or conversion algorithm that a Listing writer can guarantee. Treat names such as A9, A10, COSMO, Rufus, or successor systems as context, not deterministic copy rules, unless an official source states a specific requirement.

Use defensible objectives:

- search-query relevance;
- exact product identification;
- complete and consistent attributes;
- natural language and mobile readability;
- credible differentiation;
- lower wrong-purchase risk;
- policy-compliant claims;
- iterative testing with actual CTR, conversion, search-query, return, and customer-question data.

Do not promise `algorithm compliant`, page-one ranking, higher conversion, or a perfect Listing. Say `optimized against current verified rules and supplied evidence`.
