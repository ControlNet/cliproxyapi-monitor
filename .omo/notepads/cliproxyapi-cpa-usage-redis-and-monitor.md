# CLIProxyAPI（CPA）用量队列与 cliproxyapi-monitor

（笔记路径：`.sisyphus/notepads/`；仓库 `.gitignore` 已忽略 `.sisyphus/`。若你更想用 `.sisphyus/notepads`，可自行复制，该路径默认会被 git 跟踪。）

更新时间：2026-05-03

## 背景

- CPA 新版不再提供聚合式 HTTP **`GET /usage`**（及同类 import/export 快照接口的用法变化）。
- 每条请求的用量改为进入 **进程内内存队列**，通过 **Redis RESP 子集** 在同一 TCP 端口上与 HTTP **多路复用**读出。
- 官方/上游实现参考：`router-for-me/CLIProxyAPI`（Go）。本笔记结合上游源码与 sxjeru 的 adapter 行为整理。

## 协议与端口

- **不是**独立 Redis Server：无单独 `redis://` 容器；客户端连 **与 HTTP 相同的 host:port**（如 `8317`）。
- 首字节探测：若为 RESP 前缀（`*` `$` `+` `-` `:`）→ Redis 处理；否则 → HTTP。
- 源码入口：`internal/api/protocol_multiplexer.go`、`internal/api/redis_queue_protocol.go`。

## RESP 侧支持的命令

1. **`AUTH <password>`**（或 `AUTH <user> <password>`，用户名忽略）
   - 口令与 HTTP 管理 API 一致：`remote-management.secret-key`、`MANAGEMENT_PASSWORD` 等同一套 `AuthenticateManagementKey`。
2. **`LPOP` / `RPOP`**
   - 2 个参数：弹 **1** 条。
   - 3 个参数：第三个为 **count**，一次最多弹 count 条。
   - 实现上两种都从 **`PopOldest`** 取（最旧先出），`LPOP`/`RPOP` 行为等价。
3. 其它命令 → `unknown command`。

未 `AUTH` → `NOAUTH`。管理未启用（无管理密钥等）→ 队列侧不可用。

## 队列开关与写入条件

- **`redisqueue.SetEnabled`** 与「是否配置了管理密钥」绑定（`internal/api/server.go`）：无密钥则队列不启用。
- **`usage-statistics-enabled`**：为 false 时插件不把记录写入队列（`redisqueue.UsageStatisticsEnabled()`）。
- 可通过 HTTP **`GET/PUT/PATCH /usage-statistics-enabled`**（在 management 路由下，需管理鉴权）查看或切换。

## 队列数据形态（单条 JSON）

来自 `internal/redisqueue/plugin.go` 序列化的 `queuedUsageDetail`，大致字段：

- `timestamp`, `latency_ms`, `source`, `auth_index`, `tokens`（`input_tokens` 等）, `failed`
- `provider`, `model`, `endpoint`, `auth_type`, `api_key`, `request_id`

增量消费：每条是一事件，不是旧版「整棵 `usage.apis` 树」快照。

## 保留时间（极易踩坑）

- 内存队列会按 **`redis-usage-queue-retention-seconds`** 丢弃过旧项（默认约 **60s**，上限 **3600**）。配置在 `internal/config/config.go` / YAML。
- 若 dashboard **cron 间隔很长**（如 10 分钟）而 retention 很短，**队列里可能已被 prune**，sync 拉不到数据。
- 建议：**retention ≥ 同步间隔 + 余量**，或 **提高拉取频率**。

## ControlNet `cliproxyapi-monitor` 现状（本仓库）

- `lib/config.ts`：`CLIPROXY_API_BASE_URL` 会规范为带 **`/v0/management`** 的管理 URL；**`serviceBaseUrl`** 为去掉该后缀后的服务根（连队列用 **host:port** 应对应此项解析结果）。
- **`app/api/sync/route.ts`** 仍 **`fetch(`${serviceBaseUrl}/usage`)`**（代码用 `baseUrl` 去尾后拼 `/usage`，需以实际为准）：与新 CPA **不兼容**，需改为 RESP 拉取或经 adapter。

## sxjeru `CLIProxyAPI-Monitor` 的 `adapter.js`（摘要）

- 依赖 **`ioredis`** 连 `CPA_REDIS_HOST:CPA_REDIS_PORT`（默认 `8317`），`password` = `CPA_SECRET_KEY`。
- 定时 **`LPOP key batchSize`**（key 默认 `queue`，仅占位；CPA 解析 count 为第三参数，`ioredis.lpop(key, count)` 与 CPA 三参数形式一致）。
- 内存缓冲 `usageBuffer`，HTTP 提供 **`/usage`**、**`/v0/management/usage`**，返回 **`getAggregatedUsage()`** 合成的 **旧版** `{ usage: { apis: { [route]: { models: { [model]: { details: [] } } } } } }`；**route** 来自记录的 **`endpoint`**（缺省 `default`）。
- 可选：`clearBufferOnRead`、对 `/usage` 的 Bearer 鉴权、周期性 `fetch` 远端 **`/api/sync`**。

## 实现方向建议（本仓库内）

- 在 **sync** 中用 Node **`net`** 手写 RESP（**`AUTH` + 循环 `LPOP … count`**），零依赖或少量依赖；避免与「真 Redis」混用时的客户端假设。
- 在 **`lib/usage.ts`** 增加「队列单条 / 多条 → `usage_records`」映射路径；**不必**再拼回整棵旧 `usage.apis` 除非要兼容旧代码路径。
- 与 adapter 对齐：**`endpoint` → 表里的 route 维度**；`model`、`tokens`、`timestamp`、`source`、`auth_index`、`failed` → 各列。

## 官方文档（词条）

- Management API / Usage Telemetry (Redis)：`https://help.router-for.me/management/api`
