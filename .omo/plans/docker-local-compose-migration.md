# Docker 本地 Compose 一体化迁移计划（替代 Vercel）

## TL;DR

> **Quick Summary**: 将 dashboard 从 Vercel 迁移为本地 Docker Compose 部署，并与现有 `cli-proxy-api` 合并编排；数据库改为本地 PostgreSQL（空库启动），用 compose 内 cron sidecar 替代 Vercel cron。
>
> **Deliverables**:
> - Docker 化运行资产（Dockerfile / .dockerignore / compose 编排 / cron / backup）
> - Vercel 绑定点解耦（DB 驱动、analytics、cron）
> - 本地运维文档（部署、回滚、备份）与可执行 QA 矩阵
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 3 implementation waves + final verification wave
> **Critical Path**: T1 → T2 → T7 → T8 → T13 → T15 → F1-F4

---

## Context

### Original Request
将项目从 Vercel 迁移到本地 Docker 部署（含数据库），并与现有 `cli-proxy-api` 的 compose 方案对齐。

### Interview Summary
**Key Discussions**:
- 部署拓扑：单机 Compose 一体化（并入现有 compose）
- 数据库策略：本地 PostgreSQL，空库启动（不迁历史）
- 访问方式：仅内网访问（Phase 1 不强制 HTTPS）
- Dashboard 端口：`8318:3000`
- 定时同步：Compose 内 cron sidecar 调用 `/api/sync`
- 定时同步：Compose 内 cron sidecar 调用 `/api/sync`（默认沿用 `vercel.json`：`0 21 * * *`，Asia/Shanghai）
- Analytics：移除/禁用 `@vercel/analytics`
- 备份策略：每日备份，保留 7 天，落盘 `./backups/postgres`
- 验证策略：tests-after + agent-executed QA
- 恢复演练：本阶段不纳入
- 明确编译/迁移分离：Docker build 阶段只做 `next build`，迁移由 compose one-shot `migrate` 服务在 `postgres healthy` 后执行
- unified compose 以仓库根 `docker-compose.yml` 为准，`cli-proxy-api` 服务定义沿用用户当前配置（image/ports/volumes/restart）

**Research Findings**:
- Vercel 绑定点：`lib/db/client.ts`, `scripts/migrate.mjs`, `app/layout.tsx`, `vercel.json`
- 构建/运行链路：`pnpm build` 包含迁移脚本；`pnpm start` 为运行入口
- env 合约关键项：`CLIPROXY_SECRET_KEY`, `CLIPROXY_API_BASE_URL`, `DATABASE_URL`, `PASSWORD`, `CRON_SECRET`, `TIMEZONE`
- 当前缺口：无 Dockerfile/.dockerignore/compose（dashboard+db+cron）

### Metis Review
**Identified Gaps** (addressed in plan):
- 显式锁定 scope，避免扩展到 TLS/HA/历史迁移
- 显式定义 migration fail-fast 与健康检查顺序
- 将 cron 替代与 backup 保留策略纳入强制验收
- 加入 `next-env.d.ts` 污染防护与最终合规审计

---

## Work Objectives

### Core Objective
在不引入业务逻辑重构的前提下，将 dashboard 从 Vercel 托管迁移为本地 Docker Compose 自托管，并保证同步、数据库、备份、可运维性与回滚路径可执行。

### Concrete Deliverables
- `Dockerfile`（dashboard 生产镜像）
- `.dockerignore`
- `docker-compose.yml`（扩展现有 stack）
- Postgres service + volume + healthcheck
- migrate one-shot service（postgres healthy 后执行，fail-fast）
- sync-cron sidecar
- backup service/script + retention(7d)
- Vercel 绑定点解耦改动（DB/analytics/cron）
- 部署/回滚/备份文档与 QA 脚本

### Definition of Done
- [ ] `docker compose config --quiet` 通过
- [ ] `docker compose up -d` 后 dashboard 在 `8318` 可访问
- [ ] `docker compose run --rm migrate` 成功且失败时阻断流程
- [ ] `/api/sync` 可由 cron sidecar 成功触发
- [ ] 备份目录 `./backups/postgres` 产生备份且保留 <= 7
- [ ] F1/F2/F3/F4 最终验证全部通过

### Must Have
- 单机 compose 一体化（dashboard + postgres + cli-proxy-api + sync-cron）
- `cli-proxy-api` 服务参数与现有线上片段等价：
  - `image: eceasy/cli-proxy-api-plus:latest`
  - `ports: 8317:8317`
  - `volumes: ./config.yaml:/CLIProxyAPI/config.yaml`, `./auths:/root/.cli-proxy-api`, `./logs:/CLIProxyAPI/logs`
  - `restart: unless-stopped`
- 本地 Postgres 空库启动
- dashboard 端口映射 `8318:3000`
- 每日备份 + 7 天保留
- tests-after + agent-executed QA

### Must NOT Have (Guardrails)
- 不做历史云 DB 数据迁移
- 不引入 TLS/反向代理/HA 扩展到 phase-1
- 不改动业务功能（仅部署适配最小改动）
- 不在仓库中提交 secrets/.env
- 不允许 `next-env.d.ts` 污染进入最终交付

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — 全部验收均由 agent 执行命令与自动化检查完成。

### Test Decision
- **Infrastructure exists**: YES（Node/Next + lint/build + API 路由可执行）
- **Automated tests**: Tests-after
- **Framework**: 项目既有 lint/build + API/compose smoke 命令式验证
- **TDD**: NO（本任务为部署迁移与运维链路重构，采用 tests-after）

### QA Policy
每个任务必须包含 agent-executed QA 场景，产出证据到 `.sisyphus/evidence/`。

- **Frontend/UI**: Playwright（验证 dashboard 启动、关键文案/路由可达）
- **API/Backend**: Bash(curl)（验证 `/api/management-url`, `/api/sync` 等）
- **Compose/DB**: Bash(`docker compose`, `pg_isready`)（验证健康与依赖顺序）
- **Ops**: Bash（备份生成、保留策略、回滚命令可执行）

---

## Execution Strategy

### Parallel Execution Waves

Wave 1（Foundation — 可并行 6 项）
├── T1: DB 驱动去 Vercel 化（client 层）
├── T2: 迁移脚本去 Vercel 化 + fail-fast
├── T3: 环境变量契约与配置校准（含内网 HTTP）
├── T4: 移除/禁用 Vercel Analytics
├── T5: Dockerfile（dashboard）
└── T6: .dockerignore 与 docker env 模板

Wave 2（Core Infra — 可并行 6 项，依赖 Wave1）
├── T7: 扩展 unified docker-compose（dashboard+postgres+migrate+cli-proxy-api）
├── T8: sync-cron sidecar（替代 vercel cron）
├── T9: backup 服务 + 7天保留策略
├── T10: .gitignore 与备份目录策略落地
├── T11: 健康检查链路（service_healthy + endpoint）
└── T12: 鉴权 cookie 内网部署策略校准

Wave 3（Integration + Ops — 可并行 3 项，依赖 Wave2）
├── T13: 部署/回滚 runbook
├── T14: 备份运维文档（无 restore drill）
└── T15: 端到端 smoke QA 脚本与执行记录

Wave FINAL（After ALL tasks — 4 parallel reviewers）
├── F1: Plan Compliance Audit (oracle)
├── F2: Code Quality Review (unspecified-high)
├── F3: Real Manual QA / runtime QA (unspecified-high + playwright)
└── F4: Scope Fidelity Check (deep)

Critical Path: T1 → T2 → T7 → T8 → T13 → T15 → F1/F2/F3/F4

### Dependency Matrix (FULL)

| Task | Depends On | Blocks |
|---|---|---|
| T1 | None | T7, T11 |
| T2 | None | T7, T15 |
| T3 | None | T7, T8, T11, T12 |
| T4 | None | T13 |
| T5 | None | T7 |
| T6 | None | T7, T13 |
| T7 | T1,T3,T5,T6 | T8,T9,T10,T11,T12,T15 |
| T8 | T3,T7 | T15 |
| T9 | T7 | T14,T15 |
| T10 | T7 | T14 |
| T11 | T1,T3,T7 | T15 |
| T12 | T3,T7 | T15 |
| T13 | T4,T6,T7 | F1,F4 |
| T14 | T9,T10 | F1,F3 |
| T15 | T2,T7,T8,T9,T11,T12 | F1,F2,F3,F4 |

### Agent Dispatch Summary
- Wave 1（6）: T1/T2/T3 → `deep`, T4 → `quick`, T5/T6 → `quick`
- Wave 2（6）: T7/T8/T9/T11/T12 → `deep`, T10 → `quick`
- Wave 3（3）: T13/T14 → `writing`, T15 → `unspecified-high`
- FINAL（4）: F1=`oracle`, F2=`unspecified-high`, F3=`unspecified-high`(+playwright), F4=`deep`

---

## TODOs

- [x] 1. 去 Vercel 化数据库客户端（runtime 路径）

  **What to do**:
  - 将 `lib/db/client.ts` 从 `@vercel/postgres`/`drizzle-orm/vercel-postgres` 切换为通用 `pg` + Drizzle Postgres 适配。
  - 保持 `db` 导出 API 不变，避免调用方连锁改造。
  - 更新对应依赖声明（新增 `pg`，移除运行时对 vercel-postgres 的硬依赖）。

  **Must NOT do**:
  - 不改动业务查询语义。
  - 不引入第二套并行 db 客户端 API。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 涉及运行时基础设施与跨模块依赖。
  - **Skills**: [`beads`, `secret-guard`]
    - `beads`: 跟踪跨文件依赖与收口顺序。
    - `secret-guard`: 防止改配置时引入明文凭据。
  - **Skills Evaluated but Omitted**:
    - `playwright`: 非 UI 任务。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 T2~T6 并行）
  - **Blocks**: T7, T11
  - **Blocked By**: None

  **References**:
  - `lib/db/client.ts` - 当前 Vercel DB 绑定入口。
  - `package.json` - DB 依赖声明与构建链路。
  - `scripts/migrate.mjs` - 迁移脚本需与新客户端一致。
  - WHY: 三者共同定义数据库运行时与迁移时的驱动一致性。

  **Acceptance Criteria**:
  - [ ] `grep -R "@vercel/postgres\|drizzle-orm/vercel-postgres" lib/db/client.ts` 无命中。
  - [ ] `node -e "require('./lib/db/client.ts')"`（或等效 TS 运行命令）成功加载。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 新 db 客户端可初始化（Happy path）
    Tool: Bash
    Preconditions: DATABASE_URL 已配置为本地 Postgres 连接串
    Steps:
      1. 执行类型检查/构建前置（如 `pnpm lint`）
      2. 执行最小导入检查脚本，初始化 db 客户端
      3. 断言退出码为 0 且无连接驱动错误
    Expected Result: 客户端初始化成功
    Failure Indicators: module not found / driver mismatch / connect error
    Evidence: .sisyphus/evidence/task-T1-db-client-init.txt

  Scenario: 缺失 DATABASE_URL 时失败可识别（Failure path）
    Tool: Bash
    Preconditions: 临时移除 DATABASE_URL（测试进程级）
    Steps:
      1. 在空 DATABASE_URL 环境运行初始化检查
      2. 捕获标准错误输出
    Expected Result: 明确报错并非静默成功
    Evidence: .sisyphus/evidence/task-T1-db-client-init-error.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-T1-db-client-init.txt`
  - [ ] `task-T1-db-client-init-error.txt`

  **Commit**: YES
  - Message: `refactor(db): decouple runtime from vercel postgres`
  - Files: `lib/db/client.ts`, `package.json`（如需）
  - Pre-commit: `pnpm lint`

- [x] 2. 重构迁移脚本为 fail-fast（避免“失败但构建成功”）

  **What to do**:
  - 在 `scripts/migrate.mjs` 使用与 T1 一致的通用 PG 路径。
  - 改为迁移失败即非零退出码（fail-fast）。
  - 明确日志：连接失败、SQL 执行失败、目录缺失等。
  - 将“构建”和“迁移”解耦：新增/调整脚本使 Docker build 使用 `next build`（不依赖 DB），迁移由独立 `migrate` 命令执行。

  **Must NOT do**:
  - 不吞异常返回 0。
  - 不改变既有 migration 文件顺序语义。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 直接影响部署可靠性与构建门禁。
  - **Skills**: [`beads`]
    - `beads`: 跟踪脚本行为变化与验证闭环。
  - **Skills Evaluated but Omitted**:
    - `git-master`: 非纯 git 操作。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T7, T15
  - **Blocked By**: None

  **References**:
  - `scripts/migrate.mjs` - 当前迁移实现与退出行为。
  - `package.json` - `build` 命令依赖该脚本。
  - `drizzle/*.sql` - 迁移输入来源。
  - WHY: 保障构建阶段数据库状态一致且失败可阻断上线。

  **Acceptance Criteria**:
  - [ ] 人为提供错误连接串时，`node scripts/migrate.mjs` 退出码非 0。
  - [ ] 正常连接时脚本成功执行并输出成功日志。
  - [ ] 存在独立 `migrate` 与 `build:app`（或等效）脚本，`build:app` 不触发数据库迁移。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 正常迁移通过（Happy path）
    Tool: Bash
    Preconditions: Postgres service healthy
    Steps:
      1. 运行 `pnpm run migrate`（或等效独立迁移命令）
      2. 记录输出与退出码
      3. 查询 migration 表确认版本已登记
    Expected Result: 退出码 0，迁移完成
    Evidence: .sisyphus/evidence/task-T2-migrate-pass.txt

  Scenario: 错误连接串强制失败（Failure path）
    Tool: Bash
    Preconditions: 使用无效 DATABASE_URL
    Steps:
      1. 临时覆盖 DATABASE_URL 运行 `pnpm run migrate`
      2. 捕获退出码与错误文本
    Expected Result: 退出码非 0，错误可读
    Evidence: .sisyphus/evidence/task-T2-migrate-fail.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-T2-migrate-pass.txt`
  - [ ] `task-T2-migrate-fail.txt`

  **Commit**: YES
  - Message: `fix(migrate): fail fast and decouple migration from build`
  - Files: `scripts/migrate.mjs`, `package.json`
  - Pre-commit: `pnpm run migrate`

- [x] 3. 统一 env 合约并校准内网 HTTP 场景

  **What to do**:
  - 让 `CLIPROXY_API_BASE_URL` 支持内网 HTTP（不强制 HTTPS）。
  - 对 `.env.example` 与 `lib/config.ts` 的变量说明做一致化。
  - 明确 `DATABASE_URL` 为主，`POSTGRES_URL` 仅兼容回退。

  **Must NOT do**:
  - 不把 secret 默认值写死到代码。
  - 不破坏现有必填校验。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 影响运行配置与健康检查可靠性。
  - **Skills**: [`beads`, `secret-guard`]
    - `beads`: 配置项联动追踪。
    - `secret-guard`: 校验示例文件无敏感泄露。
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: 非 UI。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T7, T8, T11, T12
  - **Blocked By**: None

  **References**:
  - `lib/config.ts` - 运行时 env 校验逻辑。
  - `.env.example` - 文档化 env 合约。
  - `app/api/management-url/route.ts` - 健康检查端点依赖 base URL。
  - WHY: 确保 compose 内部服务发现与内网协议可用。

  **Acceptance Criteria**:
  - [ ] 内网 HTTP base URL 可通过校验并返回 `/api/management-url` 200。
  - [ ] `.env.example` 中所有关键变量与代码校验一致。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 内网 HTTP base URL 生效（Happy path）
    Tool: Bash (curl)
    Preconditions: CLIPROXY_API_BASE_URL=http://cli-proxy-api:8317
    Steps:
      1. 启动 dashboard 服务
      2. 请求 `/api/management-url`
      3. 断言返回 200 且 URL 字段为期望值
    Expected Result: 健康端点可用
    Evidence: .sisyphus/evidence/task-T3-management-url-pass.json

  Scenario: 缺失关键 env 时失败（Failure path）
    Tool: Bash
    Preconditions: 去除 CLIPROXY_API_BASE_URL
    Steps:
      1. 启动 dashboard
      2. 捕获启动错误
    Expected Result: 明确失败并提示缺失配置
    Evidence: .sisyphus/evidence/task-T3-management-url-fail.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-T3-management-url-pass.json`
  - [ ] `task-T3-management-url-fail.txt`

  **Commit**: YES
  - Message: `chore(config): align env contract for internal docker runtime`
  - Files: `lib/config.ts`, `.env.example`
  - Pre-commit: `pnpm lint`

- [x] 4. 移除/禁用 Vercel Analytics 运行时耦合

  **What to do**:
  - 从 `app/layout.tsx` 移除 `@vercel/analytics/next` 使用。
  - 清理对应依赖项，避免容器运行时无效请求。

  **Must NOT do**:
  - 不影响页面结构与全局布局行为。
  - 不引入新埋点系统（phase-1 范围外）。

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单点依赖清理，文件范围小。
  - **Skills**: [`beads`]
    - `beads`: 记录依赖与后续验证关联。
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: 非样式改造。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T13
  - **Blocked By**: None

  **References**:
  - `app/layout.tsx` - analytics 组件挂载点。
  - `package.json` - 依赖声明位置。
  - WHY: 避免自托管环境保留无意义 Vercel 遥测调用。

  **Acceptance Criteria**:
  - [ ] `grep -R "@vercel/analytics" app package.json` 无命中。
  - [ ] 页面可正常启动访问 `/login`。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 应用启动无 analytics 依赖错误（Happy path）
    Tool: Bash
    Preconditions: 代码已移除 analytics 引用
    Steps:
      1. 启动应用容器/本地服务
      2. 请求 `/login`
      3. 断言返回 200
    Expected Result: 页面可访问
    Evidence: .sisyphus/evidence/task-T4-layout-pass.txt

  Scenario: 依赖遗漏导致构建失败可识别（Failure path）
    Tool: Bash
    Preconditions: 模拟未清理依赖引用（仅验证场景）
    Steps:
      1. 执行 lint/build
      2. 捕获错误信息
    Expected Result: 报错明确定位到 analytics 引用
    Evidence: .sisyphus/evidence/task-T4-layout-fail.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-T4-layout-pass.txt`
  - [ ] `task-T4-layout-fail.txt`

  **Commit**: YES
  - Message: `chore(runtime): remove vercel analytics coupling`
  - Files: `app/layout.tsx`, `package.json`（如需）
  - Pre-commit: `pnpm lint`

- [x] 5. 创建 dashboard 生产镜像 Dockerfile

  **What to do**:
  - 新增多阶段 Dockerfile（构建 + 运行）用于 Next.js dashboard。
  - 构建阶段使用 `pnpm run build:app`（或等效纯构建命令），禁止在镜像构建阶段执行数据库迁移。
  - 运行层使用最小依赖，入口对齐 `pnpm start`（或 standalone server）。
  - 暴露容器端口 3000。

  **Must NOT do**:
  - 不把 `.env` 或 secrets 拷贝进镜像。
  - 不在镜像中写死主机端口。

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 主要改动集中在 Dockerfile。
  - **Skills**: [`beads`]
    - `beads`: 跟踪镜像构建与后续 compose 依赖。
  - **Skills Evaluated but Omitted**:
    - `secret-guard`: 在提交前统一扫描即可。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T7
  - **Blocked By**: None

  **References**:
  - `package.json` - build/start 命令来源。
  - `next.config.ts` - 构建输出行为。
  - `scripts/migrate.mjs` - build 阶段迁移依赖。
  - WHY: 镜像必须准确反映项目实际启动链路。

  **Acceptance Criteria**:
  - [ ] `docker build -t cliproxy-dashboard:local .` 成功。
  - [ ] 构建日志中不出现迁移执行步骤（migrate 仅在运行期 one-shot service 执行）。
  - [ ] `docker run -p 8318:3000` 后 `/login` 返回 200。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 镜像构建与启动成功（Happy path）
    Tool: Bash
    Preconditions: Docker daemon 可用
    Steps:
      1. 执行 docker build（确认未触发 migrate）
      2. 启动容器映射 8318:3000
      3. curl /login
    Expected Result: HTTP 200
    Evidence: .sisyphus/evidence/task-T5-dockerfile-pass.txt

  Scenario: 缺失关键 env 时服务失败可识别（Failure path）
    Tool: Bash
    Preconditions: 不传必要 env 启动容器
    Steps:
      1. 启动容器
      2. 观察日志与退出码
    Expected Result: 明确报错而非静默成功
    Evidence: .sisyphus/evidence/task-T5-dockerfile-fail.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-T5-dockerfile-pass.txt`
  - [ ] `task-T5-dockerfile-fail.txt`

  **Commit**: YES
  - Message: `build(docker): add production Dockerfile with app-only build stage`
  - Files: `Dockerfile`
  - Pre-commit: `docker build -t cliproxy-dashboard:local .`

- [ ] 6. 添加 `.dockerignore` 与 docker env 模板

  **What to do**:
  - 新增 `.dockerignore`（排除 node_modules/.git/.sisyphus/backups 等）。
  - 新增 docker 场景 env 模板（如 `.env.docker.example`）并与 compose 对齐。

  **Must NOT do**:
  - 不把真实 secrets 写入模板。
  - 不遗漏 `backups/`、`.sisyphus/` 等非构建资产。

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 文本配置文件改动，范围小。
  - **Skills**: [`beads`, `secret-guard`]
    - `beads`: 配置链路追踪。
    - `secret-guard`: 模板与忽略规则防泄漏。
  - **Skills Evaluated but Omitted**:
    - `playwright`: 非浏览器任务。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T7, T13
  - **Blocked By**: None

  **References**:
  - `.env.example` - 当前 env 合约基线。
  - `package.json` - 构建上下文需求。
  - WHY: 保证镜像构建上下文最小化且部署配置可复制。

  **Acceptance Criteria**:
  - [ ] `.dockerignore` 覆盖 `.sisyphus/` 与 `backups/`。
  - [ ] docker env 模板包含 compose 所需全部键且无真实值。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 构建上下文正确裁剪（Happy path）
    Tool: Bash
    Preconditions: .dockerignore 已更新
    Steps:
      1. 执行 docker build
      2. 检查构建日志中上下文体积明显缩小
      3. 断言构建成功
    Expected Result: 构建通过且无多余上下文
    Evidence: .sisyphus/evidence/task-T6-dockerignore-pass.txt

  Scenario: env 模板安全性检查（Failure path）
    Tool: Bash
    Preconditions: 模板文件已创建
    Steps:
      1. grep 常见 secret 模式（sk-, password=）
      2. 检查命中结果
    Expected Result: 无 secret 命中
    Evidence: .sisyphus/evidence/task-T6-dockerignore-failcheck.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-T6-dockerignore-pass.txt`
  - [ ] `task-T6-dockerignore-failcheck.txt`

  **Commit**: YES
  - Message: `chore(docker): add dockerignore and docker env template`
  - Files: `.dockerignore`, `.env.docker.example`
  - Pre-commit: `pnpm lint`

- [ ] 7. 扩展 unified compose：接入 dashboard + postgres + migrate + cli-proxy-api

  **What to do**:
  - 在仓库根 `docker-compose.yml` 中并入 `dashboard`、`postgres`、`migrate` 与 `cli-proxy-api` 服务。
  - `cli-proxy-api` 使用用户提供的既有配置（镜像/端口/卷/restart）原样迁移。
  - `migrate` 作为 one-shot service：依赖 `postgres healthy` 后执行迁移并 fail-fast。
  - `dashboard` 使用 `8318:3000`，`postgres` 使用持久化 volume。
  - 配置 network/depends_on/healthcheck 基础关系。

  **Must NOT do**:
  - 不破坏现有 `cli-proxy-api` 服务端口与 volume。
  - 不暴露 postgres 到公网端口（内网服务优先）。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 编排改动影响多服务启动依赖。
  - **Skills**: [`beads`, `secret-guard`]
    - `beads`: 编排依赖追踪。
    - `secret-guard`: compose env 安全检查。
  - **Skills Evaluated but Omitted**:
    - `github-cli`: 非远程仓库任务。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2（核心起点）
  - **Blocks**: T8, T9, T10, T11, T12, T15
  - **Blocked By**: T1, T3, T5, T6

  **References**:
  - 用户现有 compose 片段（`cli-proxy-api` 服务定义）。
  - `.env.docker.example` - compose env 键来源。
  - `package.json` - dashboard 容器启动命令来源。
  - WHY: 保证并入现有栈时行为兼容且不破坏旧服务。

  **Acceptance Criteria**:
  - [ ] `docker compose config --quiet` 通过。
  - [ ] `docker compose up -d dashboard postgres cli-proxy-api` 成功。
  - [ ] `docker compose run --rm migrate` 成功（退出码 0）。
  - [ ] `curl http://localhost:8318/login` 返回 200。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 三服务联合启动（Happy path）
    Tool: Bash
    Preconditions: compose 文件已更新
    Steps:
      1. 执行 `docker compose up -d`
      2. 检查 postgres 健康状态并运行 `docker compose run --rm migrate`
      3. curl dashboard /login
    Expected Result: 服务健康且 dashboard 可访问
    Evidence: .sisyphus/evidence/task-T7-compose-pass.txt

  Scenario: 配置错误时 compose 校验失败（Failure path）
    Tool: Bash
    Preconditions: 使用错误 env 或缺键
    Steps:
      1. 执行 `docker compose config --quiet`
      2. 捕获错误输出
    Expected Result: 非 0 并指出缺失配置
    Evidence: .sisyphus/evidence/task-T7-compose-fail.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-T7-compose-pass.txt`
  - [ ] `task-T7-compose-fail.txt`

  **Commit**: YES
  - Message: `feat(compose): integrate dashboard, postgres, migrate and cli-proxy-api`
  - Files: `docker-compose.yml`
  - Pre-commit: `docker compose config --quiet`

- [ ] 8. 增加 sync-cron sidecar（替代 vercel cron）

  **What to do**:
- 在 compose 增加 cron sidecar，按计划频率调用 `/api/sync`。
- 在 compose 增加 cron sidecar，按 `0 21 * * *`（Asia/Shanghai）调用 `/api/sync`。
  - 使用 `CRON_SECRET`（优先）或约定 token 头，不复用弱凭据。
  - 失败时记录可观察日志（状态码、重试策略）。

  **Must NOT do**:
  - 不依赖 `vercel.json` cron。
  - 不把 token 硬编码在镜像/脚本里。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 涉及定时任务安全与系统可用性。
  - **Skills**: [`beads`, `secret-guard`]
    - `beads`: 任务链路追踪。
    - `secret-guard`: cron token 安全。
  - **Skills Evaluated but Omitted**:
    - `playwright`: 非 UI。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2（与 T9~T12 并行）
  - **Blocks**: T15
  - **Blocked By**: T3, T7

  **References**:
  - `vercel.json` - 现有 cron 频率来源。
  - `app/api/sync/route.ts` - 被调用端点。
  - `cf-worker-sync.js` - 现有外部触发逻辑参考。
  - WHY: 迁移后必须保留同步能力且不再依赖平台 cron。

  **Acceptance Criteria**:
  - [ ] sidecar 可按计划触发 `/api/sync`。
  - [ ] `curl -H "Authorization: Bearer $CRON_SECRET" /api/sync` 返回成功或可预期业务响应。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: cron sidecar 成功触发同步（Happy path）
    Tool: Bash (docker compose logs + curl)
    Preconditions: dashboard 已启动，CRON_SECRET 已配置
    Steps:
      1. 手动触发一次 sidecar 命令
      2. 检查 /api/sync 响应码
      3. 检查 sidecar 日志含成功记录
    Expected Result: 同步触发成功
    Evidence: .sisyphus/evidence/task-T8-cron-pass.txt

  Scenario: 错误 token 被拒绝（Failure path）
    Tool: Bash (curl)
    Preconditions: 使用错误 Bearer token
    Steps:
      1. 调用 /api/sync
      2. 断言 401/403
    Expected Result: 未授权请求被拒绝
    Evidence: .sisyphus/evidence/task-T8-cron-fail.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-T8-cron-pass.txt`
  - [ ] `task-T8-cron-fail.txt`

  **Commit**: YES
  - Message: `feat(sync): add compose cron sidecar for api sync`
  - Files: `docker-compose.yml`, `scripts/*cron*`
  - Pre-commit: `docker compose up -d`

- [ ] 9. 增加 Postgres 备份服务与 7 天保留策略

  **What to do**:
  - 增加备份脚本/sidecar，输出到 `./backups/postgres`。
  - 实现保留策略：仅保留最近 7 天。
  - 记录失败日志并返回非 0。

  **Must NOT do**:
  - 不把备份写入容器临时层。
  - 不忽略清理失败（否则磁盘不可控增长）。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 涉及数据安全与运维可靠性。
  - **Skills**: [`beads`, `secret-guard`]
    - `beads`: 备份流程任务跟踪。
    - `secret-guard`: 防止备份日志泄漏敏感信息。
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: 非 UI。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T14, T15
  - **Blocked By**: T7

  **References**:
  - `docker-compose.yml` - backup sidecar 接入点。
  - 用户约束：每日备份、保留 7 天、路径 `./backups/postgres`。
  - WHY: 明确落盘与保留策略是 phase-1 的硬目标。

  **Acceptance Criteria**:
  - [ ] `docker compose run --rm pg-backup` 成功。
  - [ ] 备份目录存在新文件。
  - [ ] 备份数量 <= 7（按策略裁剪后）。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 备份生成成功（Happy path）
    Tool: Bash
    Preconditions: postgres healthy, backups 目录可写
    Steps:
      1. 执行 pg-backup 任务
      2. 列出 ./backups/postgres
      3. 断言新增文件存在
    Expected Result: 备份文件生成
    Evidence: .sisyphus/evidence/task-T9-backup-pass.txt

  Scenario: 无写权限时显式失败（Failure path）
    Tool: Bash
    Preconditions: 模拟目录不可写
    Steps:
      1. 执行 pg-backup
      2. 捕获退出码与错误日志
    Expected Result: 非 0 且错误可读
    Evidence: .sisyphus/evidence/task-T9-backup-fail.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-T9-backup-pass.txt`
  - [ ] `task-T9-backup-fail.txt`

  **Commit**: YES
  - Message: `feat(ops): add postgres backup with 7-day retention`
  - Files: `scripts/backup-*`, `docker-compose.yml`
  - Pre-commit: `docker compose run --rm pg-backup`

- [ ] 10. 固化备份目录策略与仓库忽略规则

  **What to do**:
  - 在 `.gitignore` 增加 `backups/`（及必要子路径）忽略。
  - 建立备份目录初始化策略（目录不存在自动创建）。
  - 文档中明确该目录仅本地运维使用。

  **Must NOT do**:
  - 不把备份文件纳入版本控制。
  - 不覆盖已有用户本地备份文件。

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 配置/文档小改动。
  - **Skills**: [`beads`]
    - `beads`: 与 T9/T14 协同追踪。
  - **Skills Evaluated but Omitted**:
    - `secret-guard`: 本任务不处理 secret 值。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T14
  - **Blocked By**: T7

  **References**:
  - `.gitignore` - 忽略规则。
  - `README.md`/runbook 文档 - 备份目录说明。
  - WHY: 防止误提交大文件与敏感数据。

  **Acceptance Criteria**:
  - [ ] `git status --short` 不再显示 `backups/postgres/*`。
  - [ ] 目录初始化后备份任务可写入。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 备份目录被正确忽略（Happy path）
    Tool: Bash
    Preconditions: backups 目录存在示例文件
    Steps:
      1. 创建测试备份文件
      2. 执行 git status --short
      3. 断言该文件不出现在未跟踪列表
    Expected Result: 备份文件被忽略
    Evidence: .sisyphus/evidence/task-T10-gitignore-pass.txt

  Scenario: 忽略规则误配可识别（Failure path）
    Tool: Bash
    Preconditions: 临时检查规则覆盖
    Steps:
      1. 执行 git check-ignore -v backups/postgres/test.sql
      2. 捕获输出
    Expected Result: 能定位规则来源；若无命中则失败
    Evidence: .sisyphus/evidence/task-T10-gitignore-fail.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-T10-gitignore-pass.txt`
  - [ ] `task-T10-gitignore-fail.txt`

  **Commit**: YES
  - Message: `chore(repo): ignore local postgres backups`
  - Files: `.gitignore`
  - Pre-commit: `git check-ignore -v backups/postgres/test.sql`

- [ ] 11. 完成 compose 健康检查与依赖门禁链路

  **What to do**:
  - 为 postgres 添加 `pg_isready` healthcheck。
  - 为 dashboard 配置依赖 `postgres: service_healthy`。
  - 为 dashboard 添加可执行 healthcheck（基于 `/api/management-url`）。

  **Must NOT do**:
  - 不使用“sleep 固定等待”替代健康检查。
  - 不让 dashboard 在 db 未就绪时启动成功。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 关系到启动稳定性与编排正确性。
  - **Skills**: [`beads`]
    - `beads`: 编排依赖闭环跟踪。
  - **Skills Evaluated but Omitted**:
    - `playwright`: 非 UI。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T15
  - **Blocked By**: T1, T3, T7

  **References**:
  - `docker-compose.yml` - service health 配置点。
  - `app/api/management-url/route.ts` - dashboard 健康检查端点。
  - WHY: 消除启动竞态与假健康状态。

  **Acceptance Criteria**:
  - [ ] `docker compose ps` 显示 postgres/dashboard healthy。
  - [ ] 在 postgres 未就绪时 dashboard 不会提前变为 healthy。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 依赖健康门禁生效（Happy path）
    Tool: Bash
    Preconditions: compose healthcheck 已配置
    Steps:
      1. docker compose up -d
      2. 观察 postgres -> dashboard 健康状态顺序
      3. 断言 dashboard 最终 healthy
    Expected Result: 启动顺序正确
    Evidence: .sisyphus/evidence/task-T11-health-pass.txt

  Scenario: 强制 postgres 不健康时 dashboard 不健康（Failure path）
    Tool: Bash
    Preconditions: 暂停或停止 postgres
    Steps:
      1. 停止 postgres
      2. 检查 dashboard 健康状态
    Expected Result: dashboard 不能保持 healthy
    Evidence: .sisyphus/evidence/task-T11-health-fail.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-T11-health-pass.txt`
  - [ ] `task-T11-health-fail.txt`

  **Commit**: YES
  - Message: `fix(compose): add health checks and startup gating`
  - Files: `docker-compose.yml`
  - Pre-commit: `docker compose up -d`

- [ ] 12. 校准内网部署下登录 cookie 安全策略

  **What to do**:
  - 在 `proxy.ts` 与 `app/api/auth/verify/route.ts` 引入可配置 cookie secure 策略（默认适配内网 HTTP）。
  - 增加配置注释，避免生产 HTTPS 与内网 HTTP 行为混淆。

  **Must NOT do**:
  - 不降低密码校验或鉴权强度。
  - 不引入“默认明文公网 cookie”风险（限定内网场景说明）。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 涉及登录会话稳定性与安全边界。
  - **Skills**: [`beads`, `secret-guard`]
    - `beads`: 跨鉴权路径一致性追踪。
    - `secret-guard`: 防止安全回归。
  - **Skills Evaluated but Omitted**:
    - `web-design-guidelines`: 非界面规范审计。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T15
  - **Blocked By**: T3, T7

  **References**:
  - `proxy.ts` - 全局 cookie refresh 策略。
  - `app/api/auth/verify/route.ts` - 登录成功设置 cookie。
  - WHY: 保证内网 HTTP 模式下仍能稳定登录。

  **Acceptance Criteria**:
  - [ ] 内网 HTTP 访问时登录后会话可保持。
  - [ ] 未授权访问仍被正确重定向/拒绝。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: HTTP 内网登录后会话持续（Happy path）
    Tool: Playwright
    Preconditions: dashboard 运行在 http://localhost:8318
    Steps:
      1. 打开 /login 输入正确密码并提交
      2. 跳转首页后刷新页面
      3. 断言仍在受保护页面（未回登录）
    Expected Result: cookie 策略支持内网会话
    Evidence: .sisyphus/evidence/task-T12-cookie-pass.png

  Scenario: 错误密码/无 cookie 访问被拒绝（Failure path）
    Tool: Playwright
    Preconditions: 清理 cookie
    Steps:
      1. 直接访问受保护路由
      2. 断言跳转到 /login
    Expected Result: 访问控制仍生效
    Evidence: .sisyphus/evidence/task-T12-cookie-fail.png
  ```

  **Evidence to Capture**:
  - [ ] `task-T12-cookie-pass.png`
  - [ ] `task-T12-cookie-fail.png`

  **Commit**: YES
  - Message: `fix(auth): align cookie security for internal docker deployment`
  - Files: `proxy.ts`, `app/api/auth/verify/route.ts`
  - Pre-commit: `pnpm lint`

- [ ] 13. 编写部署/更新/回滚 runbook（并入现有 compose）

  **What to do**:
  - 编写可复制执行的部署步骤：构建、启动、升级、回滚。
  - 明确“并入现有 compose”的服务改造顺序与风险点。
  - 标注 phase-1 边界（无 TLS/HA/历史数据迁移）。

  **Must NOT do**:
  - 不写模糊描述（必须有命令级步骤）。
  - 不要求人工“自己试一下”作为验收。

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: 运维文档为主，需精确命令与顺序。
  - **Skills**: [`beads`, `secret-guard`]
    - `beads`: 与实现任务对齐。
    - `secret-guard`: 避免文档中泄露敏感值。
  - **Skills Evaluated but Omitted**:
    - `playwright`: 非 UI 操作。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: F1, F4
  - **Blocked By**: T4, T6, T7

  **References**:
  - `README.md` - 当前运行文档基线。
  - `docker-compose.yml` - 实际执行对象。
  - WHY: 保证运维执行不依赖隐性知识。

  **Acceptance Criteria**:
  - [ ] runbook 含 start/update/rollback/stop 全套命令。
  - [ ] 命令均可在目标主机复制执行。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: runbook 启动链路可执行（Happy path）
    Tool: Bash
    Preconditions: runbook 已生成
    Steps:
      1. 按文档执行启动命令
      2. 检查服务状态
      3. 访问 dashboard 端口验证
    Expected Result: 文档命令与实际一致
    Evidence: .sisyphus/evidence/task-T13-runbook-pass.txt

  Scenario: 回滚命令可执行（Failure/rollback path）
    Tool: Bash
    Preconditions: 存在上一个镜像 tag
    Steps:
      1. 按文档执行回滚
      2. 验证服务恢复
    Expected Result: 回滚流程可复现
    Evidence: .sisyphus/evidence/task-T13-runbook-rollback.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-T13-runbook-pass.txt`
  - [ ] `task-T13-runbook-rollback.txt`

  **Commit**: YES
  - Message: `docs(deploy): add docker compose deployment and rollback runbook`
  - Files: `README.md` / `docs/*.md`
  - Pre-commit: 文档命令 dry-run

- [ ] 14. 编写备份运维文档（每日备份 + 7天保留）

  **What to do**:
  - 文档化备份任务触发、保留策略、失败排查。
  - 标注本阶段“仅备份，不做定期 restore drill”。
  - 增加备份目录巡检与磁盘容量检查命令。

  **Must NOT do**:
  - 不把恢复演练写成当前强制项（用户已排除）。
  - 不遗漏失败处理与告警建议。

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: 纯运维文档工作。
  - **Skills**: [`beads`]
    - `beads`: 与 T9/T10 保持一致。
  - **Skills Evaluated but Omitted**:
    - `secret-guard`: 文档不应出现 secret 值，常规审查可覆盖。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: F1, F3
  - **Blocked By**: T9, T10

  **References**:
  - `scripts/backup-*` - 备份执行逻辑。
  - `./backups/postgres` - 落盘路径约束。
  - WHY: 让值班运维能独立处理备份问题。

  **Acceptance Criteria**:
  - [ ] 文档给出每日任务执行命令与保留验证命令。
  - [ ] 文档明确“不含 restore drill”范围边界。

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 文档指引下备份验证通过（Happy path）
    Tool: Bash
    Preconditions: 文档已更新
    Steps:
      1. 按文档执行 pg-backup
      2. 按文档执行保留检查
    Expected Result: 命令与结果一致
    Evidence: .sisyphus/evidence/task-T14-backup-doc-pass.txt

  Scenario: 文档排障路径有效（Failure path）
    Tool: Bash
    Preconditions: 模拟备份目录不可写
    Steps:
      1. 按文档排障步骤执行
      2. 记录是否能定位问题
    Expected Result: 能定位到权限/路径问题
    Evidence: .sisyphus/evidence/task-T14-backup-doc-fail.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-T14-backup-doc-pass.txt`
  - [ ] `task-T14-backup-doc-fail.txt`

  **Commit**: YES
  - Message: `docs(ops): add postgres backup and retention guide`
  - Files: `docs/*.md` 或 `README.md`
  - Pre-commit: 文档命令验证

- [ ] 15. 执行 tests-after QA 矩阵并固化证据

  **What to do**:
  - 运行 lint/build + compose up + API smoke + cron + backup 全链路。
  - 汇总证据并给出 PASS/FAIL 明确结论。
  - 记录 edge case（空库、上游不可达、错误 token）。

  **Must NOT do**:
  - 不用“人工感受正常”替代命令结果。
  - 不跳过失败场景验证。

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 跨服务集成验证，任务面广。
  - **Skills**: [`playwright`, `beads`]
    - `playwright`: UI/登录流程与受保护路由验证。
    - `beads`: QA 证据追踪。
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: 非视觉设计任务。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3（收口任务）
  - **Blocks**: F1, F2, F3, F4
  - **Blocked By**: T2, T7, T8, T9, T11, T12

  **References**:
  - `.sisyphus/evidence/` - 统一证据输出目录。
  - `docker-compose.yml` - 被测系统编排定义。
  - `app/api/sync/route.ts`, `app/api/management-url/route.ts` - 关键 API 入口。
  - WHY: 最终交付必须有可复现证据而非口头结论。

  **Acceptance Criteria**:
  - [ ] `pnpm lint` PASS
  - [ ] `pnpm build` PASS
  - [ ] `docker compose up -d` PASS
  - [ ] `/login` 200
  - [ ] `/api/sync` 授权调用可用
  - [ ] `pg-backup` 成功且保留 <= 7

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 全链路 smoke 通过（Happy path）
    Tool: Bash + Playwright
    Preconditions: compose 服务全部启动
    Steps:
      1. 执行 lint/build
      2. 请求 /login 与 /api/management-url
      3. 触发 /api/sync 与 pg-backup
      4. Playwright 验证登录后受保护页面可访问
    Expected Result: 全部步骤通过
    Evidence: .sisyphus/evidence/task-T15-smoke-pass.txt

  Scenario: 错误 token 与上游异常处理（Failure path）
    Tool: Bash
    Preconditions: 使用错误 CRON_SECRET 或模拟上游不可达
    Steps:
      1. 调用 /api/sync（错误 token）
      2. 记录状态码
      3. 检查日志中的错误可读性
    Expected Result: 拒绝未授权并输出可追踪错误
    Evidence: .sisyphus/evidence/task-T15-smoke-fail.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-T15-smoke-pass.txt`
  - [ ] `task-T15-smoke-fail.txt`

  **Commit**: YES
  - Message: `test(deploy): verify docker stack, sync, and backup flows`
  - Files: `.sisyphus/evidence/*`（或 CI 记录）
  - Pre-commit: 全套 smoke 命令

---

## Final Verification Wave (MANDATORY)

- [ ] F1. **Plan Compliance Audit** — `oracle`
  - 对 Must Have / Must NOT Have / Tasks 逐条比对，要求证据完备并可复现。
  - 输出：`Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  - 执行 lint/build + 改动文件审查 + 反模式扫描。
  - 输出：`Build [PASS/FAIL] | Lint [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Runtime QA** — `unspecified-high` (+ `playwright`)
  - 启动 compose 后验证 dashboard/API/cron/backup 全链路。
  - 输出：`Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  - 校验无 scope creep（特别是无 `next-env.d.ts` 污染，无 phase-1 外扩）。
  - 输出：`Tasks [N/N compliant] | Contamination [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

- Commit 1: `refactor(db): decouple vercel postgres runtime`
- Commit 2: `build(docker): add dashboard image and compose stack`
- Commit 3: `feat(ops): add sync cron and postgres backup retention`
- Commit 4: `docs(deploy): add local compose runbook and QA matrix`

---

## Success Criteria

### Verification Commands
```bash
docker compose config --quiet
docker compose up -d
docker compose run --rm migrate
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8318/login
docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
docker compose run --rm pg-backup
```

### Final Checklist
- [ ] 单机 compose 一体化成功启动
- [ ] dashboard 在 8318 可访问
- [ ] 本地 Postgres 持久化正常
- [ ] cron sidecar 成功触发 `/api/sync`
- [ ] 备份策略（每日+7天）可执行
- [ ] 无 Vercel 绑定残留于运行路径
- [ ] 无 `next-env.d.ts` 污染
