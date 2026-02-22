# CLIProxyAPI 数据看板

该项目基于 [sxjeru/CLIProxyAPI-Monitor](https://github.com/sxjeru/CLIProxyAPI-Monitor) 修改而来。主要修改了：
- 使用 Docker Compose 部署
- 使用本地 PostgreSQL 作为数据库
- 对于 input token 的展示，统一为 `regular-input` 语义（`input - cached`）。

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
| `dashboard.environment.AUTH_COOKIE_SECURE` | 登录 cookie 的 `Secure` 标记（HTTPS 建议改为 `true`） | `false` |

### 4) 常用运维命令

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
3. 创建表结构：`pnpm run db:push`
4. 同步数据：GET/POST `/api/sync`（可选）
5. 启动开发：`pnpm dev`
