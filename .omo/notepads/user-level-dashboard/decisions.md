
- 决定保留单一 `/login` 页面和单一 `/api/auth/verify` 入口：先尝试 admin 密码，失败后再使用上游 `/v1/models` 校验 user key，避免新增平行登录流。
- 决定让成功登录时清理另一类 cookie：admin 登录会清除 user cookie，user 登录会清除 admin cookie，减少代理层遇到双会话并存时的歧义。
- 决定在 `lib/config.ts` 补充 `cliproxy.serviceBaseUrl` / `cliproxy.modelsUrl`，把 management base URL 与 OpenAI 兼容 `/v1/models` 校验地址分开，后续 user 能力可直接复用。
- 决定为 user 查询层新增独立的 user-safe DTO：overview 仅暴露聚合数据与 `filters.models`，records 去掉 `route` / `source` / `credentialName` / `provider`，这样后续 `/user` 页面不会重新依赖管理员维度字段。
- 决定通过 `view=self|global` 复用同一个 `/api/user/overview` 包装层：`self` 强制绑定 `session.route`，`global` 只保留聚合契约，先为后续用户仪表盘任务预留接口而不暴露明细数据。
