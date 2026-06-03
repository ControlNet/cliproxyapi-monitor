# Homepage Usage Dashboard: 输入 Tokens 改为 Regular Input Tokens

## TL;DR

> **Quick Summary**: 将首页 Usage Dashboard 中所有“输入 Tokens”展示语义统一为 `regularInputTokens = max(inputTokens - cachedTokens, 0)`，避免与费用计算语义不一致。
>
> **Deliverables**:
> - 首页 `/api/overview` 返回给 Dashboard 的输入 token 相关字段改为 regular-input 语义（保持字段名兼容）。
> - 首页图表/卡片/全屏图中的输入 token 展示与 tooltip 文案同步。
> - CHANGELOG 更新本次行为变更。
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves + Final Verification Wave
> **Critical Path**: T2 → T3 → T4 → T8/T9 → T12

---

## Context

### Original Request
用户要求：主页 Usage Dashboard 的可视化中，所有显示的“输入 tokens”都改为 `regularInputTokens`（即 `inputTokens - cachedTokens`）。

### Interview Summary
**Key Discussions**:
- 用户明确要求先制订计划，再执行改动。
- 改动目标聚焦首页 Dashboard 可视化语义一致性。

**Research Findings**:
- `lib/usage.ts` 的 `estimateCost` 已使用 regular-input 语义（`max(input-cached, 0)`）。
- `lib/queries/overview.ts` 当前仍汇总并返回 raw input token 字段。
- `app/page.tsx` Dashboard 多处（卡片、图表、tooltip、全屏图）消费 `inputTokens` / `totalInputTokens`。

### Metis Review
**Identified Gaps (addressed in this plan)**:
- 需防止“二次扣减缓存 token”导致 cost 回归。
- 需覆盖 normal + fullscreen 两套图表 UI，避免只改一半。
- 需定义 cached>input 的异常数据处理（clamp 到 0）。

---

## Work Objectives

### Core Objective
让首页 Dashboard 所有“输入 Tokens”展示采用 regular-input 语义，与成本计算口径对齐，同时保持数据库结构与非首页页面行为不变。

### Concrete Deliverables
- `lib/queries/overview.ts`：regular-input 聚合表达式与返回值更新。
- `app/page.tsx`：所有输入 token 展示点（normal/fullscreen）对齐到 regular-input。
- `lib/types.ts`：类型语义注释/字段说明同步。
- `CHANGELOG.md`：新增行为变更记录。

### Definition of Done
- [ ] `/api/overview?skipCache=1` 返回中：`totalInputTokens` 与所有时序 `inputTokens` 均为非负 regular-input 语义。
- [ ] 首页 Dashboard 所有输入 token 可视化（卡片、图表、tooltip、全屏）一致展示 regular-input。
- [ ] `pnpm lint` 与 `pnpm build` 通过。

### Must Have
- 使用统一公式：`max(inputTokens - cachedTokens, 0)`。
- 仅改变首页 Dashboard 展示语义，不修改 DB schema。
- 保持 cost 计算逻辑结果不受本次改动影响。

### Must NOT Have (Guardrails)
- 不改 `/records` 和 `/explore` 的语义与展示（除非被首页共享契约被动影响且在计划内明确）。
- 不做全局字段大重命名（例如全仓库把 `inputTokens` 改名）。
- 不引入与需求无关的重构（抽象泛化、目录重排等）。

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — 全部验证由执行代理完成。

### Test Decision
- **Infrastructure exists**: NO（当前 `package.json` 无 test script/测试框架依赖）
- **Automated tests**: None（本次不先搭建测试框架）
- **Framework**: none

### QA Policy
每个任务都提供 agent-executed QA 场景，证据写入 `.sisyphus/evidence/`。

- 执行前先创建证据目录：`mkdir -p .sisyphus/evidence .sisyphus/evidence/final-qa`

- **Frontend/UI**: Playwright（页面交互、DOM 断言、截图）
- **API/Backend**: Bash + curl（响应字段断言）
- **Code Quality**: Bash（`pnpm lint` / `pnpm build`）

---

## Execution Strategy

### Parallel Execution Waves

Wave 1 (Start Immediately — 基础表达式与汇总口径):
- T1 Scope Surface Inventory（首页展示点盘点）
- T2 Regular Input SQL Expression（统一表达式）
- T3 Summary + Model Aggregation Update（汇总与模型聚合）
- T4 Time-Series Aggregation Update（时序聚合）
- T5 Cost Regression Guard（成本口径防回归）

Wave 2 (After Wave 1 — 前端展示与契约一致性):
- T6 Type Contract Sync（类型契约语义同步）
- T7 KPI Cards + Copy Update（卡片与文案）
- T8 Normal Dashboard Charts Update（主视图图表）
- T9 Fullscreen Charts Update（全屏图表）
- T10 Changelog Update（变更记录）

Wave 3 (After Wave 2 — 验证与收口):
- T11 API Verification Pack（API 口径断言）
- T12 UI Verification Pack（Playwright 场景验证）
- T13 Build/Lint Regression Gate（质量闸门）

Wave FINAL (After ALL tasks — 独立并行复核):
- F1 Plan Compliance Audit（oracle）
- F2 Code Quality Review（unspecified-high）
- F3 Real Manual QA（unspecified-high + playwright）
- F4 Scope Fidelity Check（deep）

Critical Path: T2 → T3 → T4 → T8/T9 → T12
Parallel Speedup: ~60% vs sequential
Max Concurrent: 5

### Dependency Matrix (ALL tasks)

- T1: blockedBy none | blocks T7, T8, T9
- T2: blockedBy none | blocks T3, T4, T5
- T3: blockedBy T2 | blocks T6, T7, T8, T11
- T4: blockedBy T2 | blocks T8, T9, T11
- T5: blockedBy T2 | blocks T11, T13
- T6: blockedBy T3 | blocks T7, T8, T9
- T7: blockedBy T1,T3,T6 | blocks T12
- T8: blockedBy T1,T3,T4,T6 | blocks T12
- T9: blockedBy T1,T4,T6 | blocks T12
- T10: blockedBy none | blocks F1
- T11: blockedBy T3,T4,T5 | blocks T13,F1
- T12: blockedBy T7,T8,T9 | blocks F3,F4
- T13: blockedBy T5,T11 | blocks F2,F4

### Agent Dispatch Summary

- **Wave 1 (5 agents)**: T1 quick, T2 deep, T3 deep, T4 deep, T5 unspecified-high
- **Wave 2 (5 agents)**: T6 quick, T7 visual-engineering, T8 visual-engineering, T9 visual-engineering, T10 writing
- **Wave 3 (3 agents)**: T11 unspecified-high, T12 unspecified-high(+playwright), T13 quick
- **Final (4 agents)**: F1 oracle, F2 unspecified-high, F3 unspecified-high(+playwright), F4 deep

---

## TODOs

- [x] T1. Scope Surface Inventory（首页输入 token 展示点盘点）

  **What to do**:
  - 盘点 `app/page.tsx` 中所有输入 token 展示位：KPI 卡片、普通小时图、全屏小时图、tooltip、legend、可见性开关。
  - 建立“迁移清单”，确保 normal/fullscreen 两套视图都在范围内。

  **Must NOT do**:
  - 不修改 `/records`、`/explore` 页面。
  - 不改后端业务逻辑，仅做范围识别与清单化。

  **Recommended Agent Profile**:
  - **Category**: `quick`（快速静态盘点）
  - **Skills**: `[]`（无需额外技能）
  - **Skills Evaluated but Omitted**:
    - `playwright`: 本任务不做 UI 自动化，仅盘点代码位置。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 T2/T3/T4/T5 并行）
  - **Blocks**: T7, T8, T9
  - **Blocked By**: None

  **References**:
  - `app/page.tsx:1357-1369` - KPI 卡片中 input/output/reasoning/cached 文案与数值展示。
  - `app/page.tsx:1856-1866` - 普通小时图（Bar）输入 token 系列。
  - `app/page.tsx:2594-2613` - 全屏小时图（Area/Bar）输入 token 系列。
  - `app/page.tsx:1832-1853` 与 `2570-2591` - tooltip/legend 的 keyMap 与排序。

  **Acceptance Criteria**:
  - [ ] 产出覆盖清单，明确 normal + fullscreen + KPI + tooltip + legend 均被纳入。
  - [ ] 清单与后续任务引用一致，不遗漏输入 token 展示点。

  **QA Scenarios**:
  ```
  Scenario: 首页展示点盘点完整
    Tool: Bash
    Preconditions: 仓库代码可读
    Steps:
      1. 执行: grep -nE "totalInputTokens|dataKey=\"inputTokens\"|\"输入\"" app/page.tsx > .sisyphus/evidence/task-T1-surface-inventory.txt
      2. 检查输出包含 4 类位置关键词: totalInputTokens / normal chart / fullscreen chart / legend-keyMap
      3. 断言输出行数 >= 8 且同时命中 1800+ 与 2500+ 附近行号
    Expected Result: 覆盖普通视图与全屏视图输入 token 展示点
    Failure Indicators: 只命中单一区域（例如只有 normal 没有 fullscreen）
    Evidence: .sisyphus/evidence/task-T1-surface-inventory.txt

  Scenario: 漏扫保护（失败路径）
    Tool: Bash
    Preconditions: 上述清单已生成
    Steps:
      1. 统计 dataKey="inputTokens" 命中次数
      2. 若次数 < 2 则判定盘点失败
    Expected Result: 命中次数 >= 2（normal + fullscreen）
    Evidence: .sisyphus/evidence/task-T1-surface-inventory-error.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-T1-surface-inventory.txt`
  - [ ] `.sisyphus/evidence/task-T1-surface-inventory-error.txt`

  **Commit**: NO（盘点结果归入后续实现提交）

- [x] T2. Regular Input SQL Expression（统一 regular-input 表达式）

  **What to do**:
  - 在 `lib/queries/overview.ts` 新增统一表达式（例如 `REGULAR_INPUT_EXPR`），语义为 `greatest(input_tokens - cached_tokens, 0)`。
  - 作为后续 totals/model/hour 聚合的唯一 regular-input 来源，避免重复写法偏差。

  **Must NOT do**:
  - 不改 DB schema。
  - 不改 `estimateCost` 的输入/输出契约。

  **Recommended Agent Profile**:
  - **Category**: `deep`（SQL 聚合表达式与下游影响分析）
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `playwright`: 非 UI。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T3, T4, T5
  - **Blocked By**: None

  **References**:
  - `lib/queries/overview.ts:129-137,150-159,194-204` - 当前 raw input 聚合位置。
  - `lib/queries/records.ts:44-81` - 现有 SQL 成本表达式中 `greatest(input-cached,0)` 风格。
  - `lib/usage.ts:186-190` - 业务侧 regular-input 口径，需保持一致。

  **Acceptance Criteria**:
  - [ ] `overview.ts` 中存在单一 regular-input SQL 表达式并被复用。
  - [ ] 表达式明确使用 clamp（`max/ greatest`）避免负值。

  **QA Scenarios**:
  ```
  Scenario: 表达式已集中定义并可复用
    Tool: Bash
    Preconditions: 代码已修改
    Steps:
      1. grep -n "REGULAR_INPUT_EXPR\|regular input" lib/queries/overview.ts > .sisyphus/evidence/task-T2-expression.txt
      2. grep -n "greatest" lib/queries/overview.ts >> .sisyphus/evidence/task-T2-expression.txt
      3. 断言证据中同时出现表达式定义与至少一个聚合使用点
    Expected Result: 统一表达式存在且被下游引用
    Failure Indicators: 未定义统一表达式或仅局部硬编码
    Evidence: .sisyphus/evidence/task-T2-expression.txt

  Scenario: 负值防护缺失检测（失败路径）
    Tool: Bash
    Preconditions: 代码已修改
    Steps:
      1. 检查 regular-input 相关表达式是否包含 greatest/max 语义
      2. 若未包含则失败
    Expected Result: clamp 语义存在
    Evidence: .sisyphus/evidence/task-T2-expression-error.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-T2-expression.txt`
  - [ ] `.sisyphus/evidence/task-T2-expression-error.txt`

  **Commit**: YES（与 T3/T4/T5 合并）

- [x] T3. Summary + Model Aggregation Update（总览与模型聚合切换到 regular-input）

  **What to do**:
  - 将 `totalsPromise.inputTokens` 改为 regular-input 聚合。
  - 将 `byModelPromise.inputTokens` 改为 regular-input 聚合。
  - `overview.totalInputTokens` 与 `models[].inputTokens` 输出均使用新聚合结果。

  **Must NOT do**:
  - 不改 `totalTokens` / `totalCachedTokens` 含义。
  - 不影响 `models[].cost` 计算逻辑。

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `writing`: 非文档主任务。

  **Parallelization**:
  - **Can Run In Parallel**: NO（依赖 T2）
  - **Parallel Group**: Wave 1（串行依赖 T2）
  - **Blocks**: T6, T7, T8, T11
  - **Blocked By**: T2

  **References**:
  - `lib/queries/overview.ts:129-141` - totals 聚合。
  - `lib/queries/overview.ts:150-166` - byModel 聚合。
  - `lib/queries/overview.ts:342-349` - Overview 返回字段映射。
  - `lib/types.ts:8-15,30-36` - `ModelUsage` / `UsageOverview` 字段契约。

  **Acceptance Criteria**:
  - [ ] `overview.totalInputTokens` 为 regular-input 语义。
  - [ ] `overview.models[].inputTokens` 为 regular-input 语义。
  - [ ] 同查询参数下 `totalInputTokens >= 0` 且 `models[].inputTokens` 全非负。

  **QA Scenarios**:
  ```
  Scenario: totals 与 models regular-input 生效
    Tool: Bash (curl)
    Preconditions: 本地服务已启动
    Steps:
      1. curl -s "http://localhost:3000/api/overview?days=7&page=1&pageSize=500&skipCache=1" > .sisyphus/evidence/task-T3-overview.json
      2. jq -e '.overview.totalInputTokens >= 0' .sisyphus/evidence/task-T3-overview.json
      3. jq -e '([.overview.models[].inputTokens] | all(. >= 0))' .sisyphus/evidence/task-T3-overview.json
    Expected Result: 所有断言为 true
    Failure Indicators: 任意 inputTokens 为负数
    Evidence: .sisyphus/evidence/task-T3-overview.json

  Scenario: 过滤条件下语义仍一致（失败/边界路径）
    Tool: Bash (curl)
    Preconditions: overview filters 至少存在 1 个 model
    Steps:
      1. 从 filters 取一个 model，再请求 /api/overview?model={x}&skipCache=1
      2. 断言 totalInputTokens 与 models[0].inputTokens 非负且不报错
    Expected Result: 过滤后仍满足 regular-input 非负语义
    Evidence: .sisyphus/evidence/task-T3-filtered-overview.json
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-T3-overview.json`
  - [ ] `.sisyphus/evidence/task-T3-filtered-overview.json`

  **Commit**: YES（与 T2/T4/T5 合并）

- [x] T4. Time-Series Aggregation Update（小时序列 inputTokens 切换 regular-input）

  **What to do**:
  - 更新 `byHourPromise.inputTokens` 为 regular-input 聚合，确保图表数据源语义一致。
  - 校验 `byHour` mapping 仍输出 `inputTokens` 字段（字段名不变，语义改变）。

  **Must NOT do**:
  - 不改 `byHour.tokens`（总 token）语义。
  - 不改 `byHour.cachedTokens` 原值。

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `playwright`: 本任务聚焦后端聚合。

  **Parallelization**:
  - **Can Run In Parallel**: NO（依赖 T2）
  - **Parallel Group**: Wave 1（串行依赖 T2）
  - **Blocks**: T8, T9, T11
  - **Blocked By**: T2

  **References**:
  - `lib/queries/overview.ts:194-209` - byHour 聚合定义。
  - `lib/queries/overview.ts:322-334` - byHour 返回映射。
  - `app/page.tsx:1863-1866,2603-2613` - 小时图消费 `inputTokens`。

  **Acceptance Criteria**:
  - [ ] `overview.byHour[].inputTokens` 全部为非负 regular-input。
  - [ ] `overview.byHour[].cachedTokens` 保持原语义可用于对照。

  **QA Scenarios**:
  ```
  Scenario: byHour regular-input 生效
    Tool: Bash (curl)
    Preconditions: 本地服务已启动
    Steps:
      1. curl -s "http://localhost:3000/api/overview?days=7&skipCache=1" > .sisyphus/evidence/task-T4-hourly.json
      2. jq -e '([.overview.byHour[].inputTokens] | all(. >= 0))' .sisyphus/evidence/task-T4-hourly.json
      3. jq -e '([.overview.byHour[].cachedTokens] | all(. >= 0))' .sisyphus/evidence/task-T4-hourly.json
    Expected Result: input/cached 全为非负，接口 200
    Failure Indicators: inputTokens 出现负值或字段缺失
    Evidence: .sisyphus/evidence/task-T4-hourly.json

  Scenario: 空数据时间窗边界
    Tool: Bash (curl)
    Preconditions: 允许选择无数据时间范围
    Steps:
      1. 请求一个预计为空的 start/end 区间
      2. 断言返回结构有效且不会抛错
    Expected Result: 返回空数组或零值结构，不出现 500
    Evidence: .sisyphus/evidence/task-T4-hourly-empty.json
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-T4-hourly.json`
  - [ ] `.sisyphus/evidence/task-T4-hourly-empty.json`

  **Commit**: YES（与 T2/T3/T5 合并）

- [x] T5. Cost Regression Guard（防止 cost 二次扣减）

  **What to do**:
  - 在 `byModel` 聚合中保留原始 input 聚合（例如 `rawInputTokens`）用于 cost 计算。
  - 展示字段 `inputTokens` 使用 regular-input，cost 计算继续使用 raw-input + cached（与 `estimateCost` 当前契约一致）。
  - 复核 `byDayModelRows` 的成本路径不被本次语义切换破坏。

  **Must NOT do**:
  - 不改 `estimateCost()` 函数公式。
  - 不让 `cost` 依赖已经 regular 化后的 `inputTokens` 再次减 cached。

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `playwright`: 非 UI。

  **Parallelization**:
  - **Can Run In Parallel**: NO（依赖 T2）
  - **Parallel Group**: Wave 1
  - **Blocks**: T11, T13
  - **Blocked By**: T2

  **References**:
  - `lib/queries/overview.ts:278-296` - 模型 cost 计算当前取值来源。
  - `lib/queries/overview.ts:299-312` - 日成本映射逻辑。
  - `lib/usage.ts:176-190` - `estimateCost` 对 raw-input/cached 的输入要求。

  **Acceptance Criteria**:
  - [ ] 修改后 cost 与修改前同数据集下不发生异常突降（无二次扣减）。
  - [ ] `models[].inputTokens` 可显示 regular-input，同时 `models[].cost` 维持既有计算口径。

  **QA Scenarios**:
  ```
  Scenario: cost 口径未回归
    Tool: Bash (curl)
    Preconditions: 可访问 /api/overview
    Steps:
      1. 请求 /api/overview?days=7&skipCache=1 并保存响应
      2. 断言 totalCost >= 0 且 models[].cost 全为有限数值
      3. 抽查 cachedTokens>0 的模型，确认其 cost 非异常归零
    Expected Result: cost 字段稳定、无系统性异常下降
    Failure Indicators: 多数模型 cost 突然接近 0 或出现 NaN/null
    Evidence: .sisyphus/evidence/task-T5-cost-guard.json

  Scenario: 双扣减防线（失败路径）
    Tool: Bash (curl + jq)
    Preconditions: 结果中存在 cachedTokens>0 模型
    Steps:
      1. 选取 cachedTokens>0 且 outputTokens>0 的模型
      2. 若该模型 cost 为 0 且 tokens 明显非零，则标记失败
    Expected Result: 不出现双扣减导致的异常零成本
    Evidence: .sisyphus/evidence/task-T5-cost-guard-error.json
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-T5-cost-guard.json`
  - [ ] `.sisyphus/evidence/task-T5-cost-guard-error.json`

  **Commit**: YES（与 T2/T3/T4 合并）

- [x] T6. Type Contract Sync（类型契约语义同步）

  **What to do**:
  - 在 `lib/types.ts` 对 `totalInputTokens`、`ModelUsage.inputTokens`、`UsageSeriesPoint.inputTokens` 补充语义说明（regular-input）。
  - 保持字段名兼容，避免改动 API consumers 的字段读取代码。

  **Must NOT do**:
  - 不进行全局字段改名。
  - 不引入与首页无关的新契约字段。

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: 非视觉重构任务。

  **Parallelization**:
  - **Can Run In Parallel**: NO（依赖 T3）
  - **Parallel Group**: Wave 2
  - **Blocks**: T7, T8, T9
  - **Blocked By**: T3

  **References**:
  - `lib/types.ts:8-45` - `UsageOverview`/`ModelUsage`/`UsageSeriesPoint` 定义。
  - `app/api/overview/route.ts:87-101` - overview payload 输出路径。

  **Acceptance Criteria**:
  - [ ] 类型定义或注释明确 inputTokens 在 overview 场景为 regular-input 语义。
  - [ ] API 字段名保持兼容（`inputTokens`/`totalInputTokens` 不变）。

  **QA Scenarios**:
  ```
  Scenario: 契约语义可读且兼容
    Tool: Bash
    Preconditions: 代码已修改
    Steps:
      1. grep -n "totalInputTokens\|inputTokens" lib/types.ts > .sisyphus/evidence/task-T6-types.txt
      2. 检查证据中存在 regular-input 语义注释/说明
      3. 检查未新增破坏性重命名字段
    Expected Result: 语义清晰且字段兼容
    Failure Indicators: 字段被重命名或无语义说明
    Evidence: .sisyphus/evidence/task-T6-types.txt

  Scenario: API 兼容性（失败路径）
    Tool: Bash (curl)
    Preconditions: 服务运行
    Steps:
      1. 请求 /api/overview?skipCache=1
      2. 断言 overview.totalInputTokens 与 overview.byHour[].inputTokens 字段仍存在
    Expected Result: 兼容字段存在
    Evidence: .sisyphus/evidence/task-T6-api-compat.json
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-T6-types.txt`
  - [ ] `.sisyphus/evidence/task-T6-api-compat.json`

  **Commit**: YES（与 T7/T8/T9/T10 合并）

- [x] T7. KPI Cards + Copy Update（卡片与文案更新）

  **What to do**:
  - 更新首页 Tokens 卡片中“输入”文案，明确为 regular-input（建议：`输入(不含缓存)`）。
  - 保证 `overviewData.totalInputTokens` 在 UI 中对应 regular-input 新语义。

  **Must NOT do**:
  - 不修改总 tokens、输出 tokens、思考 tokens、缓存 tokens 的既有定义。
  - 不改与输入 token 无关的视觉主题逻辑。

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: 保障文案/可读性与现有面板风格一致。
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: 不做大规模视觉重做。

  **Parallelization**:
  - **Can Run In Parallel**: YES（依赖满足后可与 T8/T9 并行）
  - **Parallel Group**: Wave 2
  - **Blocks**: T12
  - **Blocked By**: T1, T3, T6

  **References**:
  - `app/page.tsx:1346-1369` - Tokens 卡片字段展示。
  - `lib/types.ts:30-36` - totalInputTokens 契约来源。

  **Acceptance Criteria**:
  - [ ] KPI 文案可区分 raw input 与 regular-input（避免歧义）。
  - [ ] 显示值来自已 regular 化的 `totalInputTokens`。

  **QA Scenarios**:
  ```
  Scenario: KPI 文案与数值显示正确
    Tool: Playwright
    Preconditions: 本地站点可访问，已登录到 Dashboard
    Steps:
      1. 打开首页并等待 Tokens 卡片渲染
      2. 定位 Tokens 卡片中的输入行（selector: 包含“输入(不含缓存)”文本）
      3. 断言该行数值为数字格式（含千分位可选）
    Expected Result: 文案为 regular-input 含义，数值可见
    Failure Indicators: 仍显示旧文案“输入”且无语义澄清
    Evidence: .sisyphus/evidence/task-T7-kpi.png

  Scenario: 缺失数据边界
    Tool: Playwright
    Preconditions: 切换到空数据时间窗
    Steps:
      1. 设置无数据区间
      2. 断言 Tokens 卡片不崩溃且输入行显示 0 或合理占位
    Expected Result: 页面稳定，无 NaN/undefined
    Evidence: .sisyphus/evidence/task-T7-kpi-empty.png
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-T7-kpi.png`
  - [ ] `.sisyphus/evidence/task-T7-kpi-empty.png`

  **Commit**: YES（与 T6/T8/T9/T10 合并）

- [x] T8. Normal Dashboard Charts Update（普通视图图表切换）

  **What to do**:
  - 更新普通小时图中输入 token 系列文案（例如“输入(不含缓存)”）。
  - 校验 tooltip/legend/keyMap 中 inputTokens 的显示名称与语义同步。
  - 保持 `dataKey="inputTokens"`（兼容字段名），仅改语义与标签。

  **Must NOT do**:
  - 不改 requests/tokens/cost 的轴映射逻辑。
  - 不移除 cachedTokens 系列（作为对照仍保留）。

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]
  - **Skills Evaluated but Omitted**:
    - `web-design-guidelines`: 本任务主要是语义一致性非全面 UI 审计。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T12
  - **Blocked By**: T1, T3, T4, T6

  **References**:
  - `app/page.tsx:1787-1866` - 普通小时图 order/keyMap/legend/Bar 系列。
  - `app/page.tsx:1832-1859` - 中文标签到 dataKey 映射。
  - `lib/queries/overview.ts:322-334` - byHour inputTokens 数据来源。

  **Acceptance Criteria**:
  - [ ] 普通视图所有 inputTokens 文案均反映 regular-input。
  - [ ] 图例、tooltip、图形 series 三处命名一致。

  **QA Scenarios**:
  ```
  Scenario: 普通视图图例/tooltip/系列一致
    Tool: Playwright
    Preconditions: 首页正常加载
    Steps:
      1. 定位普通小时图 legend，断言存在“输入(不含缓存)”项
      2. hover 柱状图点位，断言 tooltip 文案同样为 regular-input 命名
      3. 截图保存
    Expected Result: 三处一致，无旧“输入”歧义文案
    Failure Indicators: legend 与 tooltip 命名不一致
    Evidence: .sisyphus/evidence/task-T8-normal-chart.png

  Scenario: 图层开关边界
    Tool: Playwright
    Preconditions: 图例可切换
    Steps:
      1. 隐藏/显示 inputTokens 系列两次
      2. 断言图表无崩溃且其余系列正常
    Expected Result: 切换稳定，状态保持
    Evidence: .sisyphus/evidence/task-T8-normal-chart-toggle.png
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-T8-normal-chart.png`
  - [ ] `.sisyphus/evidence/task-T8-normal-chart-toggle.png`

  **Commit**: YES（与 T6/T7/T9/T10 合并）

- [x] T9. Fullscreen Charts Update（全屏视图图表切换）

  **What to do**:
  - 更新全屏小时图（Area/Bar）中 inputTokens 系列命名为 regular-input 语义。
  - 同步全屏 tooltip/legend 的 keyMap、排序与颜色映射文案。

  **Must NOT do**:
  - 不改变全屏图默认展示模式（bar/area）与交互逻辑。
  - 不改 output/reasoning/cached 系列语义。

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]
  - **Skills Evaluated but Omitted**:
    - `playwright`: 本任务本身是实现，自动化放到 T12。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T12
  - **Blocked By**: T1, T4, T6

  **References**:
  - `app/page.tsx:2525-2613` - 全屏小时图 order/keyMap/legend/Area/Bar。
  - `app/page.tsx:2570-2597` - 全屏中文标签与 dataKey 对应。
  - `lib/queries/overview.ts:322-334` - byHour inputTokens 数据源。

  **Acceptance Criteria**:
  - [ ] 全屏视图 inputTokens 命名与普通视图一致（regular-input）。
  - [ ] 全屏 tooltip + legend + series 文案一致。

  **QA Scenarios**:
  ```
  Scenario: 全屏图语义与普通图一致
    Tool: Playwright
    Preconditions: 可进入全屏模式
    Steps:
      1. 打开全屏图
      2. 断言 legend 含“输入(不含缓存)”条目
      3. hover 图形点位，断言 tooltip 使用一致命名
    Expected Result: 全屏图命名与普通图一致
    Failure Indicators: 全屏仍是旧命名或与普通图不一致
    Evidence: .sisyphus/evidence/task-T9-fullscreen-chart.png

  Scenario: 全屏切换模式边界
    Tool: Playwright
    Preconditions: 全屏支持 bar/area 切换
    Steps:
      1. 在全屏切换 bar/area 模式
      2. 分别断言 inputTokens 系列命名一致
    Expected Result: 两种模式均正确显示 regular-input 命名
    Evidence: .sisyphus/evidence/task-T9-fullscreen-chart-toggle.png
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-T9-fullscreen-chart.png`
  - [ ] `.sisyphus/evidence/task-T9-fullscreen-chart-toggle.png`

  **Commit**: YES（与 T6/T7/T8/T10 合并）

- [x] T10. Changelog Update（更新变更日志）

  **What to do**:
  - 按仓库规则更新 `CHANGELOG.md`（中文、按日期、简述改动与作用）。
  - 记录“首页输入 tokens 改为 regular-input 展示语义，保持 cost 口径不变”。

  **Must NOT do**:
  - 不遗漏行为变更说明。
  - 不写入与本任务无关的大段历史。

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: 纯文档任务。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: F1
  - **Blocked By**: None

  **References**:
  - `CHANGELOG.md` - 仓库统一变更记录位置。
  - `.github/copilot-instructions.md` 最后一条 - 要求功能行为变更后同步更新 CHANGELOG。

  **Acceptance Criteria**:
  - [ ] CHANGELOG 有当日新增条目，包含“改动内容 + 作用”。
  - [ ] 文案为中文且表述准确。

  **QA Scenarios**:
  ```
  Scenario: CHANGELOG 条目存在
    Tool: Bash
    Preconditions: 已更新 CHANGELOG.md
    Steps:
      1. grep -n "regular-input\|输入\(不含缓存\)\|首页" CHANGELOG.md > .sisyphus/evidence/task-T10-changelog.txt
      2. 断言至少命中 1 条新记录
    Expected Result: 变更日志可检索到本次改动
    Failure Indicators: 无对应条目
    Evidence: .sisyphus/evidence/task-T10-changelog.txt

  Scenario: 格式规范检查
    Tool: Bash
    Preconditions: CHANGELOG 已更新
    Steps:
      1. 检查新增条目是否位于当日日期分组下
      2. 若不在日期分组或非中文简述则失败
    Expected Result: 满足仓库约定格式
    Evidence: .sisyphus/evidence/task-T10-changelog-format.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-T10-changelog.txt`
  - [ ] `.sisyphus/evidence/task-T10-changelog-format.txt`

  **Commit**: YES（与 T6-T9 合并）

- [x] T11. API Verification Pack（API 口径断言包）

  **What to do**:
  - 编排一组 `curl + jq` 断言，验证 `overview.totalInputTokens` 与 `byHour[].inputTokens` 的非负 regular-input 语义。
  - 覆盖 `skipCache=1`、分页、筛选参数（model/route/name）场景。

  **Must NOT do**:
  - 不用人工肉眼判断 JSON。
  - 不忽略缓存影响（必须使用 `skipCache=1`）。

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `playwright`: 纯 API 验证。

  **Parallelization**:
  - **Can Run In Parallel**: YES（Wave 3）
  - **Parallel Group**: Wave 3（与 T12/T13 协同）
  - **Blocks**: T13, F1
  - **Blocked By**: T3, T4, T5

  **References**:
  - `app/api/overview/route.ts:77-101` - `skipCache` 与 payload 输出路径。
  - `lib/queries/overview.ts:342-356` - overview 最终字段映射。

  **Acceptance Criteria**:
  - [ ] 核心断言命令全部返回 exit 0。
  - [ ] 证据中包含默认、筛选、分页三类响应样本。

  **QA Scenarios**:
  ```
  Scenario: 默认查询口径正确
    Tool: Bash (curl + jq)
    Preconditions: 服务运行，存在基础数据
    Steps:
      1. curl -s "http://localhost:3000/api/overview?days=7&skipCache=1" > .sisyphus/evidence/task-T11-default.json
      2. jq -e '.overview.totalInputTokens >= 0' .sisyphus/evidence/task-T11-default.json
      3. jq -e '([.overview.byHour[].inputTokens] | all(. >= 0))' .sisyphus/evidence/task-T11-default.json
    Expected Result: 所有断言通过
    Failure Indicators: 非负断言失败或字段缺失
    Evidence: .sisyphus/evidence/task-T11-default.json

  Scenario: 分页与过滤边界
    Tool: Bash (curl + jq)
    Preconditions: filters 可用
    Steps:
      1. 请求 page/pageSize 与 model 过滤组合
      2. 断言字段存在且 inputTokens 非负
    Expected Result: 不因分页/过滤破坏语义
    Evidence: .sisyphus/evidence/task-T11-filter-page.json
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-T11-default.json`
  - [ ] `.sisyphus/evidence/task-T11-filter-page.json`

  **Commit**: NO（验证证据不单独提交代码）

- [x] T12. UI Verification Pack（首页可视化自动化验证）

  **What to do**:
  - 用 Playwright 覆盖普通视图 + 全屏视图，验证输入 token 文案与 tooltip/legend 一致。
  - 验证图层开关、空数据区间、切换模式不崩溃。

  **Must NOT do**:
  - 不使用“人工点点看”作为验收标准。
  - 不省略 fullscreen 场景。

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`playwright`]
    - `playwright`: 必须用于浏览器自动化验证。
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: 非设计任务。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: F3, F4
  - **Blocked By**: T7, T8, T9

  **References**:
  - `app/page.tsx:1346-1369` - KPI 输入 token 展示。
  - `app/page.tsx:1832-1866` - 普通图 tooltip/legend/series。
  - `app/page.tsx:2570-2613` - 全屏图 tooltip/legend/series。

  **Acceptance Criteria**:
  - [ ] 普通图 + 全屏图均存在 regular-input 命名。
  - [ ] tooltip/legend/series 命名一致。
  - [ ] 空数据和开关切换无错误。

  **QA Scenarios**:
  ```
  Scenario: 普通图验证（happy path）
    Tool: Playwright
    Preconditions: 登录后进入首页
    Steps:
      1. 等待普通小时图渲染完成
      2. 断言 legend 包含“输入(不含缓存)”
      3. hover 任一数据点并断言 tooltip 使用一致命名
    Expected Result: 文案一致且可视化正常
    Failure Indicators: 文案不一致或 tooltip 缺失
    Evidence: .sisyphus/evidence/task-T12-ui-normal.png

  Scenario: 全屏图+空数据边界（error/edge）
    Tool: Playwright
    Preconditions: 可进入全屏并可切换时间范围
    Steps:
      1. 进入全屏并断言 legend 命名一致
      2. 切到空数据时间范围，断言页面无崩溃且占位文案正常
    Expected Result: 全屏和空数据场景均稳定
    Evidence: .sisyphus/evidence/task-T12-ui-fullscreen-empty.png
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-T12-ui-normal.png`
  - [ ] `.sisyphus/evidence/task-T12-ui-fullscreen-empty.png`

  **Commit**: NO（自动化证据归档）

- [x] T13. Build/Lint Regression Gate（质量闸门）

  **What to do**:
  - 执行 `pnpm lint` 与 `pnpm build`，确保本次语义切换未引入类型或构建回归。
  - 归档命令输出到证据目录。

  **Must NOT do**:
  - 不跳过失败项。
  - 不在失败状态下推进 Final Wave。

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `playwright`: 纯构建质量闸门。

  **Parallelization**:
  - **Can Run In Parallel**: YES（在 T11 完成后执行）
  - **Parallel Group**: Wave 3
  - **Blocks**: F2, F4
  - **Blocked By**: T5, T11

  **References**:
  - `package.json:6-13` - lint/build 脚本定义。

  **Acceptance Criteria**:
  - [ ] `pnpm lint` exit 0。
  - [ ] `pnpm build` exit 0。

  **QA Scenarios**:
  ```
  Scenario: lint/build 全通过
    Tool: Bash
    Preconditions: 依赖安装完成
    Steps:
      1. pnpm lint | tee .sisyphus/evidence/task-T13-lint.txt
      2. pnpm build | tee .sisyphus/evidence/task-T13-build.txt
      3. 检查两个命令退出码均为 0
    Expected Result: lint/build 全部通过
    Failure Indicators: 任一命令非 0 退出
    Evidence: .sisyphus/evidence/task-T13-build-lint.txt

  Scenario: 失败回放（error path）
    Tool: Bash
    Preconditions: 若发生失败
    Steps:
      1. 收集失败命令与首个错误堆栈行
      2. 输出到证据文件供回归定位
    Expected Result: 错误可复现、可定位
    Evidence: .sisyphus/evidence/task-T13-build-lint-error.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-T13-lint.txt`
  - [ ] `.sisyphus/evidence/task-T13-build.txt`
  - [ ] `.sisyphus/evidence/task-T13-build-lint-error.txt`（若失败）

  **Commit**: NO（闸门任务）

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

- [ ] F1. **Plan Compliance Audit** — `oracle`
  - 校验 Must Have / Must NOT Have / 任务证据文件完整性。
  - 输出：`Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  - 执行 `pnpm lint`、`pnpm build`，检查坏味道与类型/编译回归。
  - 输出：`Build [PASS/FAIL] | Lint [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA (agent-executed)** — `unspecified-high` (+ `playwright`)
  - 按各任务 QA 场景逐条执行并留证据到 `.sisyphus/evidence/final-qa/`。
  - 输出：`Scenarios [N/N] | Integration [N/N] | Edge Cases [N] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  - 按任务规格逐项对照变更，识别越界改动与遗漏。
  - 输出：`Tasks [N/N compliant] | Contamination [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

- **Commit A (Wave1)**: `refactor(overview): switch input token display semantics to regular-input aggregation`
  - Files: `lib/queries/overview.ts`
  - Pre-commit: `pnpm lint`

- **Commit B (Wave2)**: `feat(dashboard): align input token visuals with regular-input semantics`
  - Files: `app/page.tsx`, `lib/types.ts`, `CHANGELOG.md`
  - Pre-commit: `pnpm lint`

- **Commit C (Wave3)**: `chore(qa): add verification evidence for regular-input dashboard behavior`
  - Files: `.sisyphus/evidence/*`（由执行阶段生成）
  - Pre-commit: `pnpm build`

---

## Success Criteria

### Verification Commands
```bash
pnpm lint
# Expected: exit code 0

pnpm build
# Expected: build succeeds without type/runtime compilation errors

curl -s "http://localhost:3000/api/overview?days=7&skipCache=1" | jq -e '.overview.totalInputTokens >= 0'
# Expected: true

curl -s "http://localhost:3000/api/overview?days=7&page=1&pageSize=500&skipCache=1" | jq -e '([.overview.models[].inputTokens] | all(. >= 0)) and ([.overview.byHour[].inputTokens] | all(. >= 0))'
# Expected: true
```

### Final Checklist
- [ ] All Must Have present
- [ ] All Must NOT Have absent
- [ ] Homepage dashboard input-token surfaces all migrated
- [ ] Lint/build pass
- [ ] Evidence files complete
