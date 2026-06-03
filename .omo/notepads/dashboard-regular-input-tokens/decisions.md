# Decisions — dashboard-regular-input-tokens

- (init) Use regular input semantics: max(inputTokens - cachedTokens, 0).

- 2026-02-21T03:41:49+00:00 Scope-fidelity decision: keep verdict as BLOCKED (not PASS) until verification tasks (T11/T12/T13) fully satisfy plan acceptance; do not downgrade guardrail compliance (scope is clean) but do not collapse blocked QA into success.

- 2026-02-21T03:51:00+00:00 F3 decision: keep final QA verdict at BLOCKED with explicit scenario/integration counts until runtime env prerequisites (`POSTGRES_URL` or connectionString, `CLIPROXY_SECRET_KEY`, `CLIPROXY_API_BASE_URL`) are provided and Playwright can render chart/KPI/tooltip surfaces for `输入(不含缓存)` assertions.

- 2026-02-21T04:05:00+00:00 Cleanup: next-env.d.ts reset to HEAD to drop the accidental route import path change.

- 2026-02-21T04:13:00+00:00 Final clean snapshot: next-env.d.ts rewound to HEAD so contamination cleanup is recorded.
