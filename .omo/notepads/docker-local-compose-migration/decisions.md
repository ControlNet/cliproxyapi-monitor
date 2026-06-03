# Decisions — docker-local-compose-migration

- (init) No decisions recorded yet.
- 2026-02-21 (T6): Keep `.env`/`.env.*` ignored in Docker builds and provide `.env.docker.example` as the safe runtime template plus Compose-compatible Postgres vars so deployers can supply secrets externally.
- 2026-02-21 (T6 fix): Build-time ARG defaults feed placeholder `DATABASE_URL`/`POSTGRES_URL` into the builder stage without leaking into the runtime image, keeping the runtime guard unchanged while allowing Docker builds to finish.

- 2026-02-21 (T7-fix): Preserve production-equivalent default published ports (`8318` for dashboard, `8317` for cli-proxy-api) but make host bindings env-overridable so local verification can avoid occupied ports without changing default behavior.
- 2026-02-21 (T7-fix): Standardize T7 verification on isolated compose project names plus alternate host ports to prevent interaction with user-managed long-running containers.

- 2026-02-21 (T8): Implement sync scheduling via a dedicated `sync-cron` compose sidecar using default schedule `0 21 * * *`, timezone from env (`TIMEZONE` -> `CRON_TIMEZONE`, default `Asia/Shanghai`), and a mounted `scripts/cron-sync.sh` trigger script.
- 2026-02-21 (T8): Keep `/api/sync` authorization strictly env-driven (`Authorization: Bearer $CRON_SECRET`) and fail fast on non-2xx responses with explicit status-code logging plus non-zero exit.

- 2026-02-21 (T9): Implement Postgres backup as an on-demand compose service (`pg-backup`) using `postgres:16-alpine` + mounted `scripts/pg-backup.sh`, with `docker compose run --rm pg-backup` as the execution entrypoint.
- 2026-02-21 (T9): Pin backup target to `/backups/postgres` in-container and map it to host `./backups/postgres`; enforce 7-day retention by default via `BACKUP_RETENTION_DAYS` and explicit stale-file pruning.
- 2026-02-21 (T10): Keep `.gitignore` coverage for `backups/` so local dumps, including the postgres retention directory, stay out of git while the existing `mkdir -p backups/postgres` flow continues unhindered.

- 2026-02-21 (T11): Gate `dashboard` startup exclusively on `postgres` health (`depends_on.postgres.condition: service_healthy`) so the DB dependency is explicit and no sleep-based readiness hacks are needed.
- 2026-02-21 (T11): Implement `dashboard` healthcheck with built-in Node runtime primitives (HTTP GET `/api/management-url` + TCP connect to `postgres:5432`) to avoid adding packages while ensuring dashboard health degrades when Postgres is unavailable.

- 2026-02-21 (T12): Standardize auth cookie transport policy on `AUTH_COOKIE_SECURE` (truthy values: `1/true/yes/on`), defaulting to non-secure for internal HTTP phase-1 deployments and requiring explicit `true` for HTTPS production.
- 2026-02-21 (T12): Apply the same `AUTH_COOKIE_SECURE` decision in both cookie-set paths (`proxy.ts` refresh and `/api/auth/verify` login) to eliminate policy drift.

- 2026-02-21 (T13): Standardize runbook verification on an isolated compose project (`cliproxyapi-monitor-t13safe` pattern) and alternate host ports so user-managed `cli-proxy-api-plus` services are never stopped or rebound during checks.
- 2026-02-21 (T13): Keep rollback instructions two-stage: always run `pg-backup` first, then execute either full checkout rollback or the documented deterministic dry-run when only path validation is needed.

- 2026-02-21 (T14): Add dedicated backup operations documentation at `docs/backup-ops.md`, covering daily trigger, 7-day retention verification, directory/disk checks, and failure troubleshooting only.
- 2026-02-21 (T14): Keep phase boundary explicit, this phase documents backup operations only and does not make periodic restore drills mandatory.

- 2026-02-21 (T15-retry): Keep T15 evidence capture non-pipeline for case execution (`run_pass`/`run_fail`), using output redirection with process substitution for logging so trap/env-file cleanup stays deterministic while still writing evidence files.
- 2026-02-21 (T15-retry-2): Replace EXIT-trap cleanup with explicit post-case cleanup and exit-code propagation in `scripts/t15-smoke.sh`; this eliminates trap side effects from child-shell logging paths while preserving deterministic teardown.

- 2026-02-21 (T15): Standardize T15 smoke on `scripts/t15-smoke.sh` with explicit `pass|fail` modes and isolated compose defaults to avoid touching existing critical `cli-proxy-api-plus` runtime.
- 2026-02-21 (T15): Keep T15 evidence files (`task-T15-smoke-pass.txt`, `task-T15-smoke-fail.txt`) concise and status-oriented, and reference Playwright artifacts directly for login/protected-route proof.

- 2026-02-21 (F4): Final scope-fidelity verdict is blocked (FAIL) until contamination issues are cleared, with `next-env.d.ts` drift treated as a hard guardrail violation and process artifacts (`.sisyphus/plans/`, `.t15-smoke-env.*`) treated as landing-hygiene blockers.

- 2026-02-21 (F1): For compliance audits, treat plan-marked “Evidence to Capture” artifacts as required; missing/empty artifacts => FAIL even if code appears correct.

- 2026-02-21 (T15-playwright): For isolated Playwright evidence refresh, keep the project/port isolation rule (`-p cliproxyapi-monitor-t15pw`, alt host ports) and treat auth-flow pass criteria independently from known non-auth API noise (`/api/usage-statistics-enabled` 500, possible `/api/sync` upstream failures).

- 2026-02-21 (F3): Mark authorized `/api/sync` returning `502` in isolated environment as an edge-case PASS condition (not auth failure) when wrong-token rejection still returns `401/403` and error payload remains traceable.
- 2026-02-21 (F3): Record final F3 verdict as PASS_WITH_ANOMALIES, with the postgres healthcheck-timeout behavior tracked separately as infra anomaly evidence instead of blocking runtime QA completion.
