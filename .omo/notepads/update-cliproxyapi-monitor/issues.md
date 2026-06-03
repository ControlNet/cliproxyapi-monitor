
## 2026-05-11T01:06:00Z Task: task-9-verification
- Secret-guard tracked scan flagged `scripts/t15-smoke.sh` for placeholder password/header patterns only; no real credentials were present in Task 9 evidence files.
- The current smoke/`cpa-runtime` upstream fixture image (`eceasy/cli-proxy-api-plus:latest`) answered raw RESP attempts with HTTP bytes and returned HTTP 404 for `/v0/management/usage-queue`, so verification evidence shows explicit legacy fallback instead of queue-source success.

## 2026-05-11T11:08:00+08:00 Task: task-9-scope-cleanup
- Reverted the unrequested `AGENTS.md` rule addition because Task 9 has no plan-mandated project-rules change.
- Reduced `cpa-runtime/` to the plan-scoped validation asset only: kept `docker-compose.yml`, removed `__pycache__/`, `auths/`, `logs/`, `data/`, `Token-OpenAi/`, `config.yaml`, `task_1_accounts.txt`, `auto_claim_runner.py`, `auto_claim.sh`, and `clean_auth.py` because no repo reference or Task 9 requirement needed them.

## 2026-05-11T01:24:00Z Task: task-f3-runtime-qa
- Secret-guard `tracked` mode still flags `scripts/t15-smoke.sh` placeholder-style password/authorization patterns (`password="${...KEY}"`, test `Authorization: Bearer definitely-wrong-token`) as potential secrets, but the findings are false positives for QA evidence purposes and do not expose real credentials.
- Secret-guard `gitignore` audit still reports broad sensitive-pattern coverage gaps (`*.pem`, `*.key`, `credentials.json`, etc.); that is repo hygiene debt, not a blocker for this runtime QA verdict because no new secrets were introduced or emitted in the evidence.

## 2026-05-11T11:31:00+08:00 Task: final-wave-f1-f4-fix
- Final-wave cleanup needed one extra pass because prior Docker validation recreated root-owned empty directories under `cpa-runtime/` (`auths/`, `logs/`, `config.yaml/`). They were removed with a disposable container so the final state is the single plan-scoped `docker-compose.yml`.
