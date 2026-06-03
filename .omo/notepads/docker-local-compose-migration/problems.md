# Problems — docker-local-compose-migration

- (init) No unresolved problems logged yet.

- 2026-02-21 (F2): `next-env.d.ts` is still modified in working tree (`import "./.next/types/routes.d.ts"` drift). This violates the plan guardrail requiring no next-env contamination at final handoff.
- 2026-02-21 (F2): Residual `.t15-smoke-env.*` files remain in repo root after smoke workflows, leaving transient env artifacts that should be cleaned or ignored before final delivery.

- 2026-02-21 (F4 unresolved): `next-env.d.ts` is currently dirty in workspace and must be normalized/cleaned before final delivery to satisfy Must NOT Have guardrails.
- 2026-02-21 (F4 unresolved): `.sisyphus/plans/` appears in git status as untracked process artifact; orchestrator read-only ownership should be reaffirmed before landing.
- 2026-02-21 (F4 unresolved): `.t15-smoke-env.*` temporary env files should be removed or ignored to avoid accidental inclusion of secret-like config artifacts.

- 2026-02-21 (T15-playwright unresolved): `postgres` healthcheck intermittently times out despite "accepting connections", causing `service_healthy` gating to stall compose startup for dependent services during isolated QA runs.

- 2026-02-21 (F3 unresolved): Isolated project `cliproxyapi-monitor-f3qa-r2` reproduces the same postgres healthcheck timeout pattern (`Health check exceeded timeout (5s): ... accepting connections`); root cause not yet identified.
