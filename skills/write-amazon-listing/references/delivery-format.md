# Human-readable Listing delivery

Read this reference when preparing a full `Create` or full `Rewrite` response. Scoped field edits, input preparation, read-only audits, and Search Terms-only work use the compact delivery guidance in `SKILL.md` instead.

Put paste-ready copy first, followed by its compact audit. Include every applicable section below unless the user explicitly asks for copy only. If a section is inapplicable or cannot be verified, retain its heading and state the reason. Copy-only presentation does not waive the evidence, policy, field-lock, validation, or release requirements in `SKILL.md` and the release contract.

```markdown
状态：READY / PROVISIONAL

规则快照
- 站点与类目：
- 核验日期：
- 标题上限：
- Item Highlights：
- 后台 Search Terms：字段名 / 是否可用 / 本次是否要求 / 格式 / UTF-8字节上限：
- 官方来源：

标题（字符数：XX）
...

Item Highlight（如适用，字符数：XX）
...

五点描述
1. ...（字符数：XX）
2. ...（字符数：XX）
3. ...（字符数：XX）
4. ...（字符数：XX）
5. ...（字符数：XX）

Product Description（如当前 schema 适用，字符数：XX）
...

后台 Search Terms（UTF-8字节数：XX / 已核验上限：XX）
...

关键词覆盖
| 关键词/词簇 | 优先级 | 出现位置 | 未采用原因 |

主张证据
| 文案主张 | Fact ID | 证据等级 | 来源与适用范围 |

证据到文案规划
| 买家问题 | 自身 Fact ID | 关键词/词簇 | 竞品/VOC 背景 | 字段 | 决策 |

扣留内容与风险
- 未写入的主张：原因及所需证据

变更控制（如提供）
- 文案/素材状态、锁定范围、显式授权与复核触发器
- 风险确认仅代表运营决定，不改变证据或发布状态

质量评分
- 总分：XX/100
- 发布建议：
```

This presentation template is not a substitute for `listing_release.json`. A Stage 3 handoff follows [workflow-and-release-contract.md](workflow-and-release-contract.md), preserving stable IDs, claim mappings, keyword placements, change control, validator results, and readiness status.

## Quality scoring for a full publish candidate

Score the publish candidate out of 100:

- Fact and evidence integrity: 25
- Amazon policy and claim compliance: 20
- Search relevance: 20
- Conversion and differentiation: 20
- Readability and localization: 10
- Delivery completeness: 5

Apply these ceilings:

- No current official policy verification: maximum 84 and `PROVISIONAL`.
- No traffic-keyword priority or data: search relevance maximum 12/20.
- No competitor evidence: do not claim a verified competitive advantage.
- Missing or mismatched stable IDs: `PROVISIONAL` at best; use `BLOCKED` if the mismatch could refer to another product or variation.
- Unresolved core fact conflict: `BLOCKED`, regardless of score.

Reject the draft outright for any invented number, function, certification, effect, quantity, variation, compatibility statement, sensitive claim, or hard-rule violation.
