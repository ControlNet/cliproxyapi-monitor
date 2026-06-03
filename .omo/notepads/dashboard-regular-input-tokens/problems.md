# Problems — dashboard-regular-input-tokens

- (init) No blocked problems yet.

- 2026-02-21T03:41:49+00:00 Unresolved blocker for final closeout: environment prerequisites are missing/incomplete (`CLIPROXY_SECRET_KEY` and stable DB connection settings), preventing plan-required API/UI verification assertions from completing end-to-end.

- 2026-02-21T03:51:00+00:00 Unresolved for closure: homepage dashboard QA cannot progress beyond shell render because API bootstrap fails (`POSTGRES_URL` missing => overview/prices 500) and upstream env vars are absent (`CLIPROXY_SECRET_KEY`, `CLIPROXY_API_BASE_URL` => 501 on integration endpoints), so normal/fullscreen data-path checks for `输入(不含缓存)` remain blocked.
