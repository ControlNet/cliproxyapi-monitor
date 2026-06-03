## 2026-05-10T15:13:49Z Task: initialization
- Latest CPA removed aggregate HTTP `GET /usage`; monitor sync must consume per-request queue data instead.
- RESP queue is multiplexed on the same host:port as HTTP, not a standalone Redis server.
- Queue auth uses the management credential (`remote-management.secret-key` / `MANAGEMENT_PASSWORD` family), not necessarily the proxy API key.
- Queue items are destructive pops and default retention is short (~60s), so sync frequency and locking matter.
- Queue payloads may contain `api_key` and `request_id`; plan requires raw redaction plus request-id-based dedupe.
- Final runtime validation must use `cpa-runtime/docker-compose.yml` with isolated project name, temporary ports/data paths, and a local dashboard build/image override.

## 2026-05-10T15:18:00Z Task: wave1-research
- Repo currently has no `MANAGEMENT_PASSWORD` symbol usage; management-facing upstream callers generally reuse `config.cliproxy.apiKey` / `CLIPROXY_SECRET_KEY`.
- `lib/config.ts` is the single env normalization point and currently exposes only `baseUrl`, `serviceBaseUrl`, `modelsUrl`, and `apiKey`.
- `scripts/start-dashboard.sh` currently derives `CLIPROXY_SECRET_KEY` from the first `api-keys` entry in config and sets `PASSWORD` from it, but does not safely support an explicit management key.
- There is no Vitest config, test script, or test files yet. `tsconfig.json` already defines `@/*` with `moduleResolution: bundler`, which should be mirrored in Vitest later.
- `lib/db/client.ts` and some session/config modules are import-time env sensitive; future tests must set env/mocks before importing those modules.

## 2026-05-10T15:36:30Z Task: task-1-verification
- Task 1 required a small amount of build-fix collateral outside the exact task scope: lazy DB proxy creation in `lib/db/client.ts` plus stricter typings in `lib/queries/explore.ts`, `lib/queries/records.ts`, and `app/api/sync-model-prices/route.ts` to keep `pnpm build` green after adding Vitest/config tests.
- `package.json` should use `vitest run` rather than `vitest` so the repo-wide `test` script remains non-watch and CI-safe.
- Minimal `vitest.config.ts` should include Node environment, exclude runtime artifacts, and set an ESM-safe `@` alias to the repo root.

## 2026-05-11T01:27:00Z Task: task-1-management-credentials
- `config.cliproxy.managementKey` now resolves from `CLIPROXY_MANAGEMENT_KEY` -> `MANAGEMENT_PASSWORD` -> legacy `CLIPROXY_SECRET_KEY`, while `apiKey` still reads the proxy key directly.
- `scripts/start-dashboard.sh` now propagates `MANAGEMENT_PASSWORD` into `CLIPROXY_MANAGEMENT_KEY` only; it does not try to recover a plaintext management secret from YAML.
- Next.js production build in this repo was blocked by import-time DB/env assumptions and a few strict-mode inference holes in query helpers; making the DB client lazy and adding explicit row types unblocked the build without changing runtime behavior.

## 2026-05-11T01:34:00Z Task: task-1-followup-fix
- `vitest run` is the safer default here; keeping the test script non-watch avoids hanging CI and matches the planned verification flow.
- The lazy DB proxy can stay type-safe by returning a `ReturnType<typeof drizzle>` proxy, which preserves build-time imports without using `as any`.
- `vitest.config.ts` should mirror the repo root alias (`@`) explicitly so new tests can resolve the same paths as `tsconfig.json`.

## 2026-05-11T01:49:00Z Task: task-2-request-id-dedupe
- `usage_records` can support both the legacy snapshot dedupe key and request-id dedupe safely by keeping the four-column unique index and switching inserts to targetless `onConflictDoNothing()`; that lets Postgres ignore whichever unique constraint is hit first.
- `pnpm run db:generate` was blocked by stale Drizzle metadata in `drizzle/meta` (missing snapshots for 0002-0004 and a malformed 0001 snapshot) plus schema drift for the pre-existing `auth_file_mappings_name_idx`; repairing the snapshot chain and declaring the existing index in `lib/db/schema.ts` made generation deterministic again.

## 2026-05-11T02:00:00Z Task: task-3-usage-queue-normalization
- `parseUsageQueuePayload()` now treats queue inputs as `null | string | unknown[]`, returns `{ events, warnings }`, and skips malformed siblings with per-index warning metadata instead of throwing away the whole batch.
- Queue row mapping in `lib/usage.ts` uses the exact defaults from the plan: `endpoint -> route` with `default` fallback, `model -> alias -> unknown`, trimmed `source`, stringified `auth_index`, `request_id` propagation, `failed === true` as `isError`, and invalid timestamps falling back to the sync `pulledAt` time.
- `redactUsageQueueRaw()` recursively rewrites every `api_key` field to `[REDACTED]` before serializing `usage_records.raw`, and queue token totals prefer an explicit `total_tokens` value before falling back to `input + output + reasoning`.

## 2026-05-11T02:14:00Z Task: task-4-queue-clients
- `config.cliproxy.usageQueue` now centralizes the new queue tunables: `batchSize` defaults to `100`, `source` normalizes to `auto|resp|http|legacy` with `auto` fallback, and `timeoutMs` prefers `CLIPROXY_USAGE_QUEUE_TIMEOUT_MS` before falling back to `NEXT_PUBLIC_SYNC_TIMEOUT_MS` or `15000`.
- `lib/cliproxy-usage-queue.ts` exposes RESP helpers for `AUTH` and `LPOP queue <count>`, an incremental `RespParser` that safely handles chunk-split bulk strings plus nil/error/empty-array replies, and separate RESP/HTTP queue fetch functions that return `{ source, records, warnings }` with typed `failure.kind` values (`auth`, `unsupported`, `timeout`, `protocol`).
- The HTTP queue client treats `200 []` as a clean empty success, `401/403` as auth failures, `404` as unsupported fallback signals, and timeouts/non-JSON/unexpected payloads as non-secret protocol failures so Task 5 can decide whether to continue down the fallback chain.

## 2026-05-11T02:23:00Z Task: task-6-management-auth-boundary
- `assertEnv({ requireManagementKey: true })` must bypass the proxy API-key requirement; otherwise management-only routes like `/api/logs`, `/api/request-error-logs`, `/api/usage-statistics-enabled`, `/api/sync`, and `/api/user/quota` can still fail with the wrong missing-key message even when `CLIPROXY_MANAGEMENT_KEY` is the only credential they need.
- Focused Vitest coverage can prove the boundary cleanly by asserting management routes send `Authorization: Bearer ${config.cliproxy.managementKey}` for `/usage`, `/auth-files`, `/logs`, and `/api-call`, while `app/api/auth/verify/route.ts` continues validating `/v1/models` with the user-provided bearer instead of the management key.

## 2026-05-11T02:41:00Z Task: task-5-sync-orchestration
- `/api/sync` now needs a real PostgreSQL process-safe guard before any destructive queue read, and the simplest repo-local fit is a raw `db.$client.query("select pg_try_advisory_lock($1, $2)...")` helper plus `pg_advisory_unlock` in `finally`.
- Queue-source orchestration stays easiest to reason about when each source resolves to a common `{ ok, source, rows, warnings, legacy }` shape: RESP/HTTP queue warnings can accumulate during `auto`, while the legacy branch keeps the existing aggregate parser and 20-minute incremental lookback filter.
- Auth-files sync should run after the advisory lock but before usage-source selection and report structured warnings (`source`, `kind`, `code`, `message`, optional `status`) instead of failing the full sync, so empty queue reads and queue-source failures still return machine-usable JSON.

## 2026-05-11T02:46:00Z Task: task-7-vitest-audit
- Task 7 was already mostly satisfied before this pass: `package.json` already used non-watch `vitest run`, `vitest.config.ts` already mirrored the repo `@` alias, and the focused suite already covered config/env precedence, queue parsing/redaction, request-id dedupe, management-vs-proxy auth boundaries, and major sync fallback cases.
- The only concrete coverage gap left was the successful middle fallback branch in `auto` mode, so `sync.test.ts` now proves `/api/sync` falls back from RESP to `http-usage-queue`, inserts the mapped/redacted queue row, and does not continue on to legacy `/usage`.
- Verification for Task 7 now includes clean LSP diagnostics for `sync.test.ts`, a fully passing `pnpm test` run (27 tests), and a direct `pnpm exec vitest run lib/usage.test.ts` pass to show the redaction-focused fixture file works in isolation.

## 2026-05-11T03:05:00Z Task: task-8-deployment-docs-smoke
- Root `docker-compose.yml` and `cpa-runtime/docker-compose.yml` now pass through `MANAGEMENT_PASSWORD` / `CLIPROXY_MANAGEMENT_KEY`, default queue tuning envs, and a 1-minute `CRON_SCHEDULE`, which matches the documented short queue retention instead of the old 10-minute poll.
- README must explain in Chinese that latest CPA removed the old aggregate `/usage` as the primary path, so monitor now prefers RESP queue ingestion, then HTTP `/usage-queue`, then legacy `/usage`, with explicit notes for destructive reads, retention, and HTTPS or reverse-proxy deployments that need HTTP fallback.
- `scripts/t15-smoke.sh` can assert queue-compatible sync behavior without changing app code by parsing the `/api/sync` JSON body for `source`; fail mode should still capture 5xx upstream failures and log evidence even after the queue-first rollout.

## 2026-05-11T03:14:00Z Task: task-8-verification-followup
- Once smoke pass mode asserts `/api/sync` returns `source=resp|http-usage-queue`, the test fixture must provision both sides of latest CPA queue auth explicitly: dashboard env (`MANAGEMENT_PASSWORD` / `CLIPROXY_MANAGEMENT_KEY`) and upstream CPA config (`remote-management.secret-key` plus `redis-usage-queue-retention-seconds`). Documenting only the monitor-side env leaves the verification setup internally inconsistent.

## 2026-05-11T01:06:00Z Task: task-9-verification
- For Task 9, root `docker-compose.yml` and `cpa-runtime/docker-compose.yml` needed env-driven host ports/bind mounts plus a dashboard image override so isolated test runs could use temporary data paths without colliding with the already-running `cli-proxy` stack.
- Local Docker validation also required removing Corepack from the image/runtime path: `Dockerfile` now installs a fixed `pnpm@10.30.1`, `scripts/start-dashboard.sh` runs `node /app/scripts/migrate.mjs` and Next directly, and `scripts/t15-smoke.sh` builds a local dashboard image before compose-up.
- The safe smoke and `cpa-runtime` fixtures both returned machine-readable `source=legacy-usage` with explicit RESP/HTTP queue warnings under `eceasy/cli-proxy-api-plus:latest`, so Task 9 evidence now proves source reporting, fallback warnings, local dashboard build usage, and unchanged non-test container IDs rather than assuming the fixture image exposes queue endpoints.

## 2026-05-11T01:24:00Z Task: task-f3-runtime-qa
- Repo-root quality gates passed in a clean run: `pnpm test` (27/27), `pnpm lint`, `pnpm build`, and `bash scripts/t15-smoke.sh all`.
- Real `cpa-runtime` validation passed with an isolated project (`cliproxyapi-monitor-cpa-runtime-qa`), temporary host ports/bind mounts under `/tmp/opencode`, and a local dashboard image override/build (`cliproxyapi-monitor:cpa-runtime-qa-local` via `build.context: ~/GitRepos/cliproxyapi-monitor`).
- The current fixture image still falls back to `source=legacy-usage`, but `/api/sync` returned HTTP 200 plus machine-readable `source` and explicit RESP/HTTP queue warnings, which satisfies the plan's acceptable fallback condition.
- Pre-existing non-test `cli-proxy-*` container IDs remained unchanged before and after the isolated runtime stack was brought up and torn down.

## 2026-05-11T11:31:00+08:00 Task: final-wave-f1-f4-fix
- `redactUsageQueueValue()` now redacts normalized credential-style keys case-insensitively (`api_key`, `authorization`, `access_token`, `refreshToken`, `id_token`, and any key containing `bearer`) while preserving non-sensitive nested data.
