
- `proxy.ts` 现已按路径区分 admin 区域与 future user 区域：`/user` 与 `/api/user` 前缀优先走 user session，其余现有页面仍只接受 `dashboard_auth`。
- user session 不能复用 `dashboard_auth`；当前实现使用独立的 `dashboard_user_session`，并通过服务端签名后的 httpOnly cookie 保存 `route`，后续 user API 可直接复用该 helper 取回 route。
- `/api/auth/verify` 可以继续沿用 Basic Auth 提交方式，只要把 `from` 放在 query string，就能在不暴露原始 key 的前提下返回角色感知的 `redirectTo`。
- `app/login/page.tsx` 的登录输入框由 `credential` 受控；若要在失败后清空凭据且保留错误提示，只需在 `handleSubmit` 的失败分支（含异常兜底）重置 `credential`，无需改动锁定倒计时或成功跳转逻辑。`pnpm run lint` 与带 `DATABASE_URL` 的 `pnpm run build` 已通过。
- `app/layout.tsx` 仍全局包裹 `ClientLayout`，因此给 `/user` 增加独立壳体时，最小改法是在 `ClientLayout` 中把 `/user` 前缀当作“无全局 admin sidebar 区域”，再由 `app/user/layout.tsx` 自己挂载 `UserSidebar`。
- `/user` 路由保护应只信任 `dashboard_user_session`：`proxy.ts` 的 user 分支如果继续接受 admin cookie/header，就会把管理员误导回 admin shell，而不是保持统一 `/login?from=...` 的 user 入口体验。
- 用户壳体可直接复用现有暗色侧栏的宽度、边框和间距语言，但导航必须严格收敛为 `/user`、`/user/records` 和退出，不要带入 admin 的 logs、CPAMC、usage toggle 或其他运维控件。
- `/api/user/overview` 与 `/api/user/records` 现在都只从 `dashboard_user_session` 取 `route` 作为身份边界；客户端即使继续传 `route` / `name` / `source`，handler 也不会读取它们。
- user overview 单独使用按 `session.route + view + safe filters` 组装的服务端缓存键，user records 直接走 `private, no-store`，避免把 admin 现有的无身份缓存复用到不同 user 会话之间。
- Task 4 已把 `/api/user/overview` 定型为可直接驱动 `/user` 首页的合同：响应同时提供安全 `overview`、`trends.byDay/byHour` 与服务端 `summary`/顶层别名字段（`totalTokens`、`estimatedCost`/`totalCost`、`avgTpm`、`requestCount`/`totalRequests`），因此 Task 5 只需展示和格式化，不要在客户端重算 TPM。
- Task 5 的 `/user` 页面已使用独立的 `userRangeSelection` localStorage 键保存 preset/custom 范围，避免与 admin 首页的 `rangeSelection` 互相污染。
- user dashboard 的“全站聚合”可见性目前由前端对同参数 `view=global` 请求做 403 探测决定；一旦可用，切换只重载首页概览卡片与趋势图，不会改变 `/user/records` 的用户边界。
- Task 6 的 `/user/records` 适合直接在页面内复用 admin records 的排序头、DayPicker 时间范围选择与 cursor 分页模式，但列集合必须硬编码为安全字段白名单，不能沿用 admin 的列配置存储键，否则会把隐藏的 admin 列状态带进 user 模式。
- 用户记录页的错误、帮助文案与筛选摘要都应只提“模型 / 时间 / 安全字段”，即使服务端已做 route/source/provider 剥离，前端文案也不能回显这些内部概念，避免泄漏实现细节。
- `/user/records` 如果实现成纯 client page，Next 仍可能产出静态 `.next/server/app/user/records.html`；对带认证边界的 user 路由，更稳妥的最小修复是让 `page.tsx` 只负责导出 `dynamic = "force-dynamic"` 并渲染相邻 client 组件，这样实际输出不会继续依赖旧的预渲染 HTML。
- 2026-04-10 Task 6 runtime QA：隔离端口 `9318` 上如果仍跑 `cpa-runtime/docker-compose.yml` 里的预构建镜像，就算源码已经修好，浏览器也只会看到旧实现（本次表现为 admin 壳 + `/user/records` 404）。要验证当前分支，必须让 `9318` 改由仓库源码启动。
- 2026-04-10 Task 6 runtime QA：当前配置里 `config.password = PASSWORD || CLIPROXY_SECRET_KEY`，因此若本地 QA 进程把 `PASSWORD` 留空且 `CLIPROXY_SECRET_KEY` 恰好复用 user service key，登录页会把 user key 误判成 admin 凭据并跳到 `/`。运行用户流验收时需要给本地 QA 进程设置独立的 `PASSWORD` 值，避免干扰 user 登录分支。
- repo-local `cpa-runtime/` 可以作为独立复制的测试 runtime 安全使用；当前已切换为对外暴露 `9317/9318`，避免和用户家目录里的 CPA 实例冲突。
- Task 7 的用户 quota 能力应继续沿用“server-only identity + server-only normalization”模式：前端只请求 `/api/user/quota`，真正的 `session.route -> usage_records.authIndex -> auth-files -> provider quota API` 解析链全部留在服务端，避免把 `auth_index`、文件名或 provider 原始响应交给客户端。
- `/user` 首页如果需要隐藏某个可选面板，而开关又不是 `NEXT_PUBLIC_*`，最小改法可以让 client page 直接探测对应 user API：当接口在服务端 gate 关闭时返回 404，页面保持不渲染；只有接口可用时才展示次级 section。

## 2026-04-10 Task 5 `/user` runtime QA (port 3203)

- 使用隔离的 repo-local runtime 完成真实浏览器 QA：从 `http://127.0.0.1:3203/login?from=%2Fuser` 登录后成功进入 `/user`，用户壳体仅显示 `用户仪表盘` / `我的记录` 两个导航项，未出现 admin nav/ops controls。
- `/user` 首页在概览加载完成后稳定渲染 4 个摘要卡（`Tokens`、`Estimated Cost`、`平均 TPM`、`Request Count`）以及至少 1 个趋势可视化；本次运行同时看到了 `按日` / `按小时` 切换和 1 个图表 application 区域。
- 时间过滤在本地环境可实际工作：初始为 `最近 14 天`，点击 `自定义` 后切换为 `2026-04-08 ~ 2026-04-10（共 4 天）`，刷新后页面与 `userRangeSelection` localStorage 都保留相同自定义范围。
- 本次 3203 环境未显示“全站聚合”切换，因此按需求记录为“未显示、无需判失败”；如果后续环境开启该能力，需要单独复验“仅影响卡片/图表、不扩大 records scope”。
- 证据文件：`.sisyphus/evidence/task5-user-dashboard-2026-04-10T11-14-29-719Z.png`、`.sisyphus/evidence/task5-user-dashboard-2026-04-10T11-14-29-719Z.json`。为排查早期脚本误报还额外保存了 `.sisyphus/evidence/task5-user-dashboard-main.html` 与 `.sisyphus/evidence/task5-user-dashboard-main.txt`，可见页面在登录后会短暂显示 `正在加载概览`，QA 脚本需要等该状态消失后再断言摘要卡。

## 2026-04-10 Task 8 closure / boundary hardening

- `ALLOW_USER_SEE_TOTAL_USAGE` 已补回统一配置层：`lib/config.ts`、`.env.example`、`README.md` 现在都明确声明默认 `false`，运行时不再由 `app/api/user/overview/route.ts` 私下单点读取环境变量。
- 当前源码 QA 进程已在 repo-local 隔离环境 `http://127.0.0.1:3205` 复验，底层连接 `cpa-runtime` 的 `9317` upstream 与隔离 Postgres 容器，未触碰用户家目录实例。
- API 证据：`.sisyphus/evidence/task8-runtime-api-blocked-20260410-121938.json`
  - user 登录成功后仅得到 `dashboard_user_session`。
  - user session 访问 `/api/logs`、`/api/request-error-logs`、`/api/usage-statistics-enabled`、`/api/management-url` 均被 `307` 重定向回 `/login?from=...`；`/api/sync` 返回 `401 {"error":"Unauthorized"}`。
  - 默认 gate 关闭时，`/api/user/overview?view=global` 返回 `403 {"error":"Global overview is not available"}`，`/api/user/quota` 返回 `404 {"error":"Not Found"}`。
- 浏览器证据：`task8-user-boundary.png`、`task8-user-boundary-snapshot.md`、`task8-user-boundary-network.log`、`task8-user-boundary-console.log`
  - `/user` 真实渲染只剩 `用户仪表盘` / `我的记录` / `退出登录`，未出现 admin `日志`、`前往 CPAMC`、`上游使用统计` 等控件。
  - 网络日志只出现 `POST /api/auth/verify`、`GET /api/user/overview?days=14`、`GET /api/user/overview?days=14&view=global -> 403`、`GET /api/user/quota -> 404`，没有任何 admin API 请求成功落地。
  - `/user` 页面的说明/卡片文案已收口为“当前登录身份”，不再出现 `service key` / `当前 key` / `route` / `source` / `凭证名` 这类用户态内部术语。

## 2026-04-10 F4 scope-fidelity audit

- 代码审计：`app/api/user/records/route.ts` 只读取 `limit/sort/cursor/model/start/end/includeFilters`，不读取客户端 `route/source`；`lib/queries/user-safe.ts` 在 `getUserUsageRecords()` 内强制注入 `route: session.route`，并通过 `toUserUsageRecord()` 删除 `route/source/credentialName/provider`。
- 代码审计：`app/api/user/overview/route.ts` 把 `view=global` 与 `config.allowUserSeeTotalUsage` 绑定，且 cache key 显式包含 `sessionRoute + view + safe filters`；`lib/queries/user-safe.ts` 仅在 `view=self` 时注入 `route: session.route`。
- 代码审计：`app/api/user/quota/route.ts` 在 `ALLOW_USER_SEE_QUOTA=false` 时直接 `404`；`lib/user-quota.ts` 返回的 DTO 顶层仅含 `enabled/available/providerLabel/groupLabel/planLabel/creditSummary/items/status/refreshedAt`，条目仅含 `id/label/remainingRatio/remainingLabel/usedLabel/resetLabel`。
- 运行时 QA：repo-local 真实登录环境 `3205` 上，同一 user session 请求 `/api/user/records?limit=3&includeFilters=1` 与 `/api/user/records?limit=3&includeFilters=1&route=someone-else&source=someone-else` 返回完全相同 payload；返回项键仅有 `id/occurredAt/model/totalTokens/inputTokens/outputTokens/reasoningTokens/cachedTokens/cost/isError`。
- 运行时 QA：`3205` 上 user1 与 user2 分别请求 `/api/user/overview?days=7`，得到明显不同的 `totalTokens/requestCount/trend`（user1: `674107954 / 7631 / byDay=7, byHour=66`；user2: `5195663 / 108 / byDay=2, byHour=6`）；各自追加篡改参数 `route/name/source` 后 payload 保持不变，说明未因参数或缓存复用串出他人明细。
- 运行时 QA：`3205` 上 `/api/user/overview?days=7&view=global` 返回 `403 {"error":"Global overview is not available"}`；另在已有 `ALLOW_USER_SEE_TOTAL_USAGE=true` 隔离 runtime `3107` 上，用同 route 的有效签名 `dashboard_user_session` 请求 `/api/user/overview?days=7&view=global` 返回 `200`，追加 `route/name/source` 篡改参数后 payload 不变，递归检查未发现 `routes/names/sources/records/route/name/source/credentialName/provider` 键。
- 运行时 QA：`3203`（quota enabled）上 `/api/user/quota` 返回 `200`，顶层键仅见 `available/creditSummary/enabled/groupLabel/items/planLabel/providerLabel/refreshedAt/status`，条目键仅见 `id/label/remainingLabel/remainingRatio/resetLabel/usedLabel`；递归检查未发现 `authIndex/auth_index/route/source/provider/account/email/id_token/metadata/attributes/credentialName/name` 键。`3204`（quota disabled）上同接口返回 `404 {"error":"Not Found"}`。
- 头部行为：`3205` 的 `/api/user/records`、`/api/user/overview` 与 `3203/3204` 的 `/api/user/quota` 实测都返回 `cache-control: private, no-store, max-age=0`，与 `lib/user-api.ts` 的统一 user API header 一致。
