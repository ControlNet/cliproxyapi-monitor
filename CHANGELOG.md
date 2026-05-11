# Changelog

## 2026-05-11

- `docker-compose.yml` 与 `cpa-runtime/docker-compose.yml` 现在支持用环境变量覆盖 dashboard/CPA 宿主机端口和 bind mount 路径，便于 smoke / `cpa-runtime` 验证改用临时目录与临时端口，不会误复用仓库默认的 `dashboard-data`、`auths`、`logs` 或固定端口。
- `scripts/t15-smoke.sh` 改为自动分配空闲宿主机端口、把配置/数据库/auth/log/备份目录全部放到 `/tmp/opencode` 临时目录，并在容器内执行迁移与现有 `pg-backup.sh`，使默认 `bash scripts/t15-smoke.sh all` 能在已有线上风格容器存在时保持隔离验证。
- `scripts/start-dashboard.sh` 运行时不再依赖 `pnpm` / Corepack；容器启动阶段直接执行 `node scripts/migrate.mjs` 与 Next.js 二进制，避免 Node 20 运行镜像里 `pnpm` 动态导入失败导致 dashboard 启动即崩溃。
- `Dockerfile` 也不再依赖 Corepack 下载 `pnpm`；基础镜像直接安装固定版本 `pnpm@10.30.1`，保证本地构建 smoke 镜像与最终 `cpa-runtime` 本地镜像时不会在 `pnpm install` 阶段崩掉。
- 更新 `.env.example`、`README.md`、根目录 `docker-compose.yml` 与 `cpa-runtime/docker-compose.yml`，补充 `CLIPROXY_MANAGEMENT_KEY`、队列同步来源/批大小/超时配置，并把默认 `sync-cron` 调整为每分钟一次，避免在最新 CPA 的短 retention 队列下漏读数据。
- README 新增中文运维说明，明确最新 CPA 已移除旧聚合 `/usage` 作为主路径，现在优先走 RESP 队列，再回退到 HTTP `/usage-queue` 和旧版 `/usage`，同时说明 destructive queue read、retention、HTTPS 反代下的 HTTP fallback，以及 `cpa-runtime` 最终验证必须使用本地 build 或本地镜像覆盖。
- `scripts/t15-smoke.sh` 的 pass 模式现在会记录并断言 `/api/sync` 返回了机器可读的 `source`（包括显式 legacy fallback），fail 模式仍会检查上游中断后的 5xx 错误和可追踪日志。
- admin 调用记录里的“密钥”列现在只会显示 queue 事件里真实存在的 `api_key`；当 latest CPA 返回空 `api_key` 时页面会显示 `-`，不再误把 `POST /v1/responses` 之类的 endpoint 当作密钥展示。

## 2026-04-10

- 新增 env 开关 `ALLOW_USER_SEE_QUOTA` 与 `/api/user/quota`：仅当显式开启时，已登录用户才能查看基于当前 user route 解析出的安全配额摘要；关闭时接口返回不可用且 `/user` 页面不会渲染配额面板。
- `/user` 首页新增紧凑的用户配额面板，服务端会先从 `dashboard_user_session` 对应 route 解析本地 `auth_index` 映射，再按 provider 拉取并归一化安全摘要，只返回套餐/层级、剩余比例、重置提示、credits 摘要与高层状态文案，不暴露 auth index、文件名、邮箱、token 或原始上游响应。
- `/user/records` 已从占位页升级为真实用户记录页：复用管理端的排序、时间范围筛选与游标加载体验，但请求固定走 `/api/user/records`，且界面只展示安全字段，不再暴露密钥、凭证、提供商或任何扩权筛选入口。
- `/user` 首页已从占位说明替换为真实用户仪表盘，新增独立的时间范围持久化、四张摘要卡与按日/按小时趋势图，直接消费现有 `/api/user/overview` 合同。
- 当服务端允许全站聚合时，用户首页会显示“我的使用 / 全站聚合”切换，并在全站模式下明确提示该切换只影响首页聚合卡片与图表，不影响 `/user/records` 的明细边界。

## 2026-03-21

- 调整首页模型用量分布图例为左对齐行布局，让模型名称在可点击 legend 中的阅读方向更自然。
- 首页新增基于 Web Worker 的自动刷新开关与间隔设置，定时触发现有 `/api/sync` + `/api/overview` 刷新链路，避免整页重载。
- 首页 Tokens 卡片默认展示缓存命中率与未命中输入，悬停后可切换查看原始缓存 tokens 与原始输入 tokens，便于同时观察命中效果和真实输入消耗。
- 模型用量分布饼图改为按模型稳定映射颜色，确保图例与扇区颜色一致，减少刷新后颜色错位感。
- Explore 查询改为按时间顺序连续返回点位，并保留零 token 无效点过滤统计，避免行号抽样导致时序断裂。
- 模型用量分布饼图新增“费用”指标切换，并将仪表盘卡片与全屏视图的默认选中项调整为优先展示费用占比。
- 饼图图例与悬浮提示现按货币格式展示费用，同时保留 Tokens 与请求数原有的显示格式与交互行为。

## 2026-02-23

- 修复 `/api/sync` 在大批量写入 `usage_records` 时可能触发的 PostgreSQL `08P01`（bind message 参数协议错误）问题。
- 新增分批写入策略：按保守批大小拆分 `INSERT ... VALUES`，避免单条 SQL 绑定参数过多导致协议层失败。
- 新增自适应降级重试：当检测到 bind 协议错误时自动二分批次重试，提高同步稳定性。
- 保留原有 `ON CONFLICT DO NOTHING` 与 `inserted` 回退统计逻辑，确保结果口径兼容。
- 新增本地增量过滤窗口（默认 20 分钟回看）：按 `(route, model, source)` 维度在写库前过滤，仅保留各维度最近窗口内的记录，显著降低 10 分钟 cron 周期下的写入量。
- 新增 `?full=1` 全量同步开关：需要补历史数据时可显式绕过本地增量过滤。
