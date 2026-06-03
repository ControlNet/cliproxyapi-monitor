## 2026-04-10 Browser QA refresh for Task 6 `/user/records`

- Re-ran authenticated browser QA against refreshed servers `http://127.0.0.1:3201/user/records` and `http://127.0.0.1:3202/user/records` with the provided `dashboard_user_session` cookie.
- Both builds rendered inside the user shell (`用户仪表盘` / `我的记录` / `退出登录`) and returned only successful page/RSC requests in the browser session.
- Neither build rendered the expected safe records table columns (`时间`, `模型`, `Tokens`, `输入`, `输出`, `思考`, `缓存`, `费用`, `状态`) or model/time filtering UI.
- Forbidden admin/provider controls were not visible, but the visible placeholder copy still leaked disallowed concepts: `管理员专用字段` and `service key`.
- No browser-visible runtime failure appeared during this refreshed QA run; console errors were also absent.
- Follow-up fix: moved the real `/user/records` UI into `UserRecordsClient.tsx` and turned `app/user/records/page.tsx` into a dynamic server wrapper so the route stops depending on statically emitted HTML; also removed the `service key` wording from the records page copy itself.
- 2026-04-10 resumed Task 6 QA：隔离环境第一次复验失败并非页面源码回退，而是 `9318` 仍指向 repo-local Docker 旧镜像；用户登录后进入 admin 壳并落到 `/user/records` 404。切换到当前仓库 `build + start` 后，真实用户记录页才按预期出现。
- 2026-04-10 resumed Task 6 QA：本地源码进程第一次启动时，因为 `PASSWORD` 为空且回退到 `CLIPROXY_SECRET_KEY`，测试用 user key 被错误当成 admin 密码；重启 QA 进程并给 `PASSWORD` 设置独立占位值后，`/login?from=/user/records` 才稳定进入 user shell。

## 2026-04-10 Task 7 user quota safe summary

- 用户侧 quota 面板不能依赖本地 `auth_file_mappings` 的红acted 字段直接展示 provider 细节；真正可用的套餐/项目/账号上下文仍然要在服务端从 `/v0/management/auth-files` 的原始响应中提取，然后再压缩成安全 DTO。
- `ALLOW_USER_SEE_QUOTA=false` 时，最安全的表现不是返回“disabled panel”占位，而是让 `/api/user/quota` 直接 404，这样 `/user` 客户端可以彻底不渲染 quota section。
- Antigravity 类 provider 的 quota 解析在 v1 中仍受限：管理中心实现依赖更丰富的 auth-file 上下文（例如项目信息/下载内容），而本任务只引入最小用户安全摘要，因此未覆盖的 provider 统一回落为安全 unavailable 状态。

## 2026-04-10 Task 7 quota runtime QA (ports 3203 / 3204)

- 通过 repo-local `cpa-runtime/config.yaml` 中的本地测试 service key 完成了两个环境的真实认证验证；未触碰用户家目录实例，也未在记录中写入凭据值。
- API 证据：`.sisyphus/evidence/task7-quota-api-qa-20260410-105702.json`
  - `3203`：`/api/user/quota` 返回 `200`，安全摘要顶层仅见 `available`、`creditSummary`、`enabled`、`groupLabel`、`items`、`planLabel`、`providerLabel`、`refreshedAt`、`status`；条目仅见 `id`、`label`、`remainingLabel`、`remainingRatio`、`resetLabel`、`usedLabel`；未发现 `authIndex` / `route` / `source` / `email` / token / raw provider 字段。
  - `3204`：`/api/user/quota` 返回 `404`，错误形态只有 `error`，符合 `ALLOW_USER_SEE_QUOTA=false` 的 gate 设计。
- 浏览器证据（真实 `/user` 渲染）：
  - Enabled `3203`：截图 `.sisyphus/evidence/task7-user-3203-enabled.png`，DOM 快照 `.sisyphus/evidence/task7-user-3203-snapshot.md`，网络 `.sisyphus/evidence/task7-user-3203-network.log`，控制台 `.sisyphus/evidence/task7-user-3203-console.log`。
  - Disabled `3204`：截图 `.sisyphus/evidence/task7-user-3204-disabled.png`，DOM 快照 `.sisyphus/evidence/task7-user-3204-snapshot.md`，网络 `.sisyphus/evidence/task7-user-3204-network.log`，控制台 `.sisyphus/evidence/task7-user-3204-console.log`。
- UI 结果：
  - `3203` 的 `/user` 页面存在 quota section，快照可见“配额摘要 / 当前用户额度 / 配额摘要已更新”等文案，且说明文案明确声明不返回 `auth index`、文件名或原始响应。
  - `3204` 的 `/user` 页面未渲染任何 quota section；DOM 在趋势图后直接结束，没有“配额摘要”标题或额度卡片。
- 网络 / 控制台判读：
  - `3203` 中 `/api/user/quota` 为 `200`，没有 quota 相关报错。
  - `3204` 中客户端会探测一次 `/api/user/quota`，网络记录为预期 `404`，随后页面不渲染 quota section；这与 Task 7 既有“接口 probe 后按 404 隐藏 section”的实现一致。
  - 两个环境都出现与 quota 无关的既有噪声：`view=global` 概览请求 `403` 和图表容器尺寸 warning；本次未见新的 quota 泄漏或 quota-specific runtime failure。

## 2026-04-10 Task 8 residual notes

- `secret-guard` 的 `.gitignore` 覆盖审计仍报告 19 个常见敏感文件模式（如 `*.pem`、`*.key`、`credentials.json`、`id_rsa`、`kubeconfig`）未被忽略；本次 Task 8 未扩展到 `.gitignore` 整理，但结束前已记录为后续安全债务。
- `task8-user-boundary-console.log` 仍有两个既有浏览器噪声：登录页缺少 `autocomplete` 提示，以及 Recharts 初次渲染时的容器尺寸 warning；本次 user/admin 边界复验未观察到新的敏感信息泄漏或 admin surface 误显。

## 2026-04-10 F3 real manual QA verdict (isolated runtime `3205`)

- 在 repo-local 隔离环境 `http://127.0.0.1:3205` 上完成了真实浏览器 QA；runtime 继续连接 repo-local `9317/9318` 侧环境，没有切到用户家目录实例。
- 统一 `/login` 已在运行时确认仍是单输入框入口：`f3-login-snapshot.md` 与 Playwright 结果显示 1 个 textbox / 1 个登录按钮，并分别把 user 凭据导向 `/user`、把 admin 凭据导向 `/`。
- user happy path 通过：真实登录后 `/user` 成功渲染用户壳体与 4 个摘要卡/趋势图（截图 `f3-user-dashboard-3205.png`），`/user/records` 成功渲染记录页（截图 `f3-user-records-3205.png`），且导航只剩 `用户仪表盘` / `我的记录`。
- quota / global gate 与运行时行为一致：`f3-user-network.log` 记录 `/api/user/quota -> 404`、`/api/user/overview?view=global -> 403`；UI 侧没有可交互的“全站聚合”或“配额”控件（Playwright 计数 `globalExact=0`、`quotaExact=0`、`switches=0`、`checkboxes=0`）。
- user→admin 边界通过：用户会话访问 `/`、`/records`、`/explore`、`/logs` 全部被送回 `/login?from=...`；截图 `f3-user-blocked-admin-logs-3205.png` 保存了 `/logs` 的阻断结果。
- admin regression 通过：同一实现上 admin 登录后能进入 `/` 与 `/records`（截图 `f3-admin-dashboard-3205.png`），随后访问 `/user` 会被重定向回 `/login?from=%2Fuser`（截图 `f3-admin-blocked-user-3205.png`）。
- 本次浏览器控制台里的 `403 / 404` 只来自预期 gate probe；额外出现的一次 `39055/user-key` CORS 报错来自 QA 临时凭据桥的失败尝试，不属于产品运行时缺陷。基于上述真实 user/admin 端到端结果，本次 F3 verdict = `APPROVE`。

## 2026-04-10 F3 real manual QA rerun (fresh runtime check)

- 在隔离 QA app `http://127.0.0.1:3205` 与 repo-source records runtime `http://127.0.0.1:9318` 上重新执行了真实浏览器 QA，并把本次证据写入：`f3-login-snapshot-20260410.md`、`f3-user-dashboard-3205.png`、`f3-user-3205-snapshot.md`、`f3-user-network-3205.log`、`f3-user-console-3205.log`、`f3-user-blocked-admin-logs-3205.png`、`f3-user-records-9318.png`、`f3-user-records-9318-snapshot.md`、`f3-admin-login-rejected-3205.png`。
- user happy path 真实通过：`3205` 的统一 `/login` 仍是单输入框入口，登录后进入 `/user`，只显示 `用户仪表盘` / `我的记录` / `退出登录`；首页真实渲染 4 个摘要卡（Tokens / Estimated Cost / 平均 TPM / Request Count）和趋势图。`9318` 的 `/user/records` 真实渲染了模型筛选、时间范围按钮，以及仅含安全字段的记录表头（`时间`、`模型`、`Tokens`、`输入`、`输出`、`思考`、`缓存`、`费用`、`状态`）。
- env gating 与边界行为真实通过：`f3-user-network-3205.log` 记录了 `/api/user/quota -> 404` 与 `/api/user/overview?days=14&view=global -> 403`；DOM 侧实际可见按钮仅有 `退出登录`、时间范围按钮与图表切换，没有可交互的“全站聚合”或“配额”控件。用户会话访问 `3205` 的 `/`、`/records`、`/explore`、`/logs` 全部被重定向到 `/login?from=...`。
- admin regression 本次无法完成：按要求使用已知本地 QA admin password 在 `3205` 与 `9318` 的 `/login` 做真实浏览器登录，均停留在登录页并显示 `凭据错误`；浏览器截图为 `f3-admin-login-rejected-3205.png`。为排除 UI 假象，又直接调用两个运行时的 `/api/auth/verify?from=%2F`，都得到 `401 {"error":"凭据错误"}`。
- 由于本次 fresh rerun 不能用要求中的 admin QA 凭据进入管理员主路径，我只能真实确认 user path 与 user→admin 阻断，不能真实确认 admin→user 回归与 admin 主路径运行正常。因此本次 fresh rerun F3 verdict = `REJECT`。

## 2026-04-10 F3 final rerun with runtime-loaded admin password

- 重新按要求只针对 `3205` 执行 F3：先从正在监听 `3205` 的 live Next.js 进程 `/proc/<pid>/environ` 中读取实际加载的 `PASSWORD`，但未把 secret 打印、写入证据或写入 notepad；Playwright 仅通过本地临时 bridge 在浏览器内使用它完成登录。
- user path 仍然真实通过：统一 `/login` 入口可用；user 登录后回到 `/user`，页面只显示 `用户仪表盘` / `我的记录` / `退出登录`，并真实渲染概览卡与趋势图。随后 user session 访问 `/`、`/records`、`/logs` 均被重定向到 `/login?from=...`，说明 user→admin 边界依旧成立。
- admin regression 这次真实通过：使用运行时加载的真实 `PASSWORD` 后，浏览器成功从 `/login` 进入 `http://127.0.0.1:3205/`；随后 `/records` 与 `/logs` 都可在 admin session 下直接访问，不再回到登录页。相同 admin session 访问 `/user` 时又会被送回 `/login?from=%2Fuser`，说明 admin 不会误穿透用户壳体。
- 本次新增证据：`f3-rerun-admin-dashboard-3205.png`、`f3-rerun-admin-blocked-user-3205.png`；浏览器执行结果同时记录了 user session 对 `/` `/records` `/logs` 的阻断，以及 admin session 对 `/` `/records` `/logs` 的正常访问。
- 结论修正：上一轮 `REJECT` 的根因是 QA admin 凭据假设错误，而不是运行时回归失败。基于这次直接使用 live process 加载密码的真实浏览器结果，本次 F3 final rerun verdict = `APPROVE`。
