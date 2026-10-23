---
name: write-amazon-listing
description: "撰写、改写或审计有证据支撑的亚马逊 Listing 文案与后台搜索词（标题、五点、描述、Search Terms），包括单字段修改和发布交接；经用户批准后可通过官方接口提交。Create, rewrite, or audit evidence-based Amazon Listing copy and backend Search Terms. 不用于选品、A+、品牌旗舰店或广告策略。"
---

## 数据与工具

- 本会话还没调过就先 `xander_status`；先 `xander_archive_overview` 读该产品的已确认事实、认证和内容锁定。
- 当前线上内容用 `xander_listing_get`（标题、五点、属性、issues、productType）。关键词证据来自关键词技能的交接或搜索查询表现报表。方法见 [取数方法](../xander-operations/references/data-workflow.md)。
- 提交到亚马逊：按 [写入安全](../xander-operations/references/write-safety.md)，用 `xander_prepare_change`（op=`listing.attribute`，attribute=item_name / bullet_point / product_description / generic_keyword），它会先让亚马逊做 VALIDATION_PREVIEW 预校验；用户批准这份提案后再 `xander_execute_change`。开关只有用户能开。Listing 生效常有延迟，`AWAITING_READBACK` 时稍后 `xander_verify_change`。
- 未知数字是 null，不是 0；模拟结果标 SIMULATED / NOT LIVE。
- 脚本只在宿主能执行代码时运行（Codex、Claude Code 可以）；否则透明说明限制。用简洁中文沟通，文案用目标站点语言。

# Write Amazon Listing

Produce evidence-backed, marketplace-native copy at the requested scope. A full creation normally includes title, Item Highlight when applicable, five distinct bullets and backend Search Terms; Product Description is conditional on the current schema and need. Deliver one recommended version unless alternatives are requested. Never promise ranking, traffic or conversion, or present private-algorithm theories as fact.

## Scope and routing

For an existing project, use its current-state index, latest approved content and applicable `OPERATING_DATA_SOP.md`; an index is not stronger than original evidence. Reuse suitable upstream research, preserving source dates and stable IDs. Refresh only missing, stale or requested evidence. Product/account/release specifics belong in project artifacts, not this Skill.

Choose the smallest mode: `Create`, full or scoped `Rewrite`, read-only `Audit`, `Search Terms only`, `Input preparation`, `Post-change review`, or `Stage 3 handoff`. Auditing does not authorize rewriting; a one-field request does not authorize other fields, Search Terms, images or A+ edits. A later scoped approval supersedes only named locks.

Read each selected reference completely; reuse unchanged references already read in this turn.

| Work | Read |
|---|---|
| Ordinary scoped field draft or Search Terms only, with sufficient own-product facts | [field-writing.md](references/field-writing.md): scoped evidence checks, eligible terms, current field rules, field methods and compact QA |
| Input preparation, conflicting facts, complex model/test evidence | [input-and-evidence.md](references/input-and-evidence.md) |
| Sensitive claims, publishability/policy audit or current-policy verification | [policy-and-claims.md](references/policy-and-claims.md); add input/evidence guidance when facts determine the decision |
| Keyword/competitor placement or differentiation audit | [copy-and-keywords.md](references/copy-and-keywords.md); add field-writing for field-level edits |
| Full creation/rewrite | Input/evidence, copy/keywords, field-writing and policy/claims above; release contract and delivery format below |
| Raw standard handoff, release-package audit, versioned change, supplied content locks/change-control, Stage 3 or any intended `READY` result | [workflow-and-release-contract.md](references/workflow-and-release-contract.md), plus relevant content references |
| Full human-readable delivery and quality score | [delivery-format.md](references/delivery-format.md) |
| Read-only effect/performance follow-up | [post-change-review.md](references/post-change-review.md); fact/policy references only when a finding requires them |

A narrow draft does not need the full JSON package or full-Listing score. It remains `PROVISIONAL` without the full release gate. If sensitive claims, a fact conflict, supplied locks or an intended `READY` result arise, load their required references before proceeding. No route grants publication permission.

## Shared evidence and permission gates

Establish marketplace/locale, category/product type, exact brand/model/variation, sellable offer quantity and contents, requested fields and draft versus release intent. For rewrites/ST, obtain current visible fields and known structured attributes relevant to cross-field checks (`xander_listing_get`). Ask for unknown marketplace/category before calling anything publish-ready.

Keep three lanes distinct: market/keyword evidence chooses language and priority; competitor/VOC evidence chooses buyer questions and gaps; only own-product evidence authorizes product claims. Seller confirmation is not laboratory/regulatory proof. Preserve conflicting values and exact single-unit/multipack/test scope; never infer quantities, capacity, runtime, features, certifications, compatibility or effects. Exact unit conversions may be derived with source values.

Preserve whichever of `project_id / selection_run_id / candidate_id / competitor_lock_run_id / keyword_run_id` actually exist, plus upstream roles/eligibility and evidence taxonomy. Product selection is frozen: selection-stage IDs may simply be absent; any other missing upstream ID goes into `unknowns` with a reason ([lineage rules](../xander-operations/references/lineage-and-selection.md)). Create separate Listing run/version IDs when building a package; never invent upstream IDs to pass validation. Preserve optional `operating_context` unchanged and verify `operating_context_sha256`. Planned price and future stage goals are not observed offer/stage evidence.

Ordinary release claims require `COPY_RELEASED`; certification, safety, medical, quantitative-performance, children, environmental, legal or comparative claims require scope-matched evidence and `FORMAL_CLAIM_RELEASED`. Withheld, contradictory, pending or unknown claims cannot enter visible fields or ST. Preserve `evidence_type / risk_class / research_status / publication_status`; legacy codes may be translated only for compatibility, not overwrite source taxonomy. Risk acknowledgement and content locks never release evidence or blocked keywords. If the seller says a fact is unknown, omit its dependent claim without repeatedly asking.

Verify time-sensitive rules against current official Amazon marketplace/category sources and account/product-type schema as relevant. Record verification date, source URLs and rules for the requested fields; never transfer a universal title/ST limit across categories. Use regulator sources for regulated claims. If live verification is unavailable, consult the dated policy baseline, label `PROVISIONAL` and identify the gap. Cite policies in the audit, not customer-facing copy.

## Work at the selected depth

1. Normalize facts and evidence; for a raw `listing_handoff.json`, run [validate_listing_package.py](scripts/validate_listing_package.py) in its Stage 2 `INTAKE` mode before drafting and resolve structure/identity failures.
2. Build a compact copy plan before prose: buyer question → own Fact IDs → eligible keyword IDs/family → competitor context if available → target field → scope/condition → prohibited wording → `USE/HOLD/OMIT`. Missing market context remains a gap, not an invented source.
3. Follow the selected field methods. Preserve upstream keyword roles and `front_end_copy_eligible / listing_indexing_eligible` gates. `INDEXING_CANDIDATE` is backend-only; later-stage terms need observed current-stage release, never a planned price. Unsupported/held/IP-isolated/wrong-intent/context-only terms never enter copy.
4. Apply change control before edits: a review trigger is not edit authority. Locked fields require exact new authorization; unchanged locked fields must match the approved baseline. Preserve prior versions. Record image/A+ locks without editing those assets.
5. Audit exact facts, quantities/units/variation, claims, keyword placement, policy limits, ST UTF-8 bytes/redundancy and native readability. Full five-bullet copy needs five genuinely distinct buyer questions; never invent filler. Check visible Product Description and backend claims as rigorously as title/bullets.

Distinguish approved copy, submission acceptance, Listings API readback, Catalog summary and rendered frontend text with timestamps. Acceptance is not proof of publication, and stale summaries must not overwrite newer authorized copy.

## Release and validation

`BLOCKED`: core identity/offer/compatibility/compliance facts are missing or conflicting. Return confirmed facts, withheld claims and at most five high-impact questions, not apparently publish-ready copy.
`PROVISIONAL`: core facts permit conservative copy, but evidence, policy or release validation is incomplete; omit unsupported claims and name gaps.
`READY`: sufficient distinct own-product evidence, verified current rules, valid placements and complete release validation. Neither a high score nor mechanical checks alone establish readiness.

Full creation/full rewrite, formal release, user-requested packages and every intended `READY` result require the machine-readable release contract. Run both [validate_listing_package.py](scripts/validate_listing_package.py) and [audit_listing.py](scripts/audit_listing.py). The latter must receive the exact release JSON as `release_package`, validate it and match every copy field; caller booleans alone are not evidence. Supply current limits, Product Description, seller/competitor brands, ASINs and known indexed attributes, and explicit `policy_snapshot_verified / evidence_mapping_verified`. Set `search_terms_required=false` only for user opt-out or verified inapplicable schema. Cover every claim, including ST; preserve exact authorized sensitive-claim wording and material punctuation.

Resolve hard failures or lower status. `READY` requires both validators without hard failures, current verified policy, complete claim mappings and valid keyword placements. Validators do not replace seller/legal/product review or authorize publication. Scoped drafts/checks may use applicable checks without claiming full `PASS`.

Stage 3 preserves all lineage/context, policy snapshot, copy plan, claim mappings, placements, withheld items, change control and validation in `listing_release.json`. A requested `promotion_handoff` is neutral reference data only: no campaign architecture, match types, bids, budgets, ACoS targets or duplicated price values. Downstream offer, inventory, eligibility and economics need current refresh.

## Delivery

Put requested paste-ready copy first, then a compact audit. Scoped edits return only changed fields, relevant counts/rules, material evidence/keyword changes, preserved scope and uncertainty. ST-only returns its rule snapshot, one line, UTF-8 byte count, exclusions and gaps; missing visible/structured fields makes redundancy review provisional. Full output/score follows the delivery reference even when its audit is internal for copy-only presentation; always disclose critical blockers and high-risk omissions.

Call it a publish candidate, not a guaranteed winner; final seller review precedes publication. Only after the seller approves the exact text may you prepare a `listing.attribute` change; never submit unapproved or `BLOCKED` copy.

## 收尾

已批准的文案版本、提交结果和复盘日期用 `xander_archive_note` 记下；新确认的产品事实用 `xander_archive_set_fact` 记下。规则见 [店铺档案](../xander-operations/references/business-context.md)。
