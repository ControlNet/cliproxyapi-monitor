# Issues — docker-local-compose-migration

- (init) No active issues yet.

- 2026-02-21 (T2): In this repo's `.env`, direct `source .env` can fail because connection-string values include shell-significant characters (for example `&`). Use a parser-based loader (Node/Python) when running script-level verification from shell.
- 2026-02-21 (T2-fix): `pg` emits an SSL-mode compatibility warning for `sslmode=require/prefer` style URLs; migration still succeeds, but env URLs should migrate to explicit `sslmode=verify-full` (or libpq-compat flags) to avoid future pg v9 behavior drift.

- 2026-02-21 (T3): `app/api/management-url/route.ts` still auto-prefixes scheme-less values with `https://`; current T3 change is safe for explicit Docker URLs (`http://cli-proxy-api:8317`), but a follow-up should align this route with the updated config normalization if scheme-less inputs must be supported consistently.

- 2026-02-21 (T3-fix): The scheme-less default mismatch in `/api/management-url` is now corrected to `http://`; this closes the internal Docker HTTP acceptance gap while preserving explicit `https://` inputs.

- 2026-02-21 (T7-fix): Default host port `8317` can be occupied by an existing user-managed `cli-proxy-api-plus` container on shared hosts; verification should use override host ports and an isolated compose project name instead of stopping user services.

- 2026-02-21 (T8): Local `cli-proxy-api` can restart-loop if mounted `./config.yaml` is absent/invalid on a fresh checkout, causing `/api/sync` upstream calls to fail during compose verification. Mitigation used in T8 evidence: keep isolated project + alternate ports and point `CLIPROXY_API_BASE_URL` to an ephemeral mock upstream for deterministic cron sidecar auth/schedule checks.

- 2026-02-21 (T15-retry): Alternate host ports can still collide on shared runners (observed bind failure on `18678`), so retry logic should switch to a new isolated port pair instead of reusing a conflicted pair.
- 2026-02-21 (T15-retry-2): Concurrent external smoke runs can contend on `.next/lock` and the shared evidence target files, causing flaky `pnpm build` and mixed/truncated evidence; enforce one active T15 run before regenerating artifacts.

- 2026-02-21 (T15): `scripts/scan_secrets.py` is not present in this workspace, so the documented secret-guard helper commands cannot run as-is; fallback was to keep placeholder credentials only and avoid writing real secrets into evidence.
- 2026-02-21 (T15): In isolated smoke runs, authorized `/api/sync` consistently returns `502` when upstream `cli-proxy-api` is unavailable/unhealthy; this is captured as explicit edge evidence rather than treated as a silent pass.

- 2026-02-21 (F4): `next-env.d.ts` is modified in working tree (`./.next/dev/types/...` -> `./.next/types/...` drift), which violates plan guardrail "no next-env contamination" for final delivery.
- 2026-02-21 (F4): `.sisyphus/plans/` is present as untracked process artifact (`git status` shows `?? .sisyphus/plans/`), so orchestrator-owned read-only plan hygiene cannot be verified via tracked diff.
- 2026-02-21 (F4): Temporary `.t15-smoke-env.*` files remain untracked in workspace; although values are placeholders, this is a secret-like contamination surface that should be cleaned/ignored before landing.

- 2026-02-21 (F1): Plan compliance audit (docker-local-compose-migration) => VERDICT FAIL.
  - Missing mandatory task evidence artifacts for T1–T5 (plan “Evidence to Capture” files not found).
  - T15 failure-path evidence file exists but is empty: .
  - Guardrail violations evidenced in workspace: business-facing change recorded in  (regular-input semantics) and  drift present (shows as modified in On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   .env.example
	modified:   .gitignore
	modified:   app/api/auth/verify/route.ts
	modified:   app/api/management-url/route.ts
	modified:   app/layout.tsx
	modified:   lib/config.ts
	modified:   lib/db/client.ts
	modified:   next-env.d.ts
	modified:   package.json
	modified:   proxy.ts
	modified:   scripts/migrate.mjs

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	.beads/
	.dockerignore
	.env.docker.example
	.gitattributes
	.sisyphus/
	.t15-smoke-env.3XOO1A
	.t15-smoke-env.AMMlya
	.t15-smoke-env.rWOBc2
	AGENTS.md
	Dockerfile
	docker-compose.yml
	docs/
	scripts/cron-sync.sh
	scripts/pg-backup.sh
	scripts/t15-smoke.sh

no changes added to commit (use "git add" and/or "git commit -a")).

- 2026-02-21 (F1-note): The previous F1 entry above is partially garbled due to accidental shell interpolation while appending (backticks executed). Use this corrected pointer list instead:
  - Audit report: `.sisyphus/evidence/final-qa/f1-plan-compliance-audit.md` (docker-local-compose-migration).
  - T15 fail-path evidence missing (file exists but empty): `.sisyphus/evidence/task-T15-smoke-fail.txt`.
  - Business-change scope creep evidence: `CHANGELOG.md` (2026-02-21 entry, regular-input semantics).
  - next-env contamination evidence: `next-env.d.ts` contains generated typed-route import; workspace shows it as modified in `git status`.

- 2026-02-21 (F4 cleanup): `.t15-smoke-env.*` artifacts deleted and `next-env.d.ts` restored, so contamination guardrails now report PASS in the final QA reports.
- 2026-02-21 (F4 note): `.sisyphus/plans/` remains an orchestrator-managed untracked folder; confirm plan hygiene before final delivery.

- 2026-02-21 (T15-playwright): `postgres` healthcheck can stay `unhealthy` due timeout even while logs report `accepting connections`, which blocks `depends_on: service_healthy` startup for `dashboard`/`migrate` in isolated compose runs.

- 2026-02-21 (F3): `scripts/t15-smoke.sh` removes its temporary env file even with `T15_KEEP_STACK=1`; when `compose-up` fails, subsequent checks in the same run can cascade with `couldn't find env file` and produce noisy false negatives.
- 2026-02-21 (F1-evidence-backfill): Shared-host compose verification remains sensitive to pre-existing unhealthy stacks; even isolated smoke runs can fail `compose-up` on postgres health and should still record verdict-bearing fail evidence instead of empty artifacts.
- 2026-02-21 (F1-evidence-backfill): `@vercel/analytics` package can exist transitively; for deterministic failure-path evidence, target an invalid subpath import (e.g. `@vercel/analytics/non-existent`) rather than assuming package absence.

- 2026-02-21 (cleanup verify): Verified `.t15-smoke-env.*` deletion and `next-env.d.ts` restoration so contamination guardrails now report PASS.

- 2026-02-21 (F4 rerun): Current workspace contamination is still blocked by `next-env.d.ts` drift (`./.next/dev/types/routes.d.ts` -> `./.next/types/routes.d.ts` in `git diff -- next-env.d.ts`), while `.t15-smoke-env.*` remains clean.

- 2026-02-21 (F4 rerun-final): Recheck shows `git diff -- next-env.d.ts` is now empty and `.t15-smoke-env.*` is absent; the earlier drift state was transient and is no longer an active blocker.

- 2026-02-21 (F2 refresh): Running `pnpm build` in this workspace can transiently modify `next-env.d.ts` import target (`./.next/dev/types/...` vs `./.next/types/...`), which can create false contamination alarms unless the final status is checked after restoring tracked state.

- 2026-02-21 (final closure): Final QA artifacts had a verdict inconsistency, F1 reported Must NOT Have #3 = FAIL while F4 initially marked business-feature drift PASS. This required a documentation-only reconciliation update to keep final gate logic consistent.
- 2026-02-21 (final blocker): Plan closure remains blocked while `CHANGELOG.md` 2026-02-21 line 5 keeps a business semantics/UI change entry inside this migration batch scope.
