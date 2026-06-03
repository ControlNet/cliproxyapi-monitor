# 用户级 Dashboard 实施计划

## TL;DR
> **Summary**: 在保留当前管理员看板 `/`、`/records`、`/explore`、`/logs` 不变的前提下，保留统一 `/login` 登录入口，但在服务端区分管理员密码与普通用户 service key；复用现有 DB 查询层，把“用户身份范围”从客户端传参改为服务端从登录 key 推导并强制注入。
> **Deliverables**:
> - 独立用户登录 / 会话 / 路由树
> - 用户范围化的 overview / records / quota 只读接口
> - 用户主页（卡片 + 趋势图 + 可选全局聚合切换 + 可选 quota 面板）
> - 用户记录页（自动服务端过滤、隐藏 key/credential）
> - 明确的管理员/用户边界与防泄漏保护
> **Effort**: Large
> **Parallel**: YES - 3 waves
> **Critical Path**: 1 → 2 → 4/5/6 → 7/8 → F1-F4

## Context
### Original Request
- 先彻底阅读仓库，再只输出实施计划，不开始编码。
- 设计一个全新的用户级 dashboard，建立在现有管理员 dashboard 之上。
- 需要明确认证、路由过滤、records / overview / charts / quota / logs API 现状；说明哪些可复用、哪些要改、哪些绝不能暴露给普通用户。

### Interview Summary
- 当前仓库不是现成的多用户隔离模式，而是 **单一管理员密码 + 共享 cookie** 模式；本计划改为保留统一 `/login` 入口，但拆分 admin/user session 与路由放行逻辑。
- 可复用主轴不是现有根页面 `app/page.tsx`，而是 DB 查询层：`lib/queries/overview.ts`、`lib/queries/records.ts`、`lib/queries/explore.ts`。
- `usage_records.route` 已被同步链路持久化，且就是当前 records 页面显示的“密钥”列；因此可作为“登录 key 派生身份”的最小变更范围键。
- `authIndex` 与 `auth_file_mappings` 适合作为辅助映射/补充信息，但 **v1 不作为访问控制主边界**。
- logs / usage-statistics toggle / sync / price 管理 / management URL 都属于管理员/运维面，不应进入普通用户模式。
- quota 面板在本仓库不存在；若要做，必须新增用户安全 DTO，并以服务端调用上游 quota 能力为准，而不是从本地 usage DB 反推。

### Metis Review (gaps addressed)
- 已补上关键防线：用户接口不得接受客户端 `route` / `name` / `source` 作为身份范围。
- 已识别高风险点：`/api/overview`、`/api/explore` 现有缓存不含用户身份，直接复用会产生跨用户缓存泄漏。
- 已收敛 scope：不引入通用 RBAC、不重构管理员看板、不把 logs/ops 面做成用户可见、不把“真实 quota 管控”扩展成配额治理系统。
- 已明确 quota 范围：只做安全摘要，不暴露 auth file 名称、邮箱、account JSON name、id_token、原始 provider 响应。

## Work Objectives
### Core Objective
在现有管理员看板旁边增加一套 **独立用户模式**：所有人都经由统一 `/login` 登录；服务端判定是管理员密码还是普通用户 service key，并写入不同 session。普通用户明细数据一律由服务端按 session-derived route 强制过滤；用户可查看自己的汇总卡片、趋势图、调用记录，以及在环境变量允许时查看全局聚合统计和安全 quota 摘要。

### Deliverables
- 保留统一登录入口：`/login`
- 新增用户视图树：`/user`、`/user/records`
- 新增用户认证/会话层与 middleware 区分（与管理员 session 并行存在）
- 新增用户 overview API（self/global 两种只读模式）
- 新增用户 records API（仅 self，隐藏敏感列）
- 新增可选用户 quota API + quota panel（仅安全摘要）
- 用户导航与布局组件
- 管理员/用户边界清单与缓存隔离策略

### Definition of Done (verifiable conditions with commands)
- `pnpm run lint` 通过。
- `pnpm run build` 通过。
- 普通用户登录后访问 `/user` 与 `/user/records` 成功，访问管理员页 `/`、`/records`、`/explore`、`/logs` 被拒绝或重定向到管理员登录。
- 普通用户接口在篡改 `route` / `name` / `source` 查询参数时，返回结果仍仅包含当前 session 对应 key 的数据。
- `ALLOW_USER_SEE_TOTAL_USAGE=false` 时，用户 UI 与接口都不存在全局聚合入口。
- `ALLOW_USER_SEE_TOTAL_USAGE=true` 时，用户只能看到聚合卡片/趋势，不会得到 routes / names / sources / records 明细。
- `ALLOW_USER_SEE_QUOTA=true` 时，quota 面板仅返回安全摘要字段，不返回 account JSON name、auth_index、name、email、id_token、provider 原始 payload。

### Must Have
- 管理员模式与用户模式完全分离。
- 用户身份来自登录 key，用户明细范围以服务端 session 内的 `route` 为准。
- 所有用户详细查询都忽略客户端身份维度传参。
- records 页面隐藏 key 列与 credential 列。
- 全局统计视图只影响 summary/charts，不影响 records。
- 新 env flags 默认关闭：`ALLOW_USER_SEE_TOTAL_USAGE=false`、`ALLOW_USER_SEE_QUOTA=false`。

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- 不能把 `/api/logs`、`/api/request-error-logs`、`/api/sync`、`/api/reset`、`/api/sync-model-prices`、`/api/usage-statistics-enabled`、`/api/management-url` 暴露到用户模式。
- 不能依赖前端隐藏列来做权限隔离。
- 不能复用管理员 payload 后再在前端删字段。
- 不能让用户接口继续接受并信任任意 `route` / `name` / `source`。
- 不能直接复用身份无关 cache key。
- 不能为此任务引入新的 ownership/user schema，除非在实现时发现 `route` 无法稳定映射登录 key；v1 默认不做 DB redesign。

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: **tests-after（不新增完整测试框架作为前置条件）**；以 `pnpm run lint`、`pnpm run build`、直接 API 验证、Playwright 端到端场景为主。
- QA policy: 每个任务自带 happy path + failure/edge case。
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`
- TPM 口径：**严格沿用当前管理员首页实现**，即 `平均 TPM = overviewData.totalTokens / actualTimeSpan.minutes`；其中 `actualTimeSpan.minutes` 取 `overview.byHour` 中最早时间点到当前时刻的分钟数，若 `byHour` 为空则回退为 `appliedDays * 24 * 60`。实现参考：`app/page.tsx:1161-1191,1787-1793`。

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: 认证与边界基础（用户 session、proxy 分流、共享 query/refactor、安全 DTO）
Wave 2: 用户产品面（overview 卡片/图表、records、quota、布局导航）
Wave 3: 收口与防泄漏修正（env gating、缓存隔离、admin/user 边界回归）

### Dependency Matrix (full, all tasks)
| Task | Depends On | Enables |
|---|---|---|
| 1 | - | 2, 3, 4, 6, 7 |
| 2 | 1 | 4, 5, 6, 7, 8 |
| 3 | 1 | 4, 5, 6 |
| 4 | 2, 3 | 5 |
| 5 | 2, 3, 4 | 8 |
| 6 | 2, 3 | 8 |
| 7 | 2 | 8 |
| 8 | 5, 6, 7 | F1-F4 |

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 3 tasks → `deep`, `unspecified-high`
- Wave 2 → 4 tasks → `deep`, `visual-engineering`
- Wave 3 → 1 task → `unspecified-high`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. 改造统一登录入口并建立分离的 admin/user 会话基础

  **What to do**: 保留统一 `/login` 页面与统一认证入口 `/api/auth/verify`，把它改造成“同一输入框 + 服务端分流认证”：
  1) 若提交凭证命中管理员密码，写入 admin cookie/session，并返回 `role=admin`、跳转 `/`
  2) 否则把该凭证当作 CLIProxyAPI service key，服务端调用上游 `/v1/models` 做真值校验；成功后写入 **独立于管理员 cookie** 的 user session，并把 session 主身份定义为 `route = submitted key`，返回 `role=user`、跳转 `/user`
  3) 登录页根据服务端返回 role 决定跳转
  用户 session 读取逻辑必须集中到单一 helper，后续所有 user API 只从该 helper 取 `route`。
  **Must NOT do**: 不复用 `dashboard_auth` 作为用户 cookie；不新增第二个登录 URL；不把原始 key 以明文可读形式暴露给前端 JS；不通过本地 DB 历史记录判定 key 是否有效；不把 `authIndex` 作为 v1 登录主身份。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 涉及会话模型、上游校验、后续所有用户接口的信任根。
  - Skills: `[]` - 当前任务以仓库内现有模式和服务端逻辑为主。
  - Omitted: [`ui-ux-pro-max`] - 非界面主任务。

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 4, 6, 7 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `proxy.ts:7-10,22-27,80-108` - 当前管理员 cookie 与路由保护逻辑；用户模式必须并行存在而不是覆盖。
  - Pattern: `app/api/auth/verify/route.ts:54-107` - 当前管理员认证入口与写 cookie 的模式；本任务直接在此入口上做 admin/user 分流。
  - Pattern: `app/login/page.tsx:41-77` - 当前统一登录页提交流程；保留此页面，只改文案、返回处理与 role-based redirect。
  - External API pattern: `app/api/sync-model-prices/route.ts:158-165` - 已存在通过 `baseUrlWithoutManagement + /v1/models` 携带 Bearer key 调用上游的实现。
  - Config: `lib/config.ts:26-40` - 当前 env 入口；新增用户功能开关与 session secret 也应从该层归口。
  - Logout: `app/api/auth/logout/route.ts:1-7` - 现有退出仅删除管理员 cookie；需改为可同时清理 admin/user cookie，或按当前角色清理对应 cookie。

  **Acceptance Criteria** (agent-executable only):
  - [ ] 统一 `/api/auth/verify` 在管理员密码与普通用户 key 两种输入下都能返回正确角色与跳转目标。
  - [ ] 普通用户 key 登录成功时写入独立 httpOnly 用户 cookie，管理员密码登录成功时继续写管理员 cookie。
  - [ ] 无效凭证返回 401/4xx，且不会写入任何有效登录 cookie。
  - [ ] 用户 session helper 能稳定返回 `route`，供后续 user API 直接复用。
  - [ ] 用户 cookie 名称、生命周期、清理流程与管理员 cookie 分离，但登录入口 URL 保持统一。

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: 统一登录入口识别普通用户 key
    Tool: Bash
    Steps: 1) 启动本地服务 2) 执行 `curl -i -c .sisyphus/evidence/task-1-user-auth.cookies -X POST http://127.0.0.1:3000/api/auth/verify -H 'Authorization: Basic '"$(printf ':%s' "$TEST_USER_KEY" | base64 -w0)"` 3) 保存响应到 `.sisyphus/evidence/task-1-user-auth.txt`
    Expected: 返回 200；响应头包含用户专用 httpOnly cookie；响应体给出 `role=user` 或等价信号；不回显原始 key
    Evidence: .sisyphus/evidence/task-1-user-auth.txt

  Scenario: 统一登录入口识别管理员密码
    Tool: Bash
    Steps: 执行 `curl -i -c .sisyphus/evidence/task-1-admin-auth.cookies -X POST http://127.0.0.1:3000/api/auth/verify -H 'Authorization: Basic '"$(printf ':%s' "$TEST_ADMIN_PASSWORD" | base64 -w0)"` 并保存输出
    Expected: 返回 200；写入管理员 cookie；响应体给出 `role=admin` 或等价信号
    Evidence: .sisyphus/evidence/task-1-admin-auth.txt

  Scenario: 无效凭证被拒绝
    Tool: Bash
    Steps: 执行 `curl -i -X POST http://127.0.0.1:3000/api/auth/verify -H 'Authorization: Basic '"$(printf ':%s' 'invalid-test-key' | base64 -w0)"` 并保存输出
    Expected: 返回 401 或明确 4xx；不写入有效 cookie；错误信息不暴露上游内部细节
    Evidence: .sisyphus/evidence/task-1-user-auth-error.txt
  ```

  **Commit**: YES | Message: `feat(auth): unify login entry and split admin user sessions` | Files: `app/login/page.*`, `app/api/auth/*`, `lib/config.ts`, `lib/user-session.*`, `proxy.ts`

- [x] 2. 分离管理员与用户路由保护、布局与导航骨架

  **What to do**: 在不破坏现有管理员根路由的前提下，新增独立用户路由树（固定使用 `/user` 前缀）与用户专用 layout/sidebar。更新 `proxy.ts`：`/login` + `/api/auth/*` 作为**统一公共登录入口**；`/user*` 仅接受用户 session，`/`、`/records`、`/explore`、`/logs` 仅接受管理员 session。未登录访问 `/user*` 时统一重定向到 `/login?from=/user...`；登录成功后按服务端 role 决定跳转 `/` 或 `/user`。用户导航只包含用户仪表盘与用户记录页；不得出现 logs、sync、usage toggle、CPAMC 链接。
  **Must NOT do**: 不在现有 `app/page.tsx` 内用条件分支硬塞用户模式；不让管理员 cookie 自动通过用户路由；不让用户 cookie 自动通过管理员路由；不再新增 `/user/login` 页面。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 涉及 middleware/路由边界与整体页面骨架。
  - Skills: [`ui-ux-pro-max`] - 需要做最小但清晰的用户导航与页面信息架构。
  - Omitted: [`frontend-claude`] - 不需要重设计为强视觉作品。

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4, 5, 6, 7, 8 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `app/layout.tsx:10-15` - 当前全局 layout 只包了一个 `ClientLayout`。
  - Pattern: `app/components/ClientLayout.tsx:7-32` - 当前只对 `/login` 隐藏 Sidebar；用户模式需要新的分流策略。
  - Pattern: `app/components/Sidebar.tsx:9-14,25-37,43-80,127-156` - 现有侧边栏混合了管理员导航与运维开关，普通用户不能复用原 Sidebar。
  - Guard: `proxy.ts:22-27,84-108` - 当前仅有管理员模式；需要扩展为统一登录入口 + admin/user 两套鉴权分流。

  **Acceptance Criteria** (agent-executable only):
  - [ ] 未登录用户访问 `/user` 会被重定向到统一 `/login`。
  - [ ] 仅持有用户 cookie 时访问 `/`、`/records`、`/explore`、`/logs` 不会进入管理员页面。
  - [ ] 用户 Sidebar 中没有日志、CPAMC、上游使用统计 toggle、同步/价格管理入口。
  - [ ] 管理员现有入口 `/login` 与管理员页面行为保持不变。

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: 统一登录入口下用户路由与管理员路由完全分离
    Tool: Playwright
    Steps: 1) 清空 cookies 2) 打开 `/user` 3) 断言跳转到 `/login` 4) 使用测试 key 登录 5) 访问 `/user` 成功 6) 直接访问 `/logs`
    Expected: `/user` 可访问；`/logs` 被拒绝或重定向到管理员登录；用户导航中无“日志/前往 CPAMC/上游使用统计”
    Evidence: .sisyphus/evidence/task-2-route-separation.png

  Scenario: 管理员 cookie 不能误穿透用户模式
    Tool: Playwright
    Steps: 1) 仅用管理员密码登录 `/login` 2) 直接访问 `/user`
    Expected: 不应凭管理员 cookie 自动进入用户页；应继续要求用户登录
    Evidence: .sisyphus/evidence/task-2-route-separation-error.png
  ```

  **Commit**: YES | Message: `feat(user-shell): add separate user route tree and guards` | Files: `proxy.ts`, `app/user/**`, `app/components/**`

- [x] 3. 抽离共享查询封装并建立用户安全 DTO / 缓存策略

  **What to do**: 基于现有 `getOverview` / `getUsageRecords` / `getExplorePoints` 建立“管理员可传过滤条件、用户由服务端强制 scope”的共享封装层。新增 user-facing DTO：
  - `UserOverviewSelfResponse`：允许 cards + trends + 当前用户安全过滤维度（仅 model，可选）
  - `UserOverviewGlobalResponse`：仅 cards + trends，不返回 routes/names/sources/records
  - `UserRecordsResponse`：隐藏 `route`、`credentialName`、`provider` 等敏感或管理员归因字段
  同时处理缓存：用户接口默认 **关闭内存缓存**，或把 `session.route + viewMode + safe filters` 写入 cache key；禁止继续复用当前与身份无关的 cache key。
  **Must NOT do**: 不直接把现有 `/api/overview` 或 `/api/explore` payload 原样透传给用户端；不在 user API 中继续接受并信任 `route` / `name` / `source`；不让全局聚合响应携带 filters.routes / filters.names / filters.sources。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 这是后续 overview / records / quota 的安全底座。
  - Skills: `[]` - 以服务端查询与 DTO 约束为主。
  - Omitted: [`ui-ux-pro-max`] - 非视觉任务。

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4, 5, 6 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - API: `app/api/overview/route.ts:23-35,63-100` - 当前 cache key 与 handler 直接接受 `route/source/name`。
  - Query: `lib/queries/overview.ts:87-129,132-145,215-242,372-385` - 当前 totals/filters 同时支持 route/source/name，且 filters 基于 `baseWhere` 生成。
  - API: `app/api/records/route.ts:15-60` - 当前 records handler 直接透传 `route` / `source`。
  - Query: `lib/queries/records.ts:215-268,277-360` - 当前 records 查询与 filters 都会把客户端传参带入 SQL。
  - API: `app/api/explore/route.ts:16-26,53-74` - 当前 explore cache key 与 handler 接受 `route` / `name`。
  - Query: `lib/queries/explore.ts:70-84,96-126,134-167` - 当前 explore filters 和 points 都使用客户端 scope 参数。
  - Schema: `lib/db/schema.ts:16-20,35-43` - `route` 与 `authIndex` / `auth_file_mappings` 的现有字段边界。

  **Acceptance Criteria** (agent-executable only):
  - [ ] 新增 user query 封装后，用户接口完全不依赖客户端 `route` / `name` / `source` 作为身份范围。
  - [ ] self overview/records 结果仅包含当前 session.route 对应数据。
  - [ ] global overview 结果不包含任何 route/name/source/filter 明细。
  - [ ] 用户接口缓存不会因不同用户相同查询参数而复用错误数据。

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: 篡改查询参数无法越权
    Tool: Bash
    Steps: 1) 使用用户 cookie 请求 `/api/user/overview?route=someone-else&name=someone-else&source=someone-else` 2) 使用同一 cookie 请求 `/api/user/records?route=someone-else&source=someone-else` 3) 保存 JSON
    Expected: 返回 200 但结果仍只反映当前 session.route；响应中不出现被注入的他人 scope 数据
    Evidence: .sisyphus/evidence/task-3-scope-tamper.json

  Scenario: 不同用户缓存不串数据
    Tool: Bash
    Steps: 1) 准备两个不同用户 cookie 2) 先后请求相同的 `/api/user/overview?days=7` 3) 对比结果与响应头/日志
    Expected: 两个用户结果各自独立；不存在前一个用户的 filters 或 totals 泄漏到后一个用户
    Evidence: .sisyphus/evidence/task-3-cache-isolation.txt
  ```

  **Commit**: YES | Message: `refactor(user-data): add scoped query wrappers and safe dto contracts` | Files: `lib/queries/**`, `app/api/user/**`, `lib/types.*`

- [x] 4. 新增用户概览接口与摘要卡片计算规则

  **What to do**: 新增 `/api/user/overview`，只接受安全参数：`days|start|end|model|view=self|global`。`self` 模式强制追加 `route=session.route`；`global` 模式仅在 `ALLOW_USER_SEE_TOTAL_USAGE=true` 时可用，并返回严格的 aggregate-only DTO。服务端负责输出用户首页需要的四张卡：`totalTokens`、`estimatedCost`、`avgTpm`、`requestCount`。其中 `avgTpm` **严格沿用当前管理员首页口径**：`overviewData.totalTokens / actualTimeSpan.minutes`；`actualTimeSpan` 也沿用现有实现，即优先从 `overview.byHour` 里取最早时间点到 `now` 的分钟数，缺失时回退到 `appliedDays * 24 * 60`。该计算应下沉到共享计算层或 user overview 服务端，前端只展示，不再二次定义。
  **Must NOT do**: 不把 `filters.routes`、`filters.names`、`filters.sources` 放进 global 响应；不让客户端以 query param 切出他人数据；不改变 TPM 口径与现有管理员页不一致。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 需要把现有 overview 查询合同安全地裁剪为用户可消费版本。
  - Skills: `[]` - 服务端统计与响应设计为主。
  - Omitted: [`ui-ux-pro-max`] - 本任务重点不在界面。

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 5 | Blocked By: 2, 3

  **References** (executor has NO interview context - be exhaustive):
  - Existing handler: `app/api/overview/route.ts:63-100` - 当前 overview handler 的参数解析与 payload 结构。
  - Existing query: `lib/queries/overview.ts:95-100,102-119,132-145,172-213,352-385` - 当前 totals / byDay / byHour / filters 生成逻辑。
  - Existing range UX source: `app/page.tsx:375-401,485-490` - 当前 dashboard 的时间范围状态与持久化模式。
  - Existing schema/cost logic: `lib/usage.ts:176-191` - 成本估算规则，用户卡片必须沿用，避免出现两套 cost 口径。
  - Existing TPM logic: `app/page.tsx:1161-1191,1787-1793` - 当前“平均 TPM”卡片与 `actualTimeSpan` 计算口径，用户模式必须复用。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `/api/user/overview?view=self` 返回四张卡所需字段、趋势数据与安全过滤元数据。
  - [ ] `/api/user/overview?view=global` 在 flag 关闭时返回 403/404，在 flag 开启时返回 aggregate-only payload。
  - [ ] `avgTpm` 为服务端产出字段，且其计算结果与当前管理员首页口径一致。
  - [ ] self/global 两种 payload 都不包含 key、credential、email、authIndex、routes/names/sources（global 模式）。

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: self overview 正常返回并含 Avg TPM
    Tool: Bash
    Steps: 使用用户 cookie 请求 `http://127.0.0.1:3000/api/user/overview?days=7&view=self`，将响应保存为 JSON
    Expected: JSON 含 `totalTokens`、`totalCost`/`estimatedCost`、`avgTpm`、`totalRequests` 与趋势数组；`avgTpm` 与当前管理员首页相同输入数据下的展示值一致；不含 `route`、`credentialName`
    Evidence: .sisyphus/evidence/task-4-user-overview-self.json

  Scenario: global 模式受 env 开关控制
    Tool: Bash
    Steps: 1) 在 flag 关闭状态请求 `/api/user/overview?days=7&view=global` 2) 在 flag 开启状态再次请求 3) 保存两次结果
    Expected: 关闭时拒绝；开启时仅返回 aggregate-only 字段，不含 filters.routes/names/sources
    Evidence: .sisyphus/evidence/task-4-user-overview-global.txt
  ```

  **Commit**: YES | Message: `feat(user-overview): add scoped overview api and summary metrics` | Files: `app/api/user/overview/route.*`, `lib/queries/**`, `lib/types.*`

- [x] 5. 实现用户首页（时间过滤、摘要卡、趋势图、全局聚合切换）

  **What to do**: 新建 `/user` 页面，复用现有 admin dashboard 的时间范围交互、摘要卡视觉模式与趋势图管线，但不复制管理员操作区。页面包含：
  - 时间过滤（preset/custom，与现有 `rangeSelection` 兼容但使用独立 key，如 `userRangeSelection`）
  - 四张摘要卡：Tokens、Estimated Cost、平均 TPM、Request Count
  - 用户趋势图（按当前用户范围）
  - 当 `ALLOW_USER_SEE_TOTAL_USAGE=true` 时显示一个明确标注的切换控件：`我的使用 / 全站聚合`；仅影响 cards + charts，请求 `/api/user/overview` 的 `view` 参数
  全局模式 UI 必须出现醒目标识“仅聚合统计，不含任何他人明细”。
  **Must NOT do**: 不把 global toggle 作用到 records；不在用户首页出现 sync、price CRUD、sync-model-prices、logs、usage toggle、CPAMC；不与 admin dashboard 共享同一 localStorage key，避免状态互相污染。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: 这是用户主界面，需在复用现有设计基础上做干净裁剪。
  - Skills: [`ui-ux-pro-max`] - 需要高质量但节制的用户仪表盘 UI 改造。
  - Omitted: [`frontend-claude`] - 无需大幅风格重塑。

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 8 | Blocked By: 2, 4

  **References** (executor has NO interview context - be exhaustive):
  - Existing dashboard state: `app/page.tsx:366-423,429-471,516-530` - 当前首页混合了 analytics 与 admin 状态。
  - Existing range persistence: `app/page.tsx:375-401,485-490` - 可复用 preset/custom 交互，但需要独立 localStorage key。
  - Existing admin-only controls to exclude: `app/page.tsx:732-742,805,835,1252,1304,1347,1354,1405` - 这些是 sync / price 管理相关入口。
  - Existing chart pipeline: `lib/queries/overview.ts:172-213,324-367` - 当前 byDay / byHour 数据合同。
  - Existing TPM card: `app/page.tsx:1787-1793` + `app/page.tsx:1161-1191` - 当前“平均 TPM”展示与计算口径。
  - Existing shared shell issue: `app/components/Sidebar.tsx:9-14,127-156` - 不能直接复用管理员 Sidebar。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `/user` 页面展示四张摘要卡与至少一组趋势图，数据来自 `/api/user/overview`。
  - [ ] 页面时间过滤可切换 preset/custom，刷新后仍保持用户上次选择。
  - [ ] 当 `ALLOW_USER_SEE_TOTAL_USAGE=false` 时，页面上看不到 global toggle。
  - [ ] 当 `ALLOW_USER_SEE_TOTAL_USAGE=true` 时，切换到全站聚合只改变 cards/charts，不改变 records 链接或任何明细页面行为。

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: 用户首页正常展示并切换时间范围
    Tool: Playwright
    Steps: 1) 通过统一 `/login` 用测试 key 登录 2) 进入 `/user` 3) 选择最近 7 天 4) 再切换自定义日期范围 5) 刷新页面
    Expected: 四张卡和图表成功刷新；“平均 TPM”与现有 admin 口径一致；刷新后仍保留用户范围选择；页面中无管理员操作按钮
    Evidence: .sisyphus/evidence/task-5-user-dashboard.png

  Scenario: 全站聚合切换不泄漏明细
    Tool: Playwright
    Steps: 1) 在 flag 开启情况下登录 `/user` 2) 切换到“全站聚合” 3) 检查页面文案与网络请求 4) 点击“调用记录”进入 `/user/records`
    Expected: 页面显示“仅聚合统计”提示；网络请求命中 `view=global`；`/user/records` 仍只显示当前用户数据
    Evidence: .sisyphus/evidence/task-5-user-dashboard-global.png
  ```

  **Commit**: YES | Message: `feat(user-dashboard): add user overview page and global aggregate toggle` | Files: `app/user/page.*`, `app/user/components/**`, `app/user/layout.*`

- [x] 6. 实现用户调用记录接口与记录页

  **What to do**: 新增 `/api/user/records` 与 `/user/records`，复用现有 cursor 分页、多列排序、时间过滤和 table 交互，但服务端固定 `route=session.route`，且页面默认只展示安全列：时间、模型、Tokens、输入、输出、思考、缓存、费用、状态。删除/隐藏 `route`（密钥）列与 `credentialName`（凭证）列；同时不展示同步按钮。若保留 provider 需要额外论证，v1 默认也隐藏，避免把管理员 auth-file 归因信息带到用户侧。
  **Must NOT do**: 不让 `/user/records` 继续显示“密钥”“凭证”；不允许客户端指定 `route` / `source` 改变服务器 scope；不在用户记录页提供 `/api/sync` 入口。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 既要服务端强制过滤，又要前端复用现有复杂表格行为。
  - Skills: [`ui-ux-pro-max`] - 需要裁剪表格列与交互，但不是全新设计。
  - Omitted: [`frontend-claude`] - 不是视觉主任务。

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 8 | Blocked By: 2, 3

  **References** (executor has NO interview context - be exhaustive):
  - Records handler: `app/api/records/route.ts:15-60` - 当前 handler 直接接收 `route` / `source`。
  - Records query: `lib/queries/records.ts:242-268,277-360` - 当前 where / filters / select 列表。
  - UI columns: `app/records/page.tsx:94-153` - 当前列定义中 `route=密钥`、`credentialName=凭证`。
  - UI request builder: `app/records/page.tsx:516-541` - 当前前端会把 `route/source` 直接拼到 query string。
  - UI sync control: `app/records/page.tsx:593-609` - 当前记录页内含 `/api/sync` 入口，用户页必须移除。
  - UI row renderers: `app/records/page.tsx:819-829` - 当前 route/credentialName 的实际渲染位置。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `/api/user/records` 响应 items 不包含 `route`、`credentialName`、`provider` 字段。
  - [ ] `/user/records` 页面无“密钥”“凭证”列、无同步按钮。
  - [ ] 排序、分页、时间过滤仍可正常工作。
  - [ ] 篡改请求中的 `route` 或 `source` 参数不会扩大结果范围。

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: 用户记录页只显示安全列
    Tool: Playwright
    Steps: 1) 通过统一 `/login` 用测试 key 登录 2) 打开 `/user/records` 3) 检查表头与首屏行数据 4) 执行一次时间范围过滤和排序
    Expected: 页面仅显示安全列；不存在“密钥/凭证/提供商/同步”相关 UI；过滤和排序工作正常
    Evidence: .sisyphus/evidence/task-6-user-records.png

  Scenario: 通过 query param 篡改 scope 无效
    Tool: Bash
    Steps: 使用用户 cookie 请求 `http://127.0.0.1:3000/api/user/records?route=other-key&source=other-name&limit=20` 并保存 JSON
    Expected: 返回结构合法，但 items 仍只包含当前用户范围数据，且无 `route`/`credentialName` 字段
    Evidence: .sisyphus/evidence/task-6-user-records-error.json
  ```

  **Commit**: YES | Message: `feat(user-records): add scoped records api and safe table` | Files: `app/api/user/records/route.*`, `app/user/records/page.*`, `lib/queries/**`

- [x] 7. 实现可选用户 Quota 摘要接口与面板

  **What to do**: 仅在 `ALLOW_USER_SEE_QUOTA=true` 时启用用户 quota 功能。新增 `/api/user/quota`：
  1) 先用 `session.route` 在本地 `usage_records` 中解析最近的非空 `authIndex`；若解析不到唯一 `authIndex`，返回 `{ available: false, reason: 'unresolved-auth-index' }`
  2) 服务端调用上游管理面 quota 数据来源，参照 CLIProxyAPI quota panel 的实现路径：`GET /v0/management/auth-files` + `POST /v0/management/api-call`
  3) 仅返回安全归一化 DTO：`provider`、`plan`、`windows[{key,label,remainingPercent,resetAt}]`、`credits`、`fetchedAt`、`available`
  4) `/user` 页面在 flag 开启时渲染 quota panel；若 `available=false`，显示明确的 unavailable 状态而不是错误堆栈
  对 Claude/Codex 先做 5h/7d 映射；Gemini/Antigravity 没有 5h/7d 时，显示 provider-specific safe summary，不伪造窗口。
  **Must NOT do**: 不把 `/v0/management/auth-files` 原始结果透传给前端；不显示每个 account 的 JSON name、`auth_index`、`name`、`email`、`label`、`id_token`；不从 `usage_records` 推导“剩余额度”；不因为无法解析 quota 就降级到暴露管理员接口。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 涉及本地 route→authIndex 解析、上游管理面调用、provider 归一化与安全裁剪。
  - Skills: `[]` - 以服务端整合与数据裁剪为主。
  - Omitted: [`ui-ux-pro-max`] - 面板 UI 次于数据安全。

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 8 | Blocked By: 1, 2

  **References** (executor has NO interview context - be exhaustive):
  - Local schema: `lib/db/schema.ts:18-20,35-43` - `route`、`authIndex`、`auth_file_mappings` 的现有边界。
  - Local sync mapping: `app/api/sync/route.ts:108-145,214-260` - auth-file mapping 同步与 usage ingest 现状。
  - Local usage parse: `lib/usage.ts:78-82,101-127` - `authIndex` 如何从 usage details 落表。
  - External source-of-truth: `https://github.com/router-for-me/CLIProxyAPI/blob/main/internal/api/server.go` - 上游管理面注册了 `/v0/management/auth-files` 与 `/v0/management/api-call`。
  - External quota UI: `https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/main/src/pages/QuotaPage.tsx`
  - External quota loader: `https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/main/src/components/quota/useQuotaLoader.ts`
  - External provider mapping: `https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/main/src/components/quota/quotaConfigs.ts`, `https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/main/src/utils/quota/constants.ts`, `https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/main/src/utils/quota/resolvers.ts`

  **Acceptance Criteria** (agent-executable only):
  - [ ] `ALLOW_USER_SEE_QUOTA=false` 时，用户接口与 UI 都不存在 quota 面板。
  - [ ] `ALLOW_USER_SEE_QUOTA=true` 且可解析 authIndex 时，`/api/user/quota` 返回安全摘要 DTO，不包含账号名称/JSON name/邮箱/原始响应。
  - [ ] `ALLOW_USER_SEE_QUOTA=true` 但不可解析 authIndex 时，接口返回 `available=false`，页面显示 unavailable 状态。
  - [ ] Claude/Codex 至少正确映射 5h/7d；其他 provider 若无该概念，不伪造 5h/7d 数值。

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: quota 摘要成功返回且字段安全
    Tool: Bash
    Steps: 在 flag 开启且测试用户可解析 authIndex 的前提下，请求 `http://127.0.0.1:3000/api/user/quota` 并保存 JSON
    Expected: 响应仅含 `available/provider/plan/windows/credits/fetchedAt` 等安全字段；不含 `name/email/auth_index/id_token/account`
    Evidence: .sisyphus/evidence/task-7-user-quota.json

  Scenario: 无法解析 authIndex 时优雅降级
    Tool: Bash
    Steps: 使用一个本地无历史 usage 的测试 key 登录后请求 `/api/user/quota`
    Expected: 返回 `available=false` 与明确 reason；不抛 500；页面显示不可用状态
    Evidence: .sisyphus/evidence/task-7-user-quota-error.json
  ```

  **Commit**: YES | Message: `feat(user-quota): add safe quota summary api and panel` | Files: `app/api/user/quota/route.*`, `app/user/**`, `lib/**`

- [x] 8. 收口安全硬化、env 配置接线与管理员边界回归

  **What to do**: 完成所有收口项：
  - 在 `lib/config.ts`、`.env.example`、README 中接入并记录 `ALLOW_USER_SEE_TOTAL_USAGE`、`ALLOW_USER_SEE_QUOTA`、用户 session secret 等新配置
  - 确保用户模式下所有 empty/error/loading state 都不泄漏他人 route/name/provider 信息
  - 确保用户模式完全看不到 `/logs`、`/request-error-logs`、`/usage-statistics-enabled`、`/management-url`、sync、price 管理
  - 清理任何遗留的 fetch helper、localStorage key、共享状态冲突
  - 对 self/global 两种模式做最终字段审计
  **Must NOT do**: 不修改管理员现有统计口径；不把 env flag 默认设为开启；不遗漏 README/.env.example 的配置说明；不把用户模式错误页面做成“显示后端原始异常”。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: 这是多点收口与回归检查任务。
  - Skills: `[]` - 偏安全审计与产品边界回归。
  - Omitted: [`ui-ux-pro-max`] - 非主要视觉任务。

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: F1-F4 | Blocked By: 5, 6, 7

  **References** (executor has NO interview context - be exhaustive):
  - Env/config: `lib/config.ts:26-53`, `.env.example:21-31`, `README.md:45-57,84-89`
  - Admin-only APIs: `app/api/logs/route.ts:6-34`, `app/api/request-error-logs/route.ts:6-40`, `app/api/usage-statistics-enabled/route.ts:6-78`, `app/api/management-url/route.ts:5-19`, `app/api/sync/route.ts:204-260`
  - Admin-only sidebar controls: `app/components/Sidebar.tsx:127-156,178-207`
  - Global shell behavior: `app/components/ClientLayout.tsx:7-32`

  **Acceptance Criteria** (agent-executable only):
  - [ ] 新增 env flag 都有默认值、文档说明与运行时接线。
  - [ ] 用户错误/空状态不会显示 route、credential、provider、上游原始错误 payload。
  - [ ] 用户模式下无法通过导航、直链、网络请求接触任何管理员/运维接口。
  - [ ] README / `.env.example` 与实现保持一致。

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: 用户模式无法触达管理员/运维接口
    Tool: Bash
    Steps: 使用用户 cookie 依次请求 `/api/logs`、`/api/request-error-logs`、`/api/usage-statistics-enabled`、`/api/management-url`、`/api/sync`
    Expected: 全部拒绝、重定向或在用户模式下不可达；不存在成功的 200 管理员数据响应
    Evidence: .sisyphus/evidence/task-8-admin-boundary.txt

  Scenario: 文档与开关接线一致
    Tool: Bash
    Steps: 1) 切换 `ALLOW_USER_SEE_TOTAL_USAGE`/`ALLOW_USER_SEE_QUOTA` 组合启动应用 2) 访问 `/user` 3) 对照 `.env.example`/README 中说明验证功能显隐
    Expected: 功能显隐与文档一致；无“flag 开关关闭但接口仍然可访问”的情况
    Evidence: .sisyphus/evidence/task-8-env-gating.txt
  ```

  **Commit**: YES | Message: `fix(user-security): harden env gates and admin boundaries` | Files: `lib/config.ts`, `.env.example`, `README.md`, `app/**`, `lib/**`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle

  **What to do**: 让 Oracle 逐项核对已实现内容是否符合本计划的关键决策：独立 `/user` 路由树、独立 user session、session-derived route 作为明细边界、global aggregate-only DTO、quota 安全摘要、admin/user 边界不串。
  **Acceptance Criteria**:
  - [ ] Oracle 明确确认不存在与计划相违背的架构偏移。
  - [ ] 若发现偏移，必须先修复再复审，直到 Oracle 给出 approve 结论。

  **QA Scenarios**:
  ```
  Scenario: Oracle 计划一致性审计
    Tool: task(oracle)
    Steps: 1) 提供 `.sisyphus/plans/user-level-dashboard.md` 与实现 diff/关键文件 2) 要求 Oracle 核对 route boundary、env gating、global aggregate-only、quota DTO、admin/user split 3) 保存审计结论
    Expected: 结论为 APPROVE；若不是 APPROVE，则列出偏差并回修
    Evidence: .sisyphus/evidence/f1-plan-compliance.md
  ```

- [x] F2. Code Quality Review — unspecified-high

  **What to do**: 运行一次独立代码质量审查，检查重复逻辑、条件分支污染、未收口的 admin/user 耦合、未清理的调试代码、文档/配置不一致。
  **Acceptance Criteria**:
  - [ ] 审查结论为通过，且没有“用户模式仍依赖管理员 payload 再前端删字段”之类的结构性问题。
  - [ ] `pnpm run lint` 与 `pnpm run build` 均通过并纳入审查结果。

  **QA Scenarios**:
  ```
  Scenario: 代码质量与构建审查
    Tool: Bash + task(unspecified-high)
    Steps: 1) 执行 `pnpm run lint` 2) 执行 `pnpm run build` 3) 让审查代理检查关键改动文件是否存在重复实现、未使用状态、跨模式耦合
    Expected: lint/build 通过；审查代理给出 APPROVE 或等价通过结论
    Evidence: .sisyphus/evidence/f2-code-quality.txt
  ```

- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)

  **What to do**: 对用户与管理员两条主路径做真实端到端回归：用户登录/浏览/切换 global/看记录/看 quota；管理员登录/看原有首页/记录/日志；验证两边互不串权限。
  **Acceptance Criteria**:
  - [ ] 用户 happy path 与越权失败路径均通过。
  - [ ] 管理员原有主路径不回归。

  **QA Scenarios**:
  ```
  Scenario: 用户主链路与管理员回归
    Tool: Playwright
    Steps: 1) 用户通过统一 `/login` 登录 2) 访问 `/user`、`/user/records`、可选 quota 区 3) 尝试访问 `/logs` 4) 清空会话后以管理员身份登录 `/login` 5) 访问 `/`、`/records`、`/logs`
    Expected: 用户链路全通过且无法访问管理员页；管理员链路保持原样可用
    Evidence: .sisyphus/evidence/f3-real-qa.png
  ```

- [x] F4. Scope Fidelity Check — deep

  **What to do**: 专门复核“范围保真度”：用户接口是否始终以 session.route 为明细边界；global 模式是否绝不泄漏 route/name/source/records；quota 模式是否绝不返回账号识别字段。
  **Acceptance Criteria**:
  - [ ] 所有抽样接口都满足 scope fidelity 要求。
  - [ ] 没有任何一个接口能通过 query param / cookie 混用 / cache 命中看到他人细节。

  **QA Scenarios**:
  ```
  Scenario: 范围保真度与防泄漏审计
    Tool: Bash + task(deep)
    Steps: 1) 用用户 cookie 请求 `/api/user/overview`、`/api/user/records`、`/api/user/quota`，分别注入伪造 `route/name/source/view` 参数 2) 检查响应字段与数据范围 3) 保存审计报告
    Expected: self 接口始终只返回 session.route 数据；global 只返回 aggregate-only 字段；quota 不含账号识别信息
    Evidence: .sisyphus/evidence/f4-scope-fidelity.md
  ```

## Commit Strategy
- 建议按 Wave 提交，而不是每个零碎文件单独提交。
- 建议提交序列：
  1. `feat(user-auth): add separate user session and route guards`
  2. `feat(user-dashboard): add scoped overview and records flows`
  3. `feat(user-quota): add safe quota summary panel`
  4. `fix(user-security): harden caches and admin-user boundaries`

## Success Criteria
- 用户模式不泄漏任何他人 records、credential name、key、email、auth_index、provider raw payload、logs、ops 状态。
- 管理员模式保留原有行为，不被用户模式分支污染。
- overview/records/charts 尽量复用现有 DB 查询逻辑，而不是重写统计体系。
- quota 功能在无可解析上游 quota 能力时优雅降级为 unavailable，而不是返回错误细节或暴露上游原始信息。
