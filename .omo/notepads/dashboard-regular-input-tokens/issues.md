# Issues — dashboard-regular-input-tokens

- (init) No active issues yet.

- 2026-02-21T03:08:00Z QA blocked for T7 visual check: dashboard overview failed to render KPI cards because `/api/overview?days=14&page=1&pageSize=500` returned 501 Not Implemented (also `/api/usage-statistics-enabled`, `/api/management-url`, `/api/sync` 501). As a result, `输入(不含缓存)` row was not present in rendered UI, so label/value binding could not be visually verified.

- 2026-02-21T03:22:00Z T12 UI verification blocked in local Playwright run (`http://localhost:3100`): required chart data path failed (`/api/overview?days=14&page=1&pageSize=500` => 500; `/api/usage-statistics-enabled` and `/api/management-url` => 501; `/api/prices` and `/api/sync` => 500), page shows `加载失败`/`暂无数据`, so normal and fullscreen hourly chart legend/tooltip/series text `输入(不含缓存)` could not be rendered for visual confirmation. Evidence: `.sisyphus/evidence/task-T12-ui-normal.png`, `.sisyphus/evidence/task-T12-ui-fullscreen-empty.png`.

- 2026-02-21T03:20:23Z T11 API verification blocked: `/api/overview?skipCache=1` (default) and `/api/overview?skipCache=1&days=7&page=2&pageSize=20&model=gpt-4` (filtered/paged) both returned `501` with payload `{"error":"CLIPROXY_SECRET_KEY is missing"}`. Evidence captured in `.sisyphus/evidence/task-T11-default.json` and `.sisyphus/evidence/task-T11-filter-page.json`; jq non-negative assertions for `.overview.totalInputTokens` and `.overview.byHour[].inputTokens` are not executable because `overview` is absent in blocked payload.

- 2026-02-21T03:41:49+00:00 F4 fidelity audit outcome: T11/T12 remain BLOCKED by env prerequisites (`CLIPROXY_SECRET_KEY`, DB bootstrap), and T13 remains blocked/partial due initial build non-zero before workaround rerun; final verdict cannot be PASS while these verification tasks are unresolved.

- 2026-02-21T03:39:50Z F2 build gate blocked in current env: `pnpm build` failed during `node scripts/migrate.mjs` with `VercelPostgresError('missing_connection_string')` because `POSTGRES_URL`/`connectionString` is missing. Lint passed; final quality verdict remains FAIL until build can run with a valid DB connection env.

- 2026-02-21T03:44:29+00:00 F1 plan-compliance audit FAIL: missing plan-referenced evidence for tasks T2–T10 (20 files); T11/T12 blocked by missing CLIPROXY_SECRET_KEY and API/DB bootstrap failures (see .sisyphus/evidence/task-T11-*.json and .sisyphus/evidence/final-qa/f3-manual-qa-report.md mentioning missing POSTGRES_URL).

- 2026-02-21T03:51:00+00:00 F3 final manual QA still BLOCKED in live run: `/api/overview?skipCache=1` and filtered `/api/overview?...` return 500 (`missing_connection_string` / no `POSTGRES_URL`), `/api/prices` also 500, while `/api/usage-statistics-enabled` returns 501 (`CLIPROXY_SECRET_KEY is missing`) and `/api/management-url` returns 501 (`CLIPROXY_API_BASE_URL is missing`). Result: homepage shows `加载失败`/`暂无数据`, fullscreen control absent, and `输入(不含缓存)` cannot be asserted in KPI/legend/tooltip. Evidence in `.sisyphus/evidence/final-qa/f3-manual-qa-report.md` + new `f3-qa-*.png` screenshots.

- 2026-02-21T04:10:00+00:00 T2–T10 evidence backfill remains functionally BLOCKED at runtime: `/api/overview` responses on local dev (`127.0.0.1:3100`) return Next error HTML due missing DB connection (`missing_connection_string`), and UI stays in `加载失败`/`暂无数据`, preventing normal/fullscreen chart interactions; blocked artifacts were captured as raw API outputs, jq parse errors, and Playwright screenshots under exact plan filenames.

- 2026-02-21T04:26:00Z Verification build rerun for this copy-only rollback is still BLOCKED by environment prerequisites: `pnpm build` fails in `scripts/migrate.mjs` with `VercelPostgresError('missing_connection_string')` because `POSTGRES_URL`/connection string is not set; code-level label rollback verification used grep + lsp diagnostics and passed.

- 2026-02-21T04:38:44Z No new blocker in final rerun: protected API smoke (`/api/overview` default + filtered) and UI runtime checks (KPI/normal/fullscreen tooltip+legend copy) all passed with current `.env` runtime.

- 2026-02-21T04:54:30Z No new blocking issue during evidence-only refresh: six target artifacts were overwritten successfully in current env-ready run (T5/T11 API evidence + T12 normal/fullscreen screenshots).

- 2026-02-21T12:00:00Z F4 deep rerun (refreshed workspace): task compliance is 13/13 and rollback copy requirement (`输入`) is satisfied, but scope gate remains FAIL due one real contamination in `next-env.d.ts` (`.next/dev/types/routes.d.ts` -> `.next/types/routes.d.ts`).

- 2026-02-21T05:03:19+00:00 F1 re-audit update: prior runtime blockers for T5/T11/T12 and F3 are resolved (refreshed evidence + F3 final rerun PASS). Remaining closeout blocker: `git diff --stat` still shows `next-env.d.ts` changed (contamination not clean).

- 2026-02-21T05:14:28Z F1 final re-audit: `git diff -- next-env.d.ts` is empty; plan compliance verdict is now PASS (see `.sisyphus/evidence/final-qa/f1-plan-compliance-audit.md`).
