# Update cliproxyapi-monitor for latest CLIProxyAPI usage queue

## TL;DR
> **Summary**: Replace the broken legacy `/usage`-only sync path with a latest-CPA-compatible usage queue ingestion flow. The implementation must use RESP first, then HTTP `/usage-queue`, then legacy `/usage` fallback, while preserving existing dashboard behavior and preventing secret leakage/data loss where possible.
> **Deliverables**:
> - New management credential config separate from proxy API key.
> - RESP + HTTP usage-queue consumers with legacy `/usage` fallback.
> - Queue event normalization into `usage_records` with request-id dedupe and raw payload redaction.
> - Vitest setup and focused tests for protocol/parser/mapping/fallback behavior.
> - Docker/env/README/CHANGELOG/smoke updates for retention, sync frequency, and safe operations.
> - Real Docker Compose validation using `cpa-runtime/docker-compose.yml` without disturbing current CPA containers/data.
> **Effort**: Large
> **Parallel**: YES - 3 waves
> **Critical Path**: Task 1 → Task 2/3/4 → Task 5 → Task 8

## Context
### Original Request
User requested inspection of `.sisyphus/notepads/cliproxyapi-cpa-usage-redis-and-monitor.md` and a plan to update this repository after upgrading CLIProxyAPI broke monitor API usage.

### Interview Summary
- Compatibility: **RESP first + HTTP fallback**.
- Test strategy: **introduce Vitest**.
- Scope: **application code + deployment docs/config + Chinese CHANGELOG**.

### Metis Review (gaps addressed)
- Queue consumption is destructive; add DB-level sync concurrency guard and document at-most-once delivery.
- Current `CLIPROXY_SECRET_KEY` is a proxy API key, not guaranteed to be the management key; add an explicit management credential env.
- HTTPS/TLS and reverse-proxy deployments may not support raw RESP; include HTTP `/v0/management/usage-queue` before legacy fallback.
- Current unique key `(occurred_at, route, model, source)` can drop legitimate queue events; add `request_id` storage and request-id dedupe.
- Queue payloads can contain `api_key`; redact before storing `raw`.
- Queue mode must not reuse legacy 20-minute aggregate lookback filtering.
- Compose sync every 10 minutes conflicts with CPA default queue retention (~60s); change defaults/docs.

## Work Objectives
### Core Objective
Make `/api/sync` work with latest CLIProxyAPI usage telemetry without losing existing old-CPA compatibility.

### Deliverables
- Queue clients: RESP (`net`/`tls`) and HTTP `/usage-queue`.
- Usage event schema/parser/mapping with exact default behavior.
- DB schema/migration for `request_id` and safe dedupe.
- Sync orchestration with source order, lock, metrics, and fallback reporting.
- Vitest configuration and unit tests.
- Deployment and docs updates.

### Definition of Done (verifiable conditions with commands)
- `pnpm install` succeeds and lockfile is updated only for required test deps.
- `pnpm test` passes all Vitest tests.
- `pnpm lint` passes.
- `pnpm build` passes.
- `pnpm run db:generate` creates one migration for `usage_records.request_id` unless executor hand-writes equivalent SQL and verifies it.
- `bash scripts/t15-smoke.sh all` passes.
- A real Docker Compose validation runs from `~/GitRepos/cliproxyapi-monitor/cpa-runtime` using `cpa-runtime/docker-compose.yml` plus isolation safeguards, and proves sync works without touching current cliproxyapi compose containers.
- `/api/sync` returns JSON indicating selected source (`resp`, `http-usage-queue`, or `legacy-usage`) and insert counts.

### Must Have
- Use `CLIPROXY_MANAGEMENT_KEY` for `/v0/management/*`, RESP `AUTH`, and HTTP `/usage-queue`; keep `CLIPROXY_SECRET_KEY` for proxy API-key behavior such as `/v1/models` validation.
- Backward compatibility fallback chain in `auto` mode: `RESP` → `HTTP /v0/management/usage-queue` → legacy `/v0/management/usage`.
- RESP supports plain TCP for `http://...` and TLS for `https://...`; any connection/protocol/auth failure must fall back without banning via repeated auth retries.
- Queue ingestion redacts `api_key` and any obvious bearer-like fields before serializing `raw`.
- Queue ingestion stores `request_id` when provided and uses request-id dedupe before approximate legacy unique constraints.
- Queue ingestion disables the legacy incremental lookback filter; legacy `/usage` keeps it.
- Sync uses a DB advisory lock or equivalent process-safe DB lock so concurrent sync calls do not destructively split the queue.
- Final runtime validation must use `cpa-runtime/docker-compose.yml` as requested by the user; use a unique Compose project name and override ports/data directories if needed so existing CPA containers and bind-mounted data are not stopped, removed, or overwritten.
- The `cpa-runtime` validation must run the newly implemented monitor code, not the remote `controlnet/cliproxyapi-monitor:latest` image; use an override that sets `dashboard.build.context: ..` or points `dashboard.image` to a freshly built local test image.
- CHANGELOG entry must be Chinese and dated.

### Must NOT Have
- Do not copy, print, or commit real keys from `config.yaml`, logs, `.env`, or runtime output.
- Do not add a standalone Redis dependency/server; CPA is not a real Redis service.
- Do not remove existing auth-files/logs/quota endpoints unless directly required.
- Do not run Docker against the current production-ish compose stack; use `cpa-runtime` or the smoke script's isolated compose project.
- Do not run `docker compose down`, `stop`, or volume removal against any existing non-test Compose project. Only bring down the unique test project created for validation.
- Do not use human/manual verification as acceptance; all checks must be agent-executed.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: Vitest + tests-after; focus on protocol/parser/mapping/fallback logic.
- QA policy: Every task has agent-executed scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`.

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Task 1 config/credentials, Task 2 DB schema, Task 3 parser/redaction, Task 7 Vitest setup.
Wave 2: Task 4 queue clients, Task 5 sync orchestrator, Task 6 management endpoint auth/config updates.
Wave 3: Task 8 deployment/docs/smoke, Task 9 final local verification fixes.

### Dependency Matrix (full, all tasks)
- Task 1 blocks Tasks 4, 5, 6, 8.
- Task 2 blocks Task 3 insert contract and Task 5 DB writes.
- Task 3 blocks Task 5 and Task 7 tests.
- Task 4 blocks Task 5 and Task 7 fallback tests.
- Task 5 blocks Task 8 smoke assertions and Task 9 verification.
- Task 6 blocks Task 8 docs and Task 9 verification.
- Task 7 can start after Tasks 2/3/4 public APIs are defined.
- Task 8 blocks Task 9.

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 4 tasks → quick, unspecified-high.
- Wave 2 → 3 tasks → deep, unspecified-high.
- Wave 3 → 2 tasks → writing, unspecified-high.

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Add explicit management credential configuration

  **What to do**: Update `lib/config.ts` so `config.cliproxy` exposes `managementKey`, `apiKey`, `baseUrl`, `serviceBaseUrl`, and `modelsUrl`. `managementKey` must read `CLIPROXY_MANAGEMENT_KEY` first, then `MANAGEMENT_PASSWORD`, then fall back to `CLIPROXY_SECRET_KEY` only for backward compatibility with a warning in sync logs/docs. Update `assertEnv()` so management sync paths require a management key, while proxy API behavior can still use `apiKey`. Update `scripts/start-dashboard.sh` to stop pretending config `remote-management.secret-key` can be extracted: it may be bcrypt-hashed. It may copy `MANAGEMENT_PASSWORD` into `CLIPROXY_MANAGEMENT_KEY` when provided, but must not parse hashed YAML secrets.
  **Must NOT do**: Do not print key values. Do not read or persist real secrets from `config.yaml` into docs/tests.

  **Recommended Agent Profile**:
  - Category: `quick` - Small, contained config/startup change.
  - Skills: [] - No specialized skill required.
  - Omitted: [`secret-guard`] - Use later before commit; this task itself must avoid secret output.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [4, 5, 6, 8] | Blocked By: []

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `lib/config.ts:1-15` - URL normalization and `serviceBaseUrl` derivation to preserve.
  - Pattern: `lib/config.ts:34-47` - current env reads and `config.cliproxy` shape to extend.
  - Pattern: `lib/config.ts:56-66` - current env assertions to split between management key and proxy API key.
  - Pattern: `scripts/start-dashboard.sh:34-66` - currently extracts first API key as `CLIPROXY_SECRET_KEY`; do not do the same for management secret.
  - Pattern: `scripts/start-dashboard.sh:68-78` - current automatic base URL/password defaults.
  - External: `https://help.router-for.me/management/api` - management API requires plaintext management key via `Authorization: Bearer` or `X-Management-Key`; config plaintext may be hashed on startup.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `pnpm lint` reports no config/startup related lint errors.
  - [ ] Vitest config test verifies env precedence: `CLIPROXY_MANAGEMENT_KEY` > `MANAGEMENT_PASSWORD` > backward-compatible `CLIPROXY_SECRET_KEY` fallback.
  - [ ] `pnpm build` succeeds after config changes.
  - [ ] No command output contains actual secret values.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Explicit management key wins
    Tool: Bash
    Steps: Run `pnpm test -- --run config` after Task 7 adds Vitest tests; test sets CLIPROXY_MANAGEMENT_KEY=m1, MANAGEMENT_PASSWORD=m2, CLIPROXY_SECRET_KEY=a1.
    Expected: config.cliproxy.managementKey is m1 and config.cliproxy.apiKey is a1.
    Evidence: .sisyphus/evidence/task-1-config-key-priority.txt

  Scenario: Hashed YAML secret is not parsed
    Tool: Bash
    Steps: Run `CLIPROXY_CONFIG_PATH=config.yaml CLIPROXY_SECRET_KEY= MANAGEMENT_PASSWORD= sh -n scripts/start-dashboard.sh` and inspect script statically via `pnpm lint`.
    Expected: script syntax passes and no code path extracts `remote-management.secret-key` into CLIPROXY_MANAGEMENT_KEY.
    Evidence: .sisyphus/evidence/task-1-config-no-hashed-secret.txt
  ```

  **Commit**: YES | Message: `fix(config): separate management and proxy credentials` | Files: [`lib/config.ts`, `scripts/start-dashboard.sh`, related tests]

- [x] 2. Add `request_id` persistence and safe dedupe migration

  **What to do**: Add nullable `requestId`/`request_id` to `usageRecords` in `lib/db/schema.ts`. Generate or hand-write a new Drizzle migration after `0004_add_auth_file_mappings.sql` that adds the column and a unique partial index on `request_id` where it is not null. Update insert conflict handling so request-id conflicts do not throw; prefer `.onConflictDoNothing()` without a narrow target or equivalent SQL that respects both existing and new unique constraints.
  **Must NOT do**: Do not remove the existing approximate unique index; legacy snapshot dedupe still depends on it.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Schema/migration and insert conflict behavior require care.
  - Skills: [] - No specialized skill required.
  - Omitted: [`git-master`] - No git operations requested inside task.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [3, 5] | Blocked By: []

  **References**:
  - API/Type: `lib/db/schema.ts:12-33` - existing `usage_records` fields and unique index.
  - Pattern: `app/api/sync/route.ts:157-169` - current batch insert uses conflict target `(occurred_at, route, model, source)`.
  - Pattern: `drizzle.config.ts:3-9` - migration config.
  - Pattern: `scripts/migrate.mjs:34-77` - runtime migration path.
  - Pattern: `drizzle/0004_add_auth_file_mappings.sql:1-13` - current latest migration numbering style.

  **Acceptance Criteria**:
  - [ ] `lib/db/schema.ts` exposes `requestId: text("request_id")` on `usageRecords`.
  - [ ] A new migration exists after `0004_*` and includes `ALTER TABLE "usage_records" ADD COLUMN "request_id" text`.
  - [ ] Migration includes `CREATE UNIQUE INDEX ... ON "usage_records" ("request_id") WHERE "request_id" IS NOT NULL` or functionally equivalent SQL.
  - [ ] Insert conflict behavior does not throw on duplicate non-null request IDs.
  - [ ] `pnpm run db:generate` either produces no unexpected diff after migration is committed or is documented in evidence.

  **QA Scenarios**:
  ```
  Scenario: Migration applies cleanly
    Tool: Bash
    Steps: Run `pnpm run db:generate` and then `pnpm lint`.
    Expected: no schema drift beyond the intended request_id migration; lint passes.
    Evidence: .sisyphus/evidence/task-2-request-id-migration.txt

  Scenario: Duplicate request_id is ignored
    Tool: Bash
    Steps: Run `pnpm test -- --run usage-request-id` after Task 7 tests exist.
    Expected: inserting/mapping two events with same request_id results in one persisted/accepted logical row and no thrown unique error.
    Evidence: .sisyphus/evidence/task-2-request-id-dedupe.txt
  ```

  **Commit**: YES | Message: `fix(db): add request id dedupe for usage records` | Files: [`lib/db/schema.ts`, `drizzle/*`, `app/api/sync/route.ts`, related tests]

- [x] 3. Normalize latest CPA queue events into safe `usage_records`

  **What to do**: Extend `lib/usage.ts` with explicit queue event schemas and functions such as `parseUsageQueuePayload`, `toUsageRecordsFromQueueEvents`, and `redactUsageQueueRaw`. Exact mapping rules: `endpoint || "default"` → `route`; `model || alias || "unknown"` → `model`; `source || ""` → `source`; `auth_index` string/number → `authIndex`; invalid/missing `timestamp` → `pulledAt`; tokens default to `0`; `total_tokens` defaults to provided total or sum of input/output/reasoning when absent; `failed === true` means `isError=true`, otherwise false; malformed JSON queue items are skipped with warning metadata, not fatal for the whole sync; raw JSON must redact `api_key` to `"[REDACTED]"`; include `requestId` when present.
  **Must NOT do**: Do not reconstruct the old aggregate `usage.apis` tree for queue mode.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Parser correctness and data safety.
  - Skills: [] - No specialized skill required.
  - Omitted: [`ui-ux-pro-max`] - No UI changes.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [5, 7] | Blocked By: [2 for final requestId type]

  **References**:
  - Pattern: `lib/usage.ts:5-26` - existing zod token/detail schema style.
  - Pattern: `lib/usage.ts:57-89` - token/timestamp/source/auth/success helpers to reuse or mirror.
  - Pattern: `lib/usage.ts:91-135` - existing aggregate parser and row mapping.
  - API/Type: `lib/db/schema.ts:12-33` - target insert row shape.
  - External: `https://help.router-for.me/management/api` - `/usage-queue` response is always an array and removes returned records.
  - External: `https://help.router-for.me/management/redis-usage-queue.html` - queue payload fields and RESP single vs array behavior.

  **Acceptance Criteria**:
  - [ ] Queue event parser accepts arrays from HTTP `/usage-queue` and strings/arrays from RESP decoded values.
  - [ ] Empty queue maps to `[]` without error.
  - [ ] Invalid individual JSON item is counted/skipped without failing valid siblings.
  - [ ] Raw payload stored in `usageRecords.raw` never contains original `api_key` value.
  - [ ] Missing timestamp/model/endpoint/tokens follow the exact defaults above.

  **QA Scenarios**:
  ```
  Scenario: Happy path queue event mapping
    Tool: Bash
    Steps: Run `pnpm test -- --run usage-queue-mapping` with a fixture containing timestamp, endpoint, model, request_id, tokens, failed=false.
    Expected: one row with route from endpoint, model from model, requestId set, isError=false, and correct token columns.
    Evidence: .sisyphus/evidence/task-3-queue-mapping.txt

  Scenario: Malformed/sensitive event handling
    Tool: Bash
    Steps: Run `pnpm test -- --run usage-queue-redaction` with one invalid JSON item and one valid item containing api_key.
    Expected: valid item maps; invalid item is skipped/counted; raw contains `[REDACTED]` and not the original key.
    Evidence: .sisyphus/evidence/task-3-queue-redaction.txt
  ```

  **Commit**: YES | Message: `fix(usage): map queue telemetry records safely` | Files: [`lib/usage.ts`, related tests]

- [x] 4. Implement RESP and HTTP usage queue clients

  **What to do**: Create a small queue client module, e.g. `lib/cliproxy-usage-queue.ts`. Implement RESP command serialization for `AUTH <managementKey>` and `LPOP queue <count>`; parse simple strings, errors, integers, bulk strings including nil, and arrays across chunk boundaries. Use `net.connect` for `http://` service URLs and `tls.connect` for `https://` service URLs with SNI hostname. Implement HTTP queue fetch using `${config.cliproxy.baseUrl}/usage-queue?count=<n>` with `Authorization: Bearer ${managementKey}`. Add env tunables: `CLIPROXY_USAGE_QUEUE_BATCH_SIZE` default `100`, `CLIPROXY_USAGE_QUEUE_SOURCE` default `auto` with allowed `auto|resp|http|legacy`, and `CLIPROXY_USAGE_QUEUE_TIMEOUT_MS` default from sync timeout or `15000`.
  **Must NOT do**: Do not use `ioredis` or assume a standalone Redis server. Do not retry wrong credentials repeatedly; one auth failure per sync source is enough.

  **Recommended Agent Profile**:
  - Category: `deep` - Protocol parsing and transport fallback are failure-prone.
  - Skills: [] - No library docs beyond fetched official docs needed.
  - Omitted: [`playwright`] - No browser automation.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [5, 7] | Blocked By: [1]

  **References**:
  - Pattern: `app/api/sync/route.ts:66-78` - current timeout wrapper style for HTTP requests.
  - Pattern: `lib/config.ts:34-47` - service and management URLs.
  - External: `https://help.router-for.me/management/redis-usage-queue.html` - RESP availability, commands, TLS sharing, payload behavior.
  - External: `https://help.router-for.me/management/api` - `GET /usage-queue?count=10` HTTP fallback behavior.

  **Acceptance Criteria**:
  - [ ] RESP encoder emits valid RESP arrays for AUTH and LPOP.
  - [ ] RESP parser handles nil bulk string, empty arrays, chunk-split bulk strings, and error replies.
  - [ ] HTTP client treats `200 []` as empty success, `401/403` as auth failure, `404` as unsupported fallback signal, timeout as fallback signal.
  - [ ] Client result includes `{ source, records, warnings }` without leaking credentials.

  **QA Scenarios**:
  ```
  Scenario: RESP parser chunk boundary
    Tool: Bash
    Steps: Run `pnpm test -- --run resp-parser` with a bulk string split across multiple chunks.
    Expected: decoded JSON string exactly matches fixture and parser consumes all bytes.
    Evidence: .sisyphus/evidence/task-4-resp-parser.txt

  Scenario: HTTP usage-queue empty fallback-safe response
    Tool: Bash
    Steps: Run `pnpm test -- --run usage-queue-http` with mocked fetch returning `[]` and 404.
    Expected: 200 maps to empty success; 404 maps to unsupported so orchestrator can try legacy.
    Evidence: .sisyphus/evidence/task-4-http-queue.txt
  ```

  **Commit**: YES | Message: `fix(sync): add cliproxy usage queue clients` | Files: [`lib/cliproxy-usage-queue.ts`, related tests]

- [x] 5. Refactor `/api/sync` orchestration for queue-first ingestion

  **What to do**: Refactor `app/api/sync/route.ts` so sync flow is: authorize dashboard request; assert env; acquire PostgreSQL advisory lock for sync; sync auth files best-effort; select usage source based on `CLIPROXY_USAGE_QUEUE_SOURCE`; in `auto`, try RESP, then HTTP `/usage-queue`, then legacy `/usage`; map queue rows via Task 3; legacy rows via existing aggregate parser. Queue rows bypass `INCREMENTAL_LOOKBACK_MINUTES`; legacy rows keep current full/incremental behavior. Response JSON must include `source`, `attempted`, `insertAttempted`, `inserted`, `filteredOut`, `authFilesSynced`, `warnings`, and `fullSync`. If lock is held, return `409` with `{ error: "sync already running" }`.
  **Must NOT do**: Do not pop queue records before lock acquisition. Do not treat empty queue as failure. Do not fail entire sync when auth-files sync fails.

  **Recommended Agent Profile**:
  - Category: `deep` - Central behavior change with concurrency and fallback paths.
  - Skills: [] - No specialized skill required.
  - Omitted: [`git-master`] - No git operations.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [8, 9] | Blocked By: [1, 2, 3, 4]

  **References**:
  - Pattern: `app/api/sync/route.ts:87-106` - existing dashboard/cron authorization to keep.
  - Pattern: `app/api/sync/route.ts:108-146` - auth-files sync remains best-effort.
  - Pattern: `app/api/sync/route.ts:157-202` - usage insert batching/retry to preserve and adapt conflict behavior.
  - Pattern: `app/api/sync/route.ts:214-258` - legacy `/usage` fetch/parse path to move into fallback helper.
  - Pattern: `app/api/sync/route.ts:262-295` - incremental filter retained only for legacy aggregate source.
  - Pattern: `app/api/sync/route.ts:359-369` - response shape to extend, not silently break.

  **Acceptance Criteria**:
  - [ ] `CLIPROXY_USAGE_QUEUE_SOURCE=auto` tries sources in exact order RESP → HTTP queue → legacy usage.
  - [ ] `CLIPROXY_USAGE_QUEUE_SOURCE=resp` does not call HTTP queue or legacy on RESP failure; returns 502 with safe warning.
  - [ ] Queue source empty records returns 200 with `message: "No usage data"` or equivalent and `source` set.
  - [ ] Concurrent sync attempt receives 409 before destructive queue pop.
  - [ ] Queue insert failure logs at-most-once warning without including raw secrets.

  **QA Scenarios**:
  ```
  Scenario: Auto fallback reaches legacy
    Tool: Bash
    Steps: Run `pnpm test -- --run sync-fallback` with RESP timeout, HTTP queue 404, legacy usage 200 fixture.
    Expected: result source is `legacy-usage`, rows are parsed with legacy lookback behavior.
    Evidence: .sisyphus/evidence/task-5-sync-fallback.txt

  Scenario: Lock prevents concurrent destructive consumption
    Tool: Bash
    Steps: Run `pnpm test -- --run sync-lock` with advisory lock mocked/held before calling sync.
    Expected: sync returns 409 and queue client mock is not called.
    Evidence: .sisyphus/evidence/task-5-sync-lock.txt
  ```

  **Commit**: YES | Message: `fix(sync): consume usage queue before legacy usage` | Files: [`app/api/sync/route.ts`, related helper modules/tests]

- [x] 6. Move management API calls to management credentials

  **What to do**: Audit upstream management calls and change management endpoints to use `config.cliproxy.managementKey`: `/auth-files`, `/logs`, `/request-error-logs`, `/usage-statistics-enabled`, `/usage-queue`, and quota `/api-call` management helpers if they target `/v0/management`. Keep OpenAI-compatible `/v1/models` validation on `config.cliproxy.apiKey` or user-provided bearer as currently designed. Update errors to say management key missing when management endpoints cannot run.
  **Must NOT do**: Do not change dashboard admin/user session cookies.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Multi-file auth behavior change.
  - Skills: [] - No specialized skill required.
  - Omitted: [`secret-guard`] - Run final secret scan separately if committing.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [8, 9] | Blocked By: [1]

  **References**:
  - Pattern: `app/api/sync/route.ts:108-117` - `/auth-files` currently uses `config.cliproxy.apiKey`.
  - Pattern: `lib/config.ts:41-47` - config credential shape after Task 1.
  - Explore finding: management proxy routes are `app/api/logs/route.ts`, `app/api/request-error-logs/route.ts`, `app/api/usage-statistics-enabled/route.ts`, `lib/user-quota.ts`.
  - External: `https://help.router-for.me/management/api` - all management requests require management key.

  **Acceptance Criteria**:
  - [ ] All `/v0/management/*` upstream calls use `managementKey`.
  - [ ] `/v1/models` validation behavior remains unchanged.
  - [ ] Missing management key returns actionable 501/502-style JSON without exposing env values.
  - [ ] `pnpm lint` and targeted tests pass.

  **QA Scenarios**:
  ```
  Scenario: Management endpoint uses management key
    Tool: Bash
    Steps: Run `pnpm test -- --run management-auth` with fetch mocked to capture Authorization headers for `/auth-files` and `/usage-statistics-enabled`.
    Expected: captured headers use CLIPROXY_MANAGEMENT_KEY, not CLIPROXY_SECRET_KEY.
    Evidence: .sisyphus/evidence/task-6-management-auth.txt

  Scenario: Models endpoint still uses proxy/user API key
    Tool: Bash
    Steps: Run `pnpm test -- --run models-auth` against `app/api/auth/verify/route.ts` behavior.
    Expected: `/v1/models` Authorization remains the user-provided bearer or proxy API key path, not management key.
    Evidence: .sisyphus/evidence/task-6-models-auth.txt
  ```

  **Commit**: YES | Message: `fix(auth): use management key for management api calls` | Files: [`app/api/*`, `lib/user-quota.ts`, `lib/config.ts`, related tests]

- [x] 7. Introduce Vitest and focused unit tests

  **What to do**: Add Vitest as a dev dependency, add `test` script to `package.json`, create minimal `vitest.config.ts` compatible with TS path alias `@/*`, and write tests only for new/changed non-UI logic: config env precedence, RESP encoder/parser, HTTP usage-queue client, queue mapping/redaction, request-id dedupe behavior, sync fallback selection, and management-vs-proxy auth selection.
  **Must NOT do**: Do not add broad UI snapshot tests or unrelated refactors.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Test infra and mocks must align with Next/TS setup.
  - Skills: [] - No specialized skill required.
  - Omitted: [`playwright`] - Browser tests are not needed here.

  **Parallelization**: Can Parallel: YES | Wave 1 then continues Wave 2 | Blocks: [9] | Blocked By: public APIs from [1, 3, 4, 5, 6]

  **References**:
  - Pattern: `package.json:6-15` - current scripts; add `test` without breaking existing scripts.
  - Pattern: `package.json:28-39` - current devDependencies; add Vitest-related deps only.
  - Pattern: `tsconfig.json` if present - use existing TS path alias config when creating Vitest config.
  - Pattern: `lib/usage.ts:91-135` - pure functions are good test targets.

  **Acceptance Criteria**:
  - [ ] `package.json` has `"test": "vitest run"` or equivalent non-watch command.
  - [ ] `pnpm test` passes headlessly.
  - [ ] Tests cover success and failure paths for each new parser/client/fallback component.
  - [ ] No test fixture contains real credentials; use placeholders like `test-management-key` and `sk-test-redacted`.

  **QA Scenarios**:
  ```
  Scenario: Full focused unit suite
    Tool: Bash
    Steps: Run `pnpm test`.
    Expected: all Vitest files pass; output includes config, RESP, queue mapping, fallback, and auth tests.
    Evidence: .sisyphus/evidence/task-7-vitest.txt

  Scenario: No secret fixtures
    Tool: Bash
    Steps: Run `pnpm test -- --run redaction` and inspect test fixtures for placeholder-only credentials.
    Expected: tests pass and no real-looking key from local config/logs appears in fixtures.
    Evidence: .sisyphus/evidence/task-7-no-secret-fixtures.txt
  ```

  **Commit**: YES | Message: `test(sync): cover usage queue ingestion` | Files: [`package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `**/*.test.ts`]

- [x] 8. Update deployment defaults, smoke coverage, README, env example, and CHANGELOG

  **What to do**: Update `.env.example` and `README.md` with `CLIPROXY_MANAGEMENT_KEY`, `CLIPROXY_USAGE_QUEUE_SOURCE`, `CLIPROXY_USAGE_QUEUE_BATCH_SIZE`, `CLIPROXY_USAGE_QUEUE_TIMEOUT_MS`, and operational notes: queue records are destructive/at-most-once, default CPA retention is ~60s/max 3600, sync interval must be shorter than retention, and HTTPS/reverse proxy may need HTTP `/usage-queue` fallback. Update root `docker-compose.yml` defaults so `sync-cron` interval is compatible with retention (target `* * * * *` unless explicitly overridden) and document how to set CPA `redis-usage-queue-retention-seconds`/`MANAGEMENT_PASSWORD` in `cli-proxy-api` service without hardcoding real secrets. Mirror required runtime env/schedule changes into `cpa-runtime/docker-compose.yml` or document why a local override is safer. Document the required `cpa-runtime` verification override: `dashboard` must build from `..` or use a freshly built local image so the test exercises the new code instead of Docker Hub `latest`. Extend `scripts/t15-smoke.sh` so pass mode can assert `/api/sync` reports a queue-compatible source and fail mode still catches upstream errors. Add a dated Chinese `CHANGELOG.md` entry.
  **Must NOT do**: Do not put real keys into docs, compose, smoke output, or changelog.

  **Recommended Agent Profile**:
  - Category: `writing` - Mostly docs/config prose plus small shell smoke update.
  - Skills: [] - No specialized skill required.
  - Omitted: [`ui-ux-pro-max`] - No UI design.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: [9] | Blocked By: [1, 5, 6]

  **References**:
  - Pattern: `.env.example:1-7` - current CPA env section to extend.
  - Pattern: `.env.example:34-37` - current sync tuning env section.
  - Pattern: `docker-compose.yml:31-37` - current `sync-cron` schedule is every 10 minutes.
  - Pattern: `docker-compose.yml:115-123` - current `cli-proxy-api` service env/volume area.
  - Pattern: `cpa-runtime/docker-compose.yml:1-125` - user-requested real Docker validation compose file; dashboard maps `9318:3000`, CPA maps `9317:8317`, and bind mounts runtime data.
  - Pattern: `README.md:36-60` - compose/env table to update.
  - Pattern: `README.md:93-98` - local dev steps to update with test command.
  - Pattern: `CHANGELOG.md:1-10` - Chinese dated entry style.
  - Pattern: `scripts/t15-smoke.sh:120-183` - pass mode currently only checks sync reachable.
  - Pattern: `scripts/t15-smoke.sh:221-281` - fail mode checks wrong token and upstream unavailable path.

  **Acceptance Criteria**:
  - [ ] README explains latest CPA `/usage` removal and new queue behavior in Chinese.
  - [ ] `.env.example` lists all new env vars with safe empty/default values.
  - [ ] `docker-compose.yml` does not hardcode real management secrets.
  - [ ] `cpa-runtime/docker-compose.yml` is either updated with safe placeholders/defaults or the plan/docs provide an explicit override-file command that leaves its existing bind-mounted data untouched.
  - [ ] `cpa-runtime` docs/evidence show the dashboard service uses a local build or local test image for validation, not the remote `latest` image.
  - [ ] `CHANGELOG.md` has a new top dated Chinese entry summarizing behavior and operational impact.
  - [ ] Smoke script evidence includes sync response source and still writes pass/fail evidence files.

  **QA Scenarios**:
  ```
  Scenario: Documentation/env consistency
    Tool: Bash
    Steps: Run `pnpm lint` and `node -e "const fs=require('node:fs');const names=['CLIPROXY_MANAGEMENT_KEY','CLIPROXY_USAGE_QUEUE_SOURCE','CLIPROXY_USAGE_QUEUE_BATCH_SIZE','CLIPROXY_USAGE_QUEUE_TIMEOUT_MS'];for (const f of ['README.md','.env.example']) { const s=fs.readFileSync(f,'utf8'); for (const n of names) if (!s.includes(n)) throw new Error(f+' missing '+n); }"`.
    Expected: every new env appears in both README and .env.example; lint passes.
    Evidence: .sisyphus/evidence/task-8-doc-env-consistency.txt

  Scenario: Smoke captures queue-compatible sync response
    Tool: Bash
    Steps: From safe Docker runtime, run `bash scripts/t15-smoke.sh pass`.
    Expected: evidence file includes `AUTHORIZED_SYNC_STATUS=2xx` and response body includes `source` or explicit queue/legacy source warning.
    Evidence: .sisyphus/evidence/task-8-smoke-sync-source.txt

  Scenario: cpa-runtime compose remains isolated
    Tool: Bash
    Steps: From `~/GitRepos/cliproxyapi-monitor/cpa-runtime`, run `docker compose -p cliproxyapi-monitor-queue-test -f docker-compose.yml -f /tmp/cliproxyapi-monitor-queue-test.override.yml config --quiet` where the override changes host ports/bind mounts to temporary test paths and sets `dashboard.build.context: ..` or a local test image.
    Expected: compose config validates, dashboard points at local updated code, and the setup uses only the unique `cliproxyapi-monitor-queue-test` project plus temporary test paths; no existing containers are stopped.
    Evidence: .sisyphus/evidence/task-8-cpa-runtime-compose-isolation.txt
  ```

  **Commit**: YES | Message: `docs(sync): document usage queue operation` | Files: [`.env.example`, `README.md`, `docker-compose.yml`, `cpa-runtime/docker-compose.yml`, `scripts/t15-smoke.sh`, `CHANGELOG.md`]

- [x] 9. Run full verification and fix regressions

  **What to do**: Run the complete verification stack after all implementation tasks: install/update deps, unit tests, lint, build, migration check, isolated smoke, and the user-requested real Docker Compose validation in `cpa-runtime`. Fix only regressions caused by this plan. Capture evidence files under `.sisyphus/evidence/`. For the `cpa-runtime` validation, run from `~/GitRepos/cliproxyapi-monitor/cpa-runtime` with a unique project name such as `cliproxyapi-monitor-queue-test`; before starting, inspect existing containers/ports, create a temporary override file that changes host ports and bind mounts to temporary test directories if needed, and sets dashboard to the local updated code via `build.context: ..` or a freshly built local image; only tear down that unique test project.
  **Must NOT do**: Do not broaden scope into UI redesign, pricing changes, quota features, or unrelated cleanup.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Cross-cutting QA and regression fixes.
  - Skills: [] - Load `secret-guard` only if committing/pushing is requested later.
  - Omitted: [`playwright`] - Use only if UI/browser regression appears; not expected.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: [] | Blocked By: [1, 2, 3, 4, 5, 6, 7, 8]

  **References**:
  - Pattern: `package.json:6-15` - scripts to run.
  - Pattern: `README.md:93-98` - local dev commands.
  - Pattern: `AGENTS.md` - Docker testing must run in `cpa-runtime`.
  - Pattern: `cpa-runtime/docker-compose.yml:1-125` - required real Docker Compose validation target.
  - Pattern: `scripts/t15-smoke.sh:11-18` - smoke evidence file defaults.

  **Acceptance Criteria**:
  - [ ] `pnpm install` succeeds if dependencies changed.
  - [ ] `pnpm test` passes.
  - [ ] `pnpm lint` passes.
  - [ ] `pnpm build` passes.
  - [ ] `pnpm run db:generate` shows no unintended schema drift.
  - [ ] `bash scripts/t15-smoke.sh all` passes in safe runtime.
  - [ ] From `~/GitRepos/cliproxyapi-monitor/cpa-runtime`, a unique-project Compose run validates dashboard + postgres + cli-proxy-api + sync-cron and proves `/api/sync` succeeds with queue-compatible source reporting.
  - [ ] The `cpa-runtime` Compose run uses the local updated monitor image/build, verified by `docker compose ... config` evidence.
  - [ ] Existing pre-test CPA/monitor containers remain running with the same container IDs after the test, unless they were already unhealthy before the test and this is documented.
  - [ ] No evidence/log output contains real secrets.

  **QA Scenarios**:
  ```
  Scenario: Full local quality gates
    Tool: Bash
    Steps: Run `pnpm install && pnpm test && pnpm lint && pnpm build && pnpm run db:generate`.
    Expected: all commands exit 0; db generate has no unintended diff beyond committed migration.
    Evidence: .sisyphus/evidence/task-9-quality-gates.txt

  Scenario: Full isolated smoke
    Tool: Bash
    Steps: Run `bash scripts/t15-smoke.sh all` from the approved Docker runtime context.
    Expected: pass and fail smoke cases end with `VERDICT=PASS` and do not affect existing containers.
    Evidence: .sisyphus/evidence/task-9-smoke-all.txt

  Scenario: Real cpa-runtime compose validation
    Tool: Bash
    Steps: Run from `~/GitRepos/cliproxyapi-monitor/cpa-runtime`: record `docker compose ps -q` and relevant `docker ps` IDs before the test; create `/tmp/cliproxyapi-monitor-queue-test.override.yml` with temporary host ports/data bind mounts and `dashboard.build.context: ..`; run `docker compose -p cliproxyapi-monitor-queue-test -f docker-compose.yml -f /tmp/cliproxyapi-monitor-queue-test.override.yml config` and save evidence; run `docker compose -p cliproxyapi-monitor-queue-test -f docker-compose.yml -f /tmp/cliproxyapi-monitor-queue-test.override.yml up -d --build`; wait for dashboard health; call `POST /api/sync` with the test cron token; then run `docker compose -p cliproxyapi-monitor-queue-test -f docker-compose.yml -f /tmp/cliproxyapi-monitor-queue-test.override.yml down --remove-orphans` for only the test project.
    Expected: `/api/sync` returns 2xx and includes `source`; compose config shows dashboard builds from local updated code; existing non-test container IDs are unchanged; only `cliproxyapi-monitor-queue-test` containers are removed.
    Evidence: .sisyphus/evidence/task-9-cpa-runtime-real-compose.txt
  ```

  **Commit**: YES | Message: `chore(sync): verify usage queue migration` | Files: [regression fixes only]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle

  **Tool/Agent**: `task(subagent_type="oracle", run_in_background=true)`
  **Prompt**: Review `.sisyphus/plans/update-cliproxyapi-monitor.md` against the completed diff. Verify every Must Have, Must NOT Have, acceptance criterion, and user-added `cpa-runtime` Docker requirement. Return APPROVE only if all plan obligations are satisfied; otherwise list exact missing items with file paths.
  **Approval Criteria**:
  - All 9 implementation tasks are either complete or explicitly not applicable with evidence.
  - RESP → HTTP `/usage-queue` → legacy `/usage` fallback exists and is tested.
  - `cpa-runtime` real Compose validation evidence exists and proves non-test containers were not affected.
  - No plan guardrail is violated.
  **Evidence**: `.sisyphus/evidence/final-f1-plan-compliance.md`

- [x] F2. Code Quality Review — unspecified-high

  **Tool/Agent**: `task(category="unspecified-high", run_in_background=true)`
  **Prompt**: Review the completed implementation for maintainability, TypeScript correctness, error handling, connection cleanup, test quality, migration safety, and secret handling. Inspect the relevant changed files only. Return APPROVE only if code is production-ready; otherwise provide blocking issues with exact files and remediation.
  **Approval Criteria**:
  - RESP sockets always close on success, timeout, and errors.
  - Fallback logic is readable and does not swallow auth/config failures silently.
  - Tests are deterministic and do not require real secrets.
  - DB migration and insert conflict behavior are safe for existing data.
  - No unnecessary broad refactors or UI changes were introduced.
  **Evidence**: `.sisyphus/evidence/final-f2-code-quality.md`

- [x] F3. Agent-executed Runtime QA — unspecified-high

  **Tool/Agent**: `task(category="unspecified-high", run_in_background=true)`
  **Prompt**: Execute runtime QA without human/manual intervention. Run `pnpm test`, `pnpm lint`, `pnpm build`, `bash scripts/t15-smoke.sh all`, and the required real Docker Compose validation from `~/GitRepos/cliproxyapi-monitor/cpa-runtime` using a unique project name and override that builds the local monitor code. Capture command outputs and verify existing non-test container IDs remain unchanged. Return APPROVE only if all commands pass and no secrets appear in evidence.
  **Approval Criteria**:
  - Unit tests, lint, build, and smoke pass.
  - `cpa-runtime` Compose test uses local updated dashboard build/image.
  - `/api/sync` returns 2xx with `source` in response.
  - Existing non-test CPA/monitor containers are not stopped, removed, or recreated.
  - Evidence redacts tokens/passwords/keys.
  **Evidence**: `.sisyphus/evidence/final-f3-runtime-qa.md`

- [x] F4. Scope Fidelity Check — deep

  **Tool/Agent**: `task(category="deep", run_in_background=true)`
  **Prompt**: Compare the completed changes to the original user request, interview decisions, and plan scope. Verify the work updates cliproxyapi-monitor for latest CPA usage telemetry and does not introduce unrelated UI, quota, pricing, or deployment changes. Return APPROVE only if scope is faithful and all deviations are justified by the plan.
  **Approval Criteria**:
  - Changes are limited to sync ingestion, credential config, schema/migration, tests, docs/compose/smoke, and necessary support code.
  - Legacy compatibility is preserved as planned.
  - New Docker validation requirement is satisfied exactly with `cpa-runtime`.
  - Any extra changes are documented as necessary and low-risk.
  **Evidence**: `.sisyphus/evidence/final-f4-scope-fidelity.md`

## Commit Strategy
- Commit after coherent task groups if implementation is delegated: config/schema, queue parser/client, sync orchestration, tests/docs.
- Do not commit `.env`, runtime logs, `.sisyphus/evidence`, or secrets.
- Before any commit, run a secret scan or load `secret-guard`; current working tree may contain local config values and must not leak.

## Success Criteria
- Latest CPA deployments sync usage through queue APIs.
- Older CPA deployments can still sync through legacy `/usage` when queue paths are unavailable.
- Queue records are not silently dropped by old lookback filtering or weak unique keys.
- Sync is concurrency-safe for destructive queue pops.
- Raw persisted usage data is redacted.
- Operators have clear docs for management key, retention, cron interval, and transport compatibility.
