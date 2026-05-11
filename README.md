# CLIProxyAPI 数据看板

该项目基于 [sxjeru/CLIProxyAPI-Monitor](https://github.com/sxjeru/CLIProxyAPI-Monitor) 修改而来。主要修改了：
- 使用 Docker Compose 部署
- 使用本地 PostgreSQL 作为数据库
- 对于 input token 的展示，统一为 `regular-input` 语义（`input - cached`）。

最新版本的 CLIProxyAPI 已移除旧的聚合管理接口 `GET /v0/management/usage` 作为唯一可靠来源。本项目现在会优先走队列同步链路，顺序是 RESP 队列 -> HTTP `/v0/management/usage-queue` -> 旧版 `/v0/management/usage` 兜底，所以 README、compose 默认值和 smoke 脚本都按队列优先来配置。

## Docker Compose 部署

项目已支持单机 Compose 一体化部署（`dashboard + postgres + cli-proxy-api + sync-cron`），并默认使用 Docker Hub 预构建镜像。

### 1) 快速启动

参考 [router-for-me/CLIProxyAPIPlus](https://github.com/router-for-me/CLIProxyAPIPlus) 准备配置文件：

```bash
curl -o config.yaml https://raw.githubusercontent.com/router-for-me/CLIProxyAPIPlus/main/config.example.yaml
curl -o docker-compose.yml https://raw.githubusercontent.com/ControlNet/cliproxyapi-monitor/refs/heads/main/docker-compose.yml
```

然后执行：

```bash
docker compose up -d
```

如果你用 `.env` 管理覆盖值，建议至少补上这些安全占位值，不要把真实密钥直接写进仓库文件：

```bash
cat >> .env <<'EOF'
PASSWORD=change-me-dashboard-password
CRON_SECRET=change-me-cron-secret
MANAGEMENT_PASSWORD=change-me-cpa-management-password
CLIPROXY_MANAGEMENT_KEY=
CLIPROXY_USAGE_QUEUE_SOURCE=auto
CLIPROXY_USAGE_QUEUE_BATCH_SIZE=100
CLIPROXY_USAGE_QUEUE_TIMEOUT_MS=15000
CRON_SCHEDULE=* * * * *
BACKUP_RETENTION_DAYS=7
EOF
```

说明：
- `MANAGEMENT_PASSWORD` / `CLIPROXY_MANAGEMENT_KEY` 用于 `/v0/management/*`、RESP `AUTH` 和 HTTP `/usage-queue`，不要默认认为它和 `CLIPROXY_SECRET_KEY` 是同一个值。
- `CLIPROXY_USAGE_QUEUE_SOURCE=auto` 会先尝试 RESP。如果你的 CPA 只暴露 HTTPS 或放在反向代理后面，原始 RESP 可能不可用，这时会自动回退到 HTTP `/v0/management/usage-queue`，再回退到旧版 `/usage`。
- 队列读取是 destructive pop，消息取走就不会再被下一次同步读到。默认保留期通常只有约 60 秒，所以默认 `sync-cron` 改成每分钟执行一次。若你把上游 retention 调长，可以再放宽 `CRON_SCHEDULE`。

#### latest CPA 上游必配项示例（安全占位值）

monitor 侧的 `MANAGEMENT_PASSWORD` 只是告诉 dashboard 用什么管理凭证访问 CPA；你还需要在上游 `cli-proxy-api` 自己的配置里显式开启对应的管理密钥和队列保留时间。不要把真实密码写进仓库，建议只在本机 `.env` 或未提交的配置覆盖文件里放占位后自行替换：

```yaml
remote-management:
  allow-remote: true
  secret-key: "change-me-cpa-management-password"

redis-usage-queue-retention-seconds: 60
usage-statistics-enabled: true
```

对应关系：
- 宿主机 `.env` 里的 `MANAGEMENT_PASSWORD=change-me-cpa-management-password` 应与上游 `remote-management.secret-key` 使用同一明文值。
- `redis-usage-queue-retention-seconds` 是 latest CPA 的上游保留期配置名；默认示例给 `60` 秒，是为了匹配本仓库默认每分钟一次的 `sync-cron`。
- 如果你把 retention 设得更短，就必须把 `CRON_SCHEDULE` 调得更频繁；如果你通过 HTTPS/反向代理部署 CPA，又不透传 RESP，则保持 `CLIPROXY_USAGE_QUEUE_SOURCE=auto` 或显式设成 `http` 更稳妥。

### 2) 本地 `docker build` / 推送镜像（可选）

如果你不想使用默认的 `controlnet/cliproxyapi-monitor:latest`，可以自己构建并推送镜像：

```bash
# 在仓库根目录构建
docker build -t <your-dockerhub-username>/cliproxyapi-monitor:latest .
```

### 3) Compose 内置配置项（直接改 `docker-compose.yml`）

| 配置项 | 说明 | 当前默认 |
|---|---|---|
| `dashboard.image` | Docker Hub 预构建镜像 | `controlnet/cliproxyapi-monitor:latest` |
| `dashboard.ports` | dashboard 宿主机端口（固定） | `8318:3000` |
| `dashboard.environment.PASSWORD` | 看板访问密码；默认留空（将回退使用 config.yaml 的 secret） | `""` |
| `dashboard.environment.AUTH_COOKIE_SECURE` | admin / user 两类登录 cookie 的 `Secure` 标记（HTTPS 建议改为 `true`） | `false` |
| `dashboard.environment.MANAGEMENT_PASSWORD` | 最新 CPA 管理接口与队列读取的密码族 env，推荐在宿主机 `.env` 中提供 | 空 |
| `dashboard.environment.CLIPROXY_MANAGEMENT_KEY` | 显式覆盖管理密钥；有值时优先于 `MANAGEMENT_PASSWORD` | 空 |
| `dashboard.environment.CLIPROXY_USAGE_QUEUE_SOURCE` | 队列来源选择，`auto` 会走 RESP -> HTTP `/usage-queue` -> legacy `/usage` | `auto` |
| `dashboard.environment.CLIPROXY_USAGE_QUEUE_BATCH_SIZE` | 单次队列拉取条数 | `100` |
| `dashboard.environment.CLIPROXY_USAGE_QUEUE_TIMEOUT_MS` | 队列拉取超时（毫秒） | `15000` |
| `sync-cron.environment.CRON_SCHEDULE` | 默认每分钟同步一次，兼容约 60 秒的队列保留期 | `* * * * *` |

`docker-compose.yml` 里的 `cli-proxy-api` 服务默认只挂载 `./config.yaml`，不会替你生成 latest CPA 的管理密码或 retention 配置。因此生产或测试环境里，请在你自己的 `config.yaml` 中显式写出上面的 `remote-management.secret-key` 与 `redis-usage-queue-retention-seconds`，并仅通过本地 `.env` / 未提交 override 提供明文占位值。

### 4) 可选环境变量（数据库 / 同步调优）

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `POSTGRES_URL` | `DATABASE_URL` 的可选回退变量名 | 空 |
| `DATABASE_CA` | PostgreSQL CA 证书，支持原始 PEM 或 Base64 PEM | 空 |
| `DATABASE_POOL_MAX` | 连接池最大连接数 | `5` |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | 空闲连接超时（毫秒） | `10000` |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | 获取连接超时（毫秒） | `5000` |
| `DATABASE_POOL_MAX_USES` | 单连接最大复用次数 | `7500` |
| `ALLOW_USER_SEE_TOTAL_USAGE` | 是否允许 `/user` 切换到“全站聚合”安全视图；默认关闭 | `false` |
| `ALLOW_USER_SEE_QUOTA` | 是否允许 `/user` 显示安全配额摘要与 `/api/user/quota`；默认关闭 | `false` |
| `NEXT_PUBLIC_SYNC_TIMEOUT_MS` | `/api/sync` 前后端共享超时（毫秒） | `60000` |
| `CLIPROXY_MANAGEMENT_KEY` | 显式管理密钥。用于 `/v0/management/*`、RESP `AUTH` 与 HTTP `/usage-queue` | 空 |
| `CLIPROXY_USAGE_QUEUE_SOURCE` | 队列同步来源。支持 `auto`、`resp`、`http`、`legacy` | `auto` |
| `CLIPROXY_USAGE_QUEUE_BATCH_SIZE` | 每次从队列读取的记录数 | `100` |
| `CLIPROXY_USAGE_QUEUE_TIMEOUT_MS` | 队列读取超时（毫秒） | `15000` |
| `AUTH_FILES_INSERT_CHUNK_SIZE` | `auth_file_mappings` 批量写入块大小 | `500` |
| `USAGE_INSERT_CHUNK_SIZE` | `usage_records` 批量写入块大小 | `153` |

### 4.1) 队列同步与 HTTPS 反代注意事项

- 最新 CPA 不再适合把旧版聚合 `/usage` 当成主路径，本项目会优先消费逐请求 usage queue。
- 队列模式不会复用旧版 20 分钟聚合回看过滤，原因是队列已经是逐条事件，重复过滤反而可能漏数。
- 队列读取是 destructive read，部署时请避免并发跑多个 `/api/sync` worker。项目里的 `/api/sync` 已经加了数据库锁，但运维上仍应保持单个定时入口。
- 默认 cron 改成每分钟，是为了兼容上游常见的约 60 秒 retention。若你把 CPA 队列 retention 设得更短，就要进一步缩短 `CRON_SCHEDULE`。
- 当 CPA 部署在 HTTPS、CDN 或反向代理后面时，原始 RESP 往往不可透传。这种场景请保持 `CLIPROXY_USAGE_QUEUE_SOURCE=auto` 或显式改成 `http`，让 monitor 走 HTTP `/v0/management/usage-queue`。

### 4.2) 用户模式边界说明

- `/user` 与 `/api/user/*` 只信任独立的 `dashboard_user_session`，不会复用管理员 `dashboard_auth`。
- `ALLOW_USER_SEE_TOTAL_USAGE=false` 时，`/user` 不会保留“全站聚合”视角；客户端最多探测一次 `view=global`，服务端会返回 `403` 且不暴露管理接口。
- `ALLOW_USER_SEE_QUOTA=false` 时，`/api/user/quota` 直接返回 `404`，`/user` 页面不会渲染配额摘要区块。
- `/api/logs`、`/api/request-error-logs`、`/api/usage-statistics-enabled`、`/api/management-url`、`/api/sync` 仍属于管理员/运维能力，user session 无法成功访问。

### 5) `cpa-runtime` 隔离验证约定

`cpa-runtime/docker-compose.yml` 只保留了和根 compose 一样的队列相关默认值，方便后续做最终验证，但真正执行 Task 9 时请继续保持隔离，不要直接拿 Docker Hub `latest` 当成验证结果：

1. 使用独立 project name，例如 `cliproxyapi-monitor-cpa-runtime`。
2. 如当前机器已有 9317/9318 或 `dashboard-data` 占用，额外用本地 override 改临时端口和数据目录。
3. 最终验证必须覆盖 `dashboard`，改成本地 build 或本地镜像标签，不能继续使用 `controlnet/cliproxyapi-monitor:latest`。

推荐做法是新建一个仅本地使用、不要提交的 `cpa-runtime/docker-compose.local.yml`，内容类似：

```yaml
services:
  dashboard:
    build:
      context: ..
    image: cliproxyapi-monitor:task9-local
  postgres:
    volumes:
      - ./dashboard-data-task9:/var/lib/postgresql/data
```

然后用类似下面的命令执行最终验证：

```bash
docker compose \
  -p cliproxyapi-monitor-cpa-runtime \
  -f cpa-runtime/docker-compose.yml \
  -f cpa-runtime/docker-compose.local.yml \
  config
```

### 6) 常用运维命令

```bash
# 触发一次数据库备份（默认保留 7 天）
docker run --rm \
  --network "${PROJECT:-$(basename "$PWD")}_default" \
  -e POSTGRES_HOST=postgres \
  -e POSTGRES_PORT=5432 \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=cliproxy \
  -e POSTGRES_DB=cliproxy \
  -e BACKUP_DIR=/backups/postgres \
  -e BACKUP_RETENTION_DAYS=7 \
  -v "$PWD/scripts/pg-backup.sh:/scripts/pg-backup.sh:ro" \
  -v "$PWD/backups/postgres:/backups/postgres" \
  postgres:16-alpine \
  sh /scripts/pg-backup.sh

# 手动重跑数据库迁移（通常不需要，排障用）
docker run --rm \
  --network "${PROJECT:-$(basename "$PWD")}_default" \
  -e DATABASE_URL="postgresql://postgres:cliproxy@postgres:5432/cliproxy" \
  controlnet/cliproxyapi-monitor:latest pnpm run migrate
```

## Local DEV
1. 安装依赖：`pnpm install`
2. 修改环境变量：`cp .env.example .env`
3. 若你要接最新 CPA，请补上 `CLIPROXY_MANAGEMENT_KEY` 或 `MANAGEMENT_PASSWORD`，并确认 `CLIPROXY_USAGE_QUEUE_SOURCE=auto`
4. 创建表结构：`pnpm run db:push`
5. 同步数据：GET/POST `/api/sync`（可选，可观察返回 JSON 中的 `source` 是 `resp`、`http-usage-queue` 还是 `legacy-usage`）
6. 启动开发：`pnpm dev`
