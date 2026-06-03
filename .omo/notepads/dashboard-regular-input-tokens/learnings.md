# Learnings — dashboard-regular-input-tokens

- (init) No execution learnings yet.
- 2026-02-21T01:55:00Z homepage input-token map: KPI card (lines 1334-1371) and hourly stacked charts + fullscreen modal (tooltip order/legend payloads + dataKey="inputTokens") with hourlyVisible toggles; verified with grep counts for inputTokens (15 hits), totalInputTokens (1 hit), dataKey="inputTokens" (3 hits).
- 2026-02-21T08:36:00Z Confirmed input-token surfaces in app/page.tsx: overview KPI row (overviewData.totalInputTokens) plus hourly doughy view (tooltip order map, legend keyMap/payload, hide={!hourlyVisible.inputTokens}, <Bar dataKey="inputTokens") and fullscreen modal (matching tooltip/legend + area/bar layers); documented in .sisyphus/evidence/task-T1-surface-inventory.txt with grep verification (totalInputTokens=1, dataKey="inputTokens"=3, hourlyVisible.inputTokens=3, keyMap entries at lines 1830/2568 mapping "输入" → "inputTokens").

- 2026-02-21T02:07:31Z Added `REGULAR_INPUT_EXPR` in `lib/queries/overview.ts` using `greatest("usage_records"."input_tokens" - "usage_records"."cached_tokens", 0)` (aligned with records clamp semantics), and reused it in a non-breaking aggregate field (`regularInputTokens`) to centralize SQL expression before T3/T4 wiring.

- 2026-02-21T09:10:00Z T3 rewired overview aggregation mapping: `overview.totalInputTokens` and `models[].inputTokens` now consume aggregated `regularInputTokens` (from shared `REGULAR_INPUT_EXPR`), while `models[].cost` still uses raw `inputTokens` + `cachedTokens` in `estimateCost` to preserve original billing math and avoid double subtraction.

- 2026-02-21T09:24:00Z T4 switched hourly series semantics in `lib/queries/overview.ts`: `byHourPromise` now aggregates `inputTokens` with `coalesce(sum(${REGULAR_INPUT_EXPR}), 0)` (shared centralized regular-input expression), while `byHour.tokens` remains `sum(totalTokens)` and `byHour` mapping keeps `inputTokens: toNumber(row.inputTokens)` plus unchanged `cachedTokens: toNumber(row.cachedTokens)`.

- 2026-02-21T09:45:00Z T5 hardened cost boundaries in `lib/queries/overview.ts` by renaming cost-source aggregates to `rawInputTokens` (`ModelAggRow`/`DayModelAggRow` + SQL aliases) and routing `estimateCost` through explicit `rawInputTokensForCost` locals, while display-only fields keep `regularInputTokens` semantics (`models[].inputTokens`, `overview.totalInputTokens`, and hourly display input).
- 2026-02-21T10:07:00Z Documented in \ that the \ fields on \/\ and \ represent regular input tokens (input minus cached, clamped) so downstream views understand the refreshed semantics.
- 2026-02-21T10:12:00Z Corrected earlier note: ModelUsage.inputTokens, UsageSeriesPoint.inputTokens, and UsageOverview.totalInputTokens now explicitly document regular input tokens (input minus cached, clamped) so downstream views know they match the recalibrated aggregates.
- 2026-02-21T02:49:27Z T7 updated Tokens KPI copy in app/page.tsx line 1356 from 输入 to 输入(不含缓存); kept value binding unchanged at overviewData.totalInputTokens and left chart legends/tooltips untouched.

- 2026-02-21T03:05:29Z T8 normal hourly chart wording updated in app/page.tsx only: tooltip input-name color guard, legend keyMap/colors/payload, and normal Bar `name` now use `输入(不含缓存)` while preserving `dataKey="inputTokens"` and leaving fullscreen block (`~2568+`) unchanged.

- 2026-02-21T10:28:00Z T9 aligned fullscreen hourly chart wording in `app/page.tsx` with normal view by updating tooltip input-name color guard, legend keyMap/colors/payload, and fullscreen Area/Bar `name` to `输入(不含缓存)` while keeping `dataKey="inputTokens"` and `hourlyVisible.inputTokens` behavior unchanged; required grep verification now shows both normal (~1800) and fullscreen (~2570/2594/2603/2610) paths consistent.

- 2026-02-21T10:40:00Z T10 updated `CHANGELOG.md` with a dated Chinese entry documenting homepage dashboard input-token display semantics as `regular-input` (`input - cached`, clamped) and UI copy as `输入(不含缓存)`, with an explicit note that cost calculation path remains unchanged.
2026-02-21 T13 gate: pnpm lint passed (see .sisyphus/evidence/task-T13-lint.txt). pnpm build required DATABASE_URL placeholder after initial missing connection error; migrations still log SSL/EPROTO but Next.js build completes (see .sisyphus/evidence/task-T13-build.txt).

- 2026-02-21T03:41:49+00:00 F4 scope-fidelity deep check confirms implementation changes stayed inside planned surface (`overview.ts`, `page.tsx`, `types.ts`, `CHANGELOG.md`), preserved guardrails (no DB schema/global field rename, no `/records`/`/explore` semantic drift), and kept contamination clean (`next-env.d.ts` unchanged).

- 2026-02-21T03:39:50Z F2 review pattern: run manual diff read first, then grep anti-pattern scan + lsp diagnostics, then lint/build. For this branch snapshot, changed source files were clean at error/warning severity, but grep still surfaced pre-existing `as any`/`TODO` in `app/page.tsx`, so file-quality summary should distinguish pre-existing findings from newly introduced diff risks.
- 2026-02-21T03:43:52+00:00 F1 audit: Plan compliance verdict FAIL; evidence completeness only T1/T11/T12/T13 present (4/13), missing evidence for T2–T10; T11/T12 remain BLOCKED by env/API failures. Report: `.sisyphus/evidence/final-qa/f1-plan-compliance-audit.md`.

- 2026-02-21T03:51:00+00:00 F3 re-run pattern: combine Playwright DOM assertions (`innerText` contains check + button inventory for fullscreen trigger) with curl smoke on `/api/overview` default+filtered to prove whether `输入(不含缓存)` is verifiable; in current env, missing DB/upstream vars block all data surfaces before KPI/legend/tooltip assertions can execute.

- 2026-02-21T04:10:00+00:00 Evidence backfill (T2–T10) can be completed without code edits by capturing command traces directly into plan-named artifacts; when API payloads fail to materialize, storing raw curl HTML/stack output plus jq parse failures provides auditable blocked-state proof instead of fabricated JSON assertions.

- 2026-02-21T04:26:00Z Copy rollback in `app/page.tsx`: reverted all homepage dashboard input labels from `输入(不含缓存)` to `输入` across KPI, normal hourly chart (tooltip legend keyMap/colors/payload + bar name), and fullscreen chart (tooltip legend keyMap/colors/payload + area/bar names) while preserving every `dataKey="inputTokens"` binding and hourly visibility mapping.

- 2026-02-21T04:38:44Z Final runtime QA rerun (env-ready) succeeded end-to-end: authenticated `/api/overview` default + filtered both returned 200 with non-negative checks passing for `overview.totalInputTokens`, `overview.byHour[].inputTokens`, `overview.models[].inputTokens`; Playwright verified KPI/normal legend+tooltip/fullscreen legend+tooltip all use `输入` and did not surface `输入(不含缓存)`.
- 2026-02-21T11:15:00Z Contamination cleanup: reverted QA delegation noise in `next-env.d.ts` so working tree stays strictly on purposeful changes before final checklist.

- 2026-02-21T04:54:30Z Evidence refresh rerun on env-ready runtime: authenticated `/api/overview` default + filtered requests both returned 200 with non-negative assertions true; refreshed T5/T11 JSON artifacts now include guard/assertion metadata and redact sensitive filter lists by count.
- 2026-02-21T04:54:30Z Playwright rerun updated T12 screenshots under plan filenames, confirming current UI copy uses `输入` in normal dashboard and fullscreen hourly modal scenes.
- 2026-02-21T11:32:00Z Normalized `.sisyphus/evidence/final-qa/f4-scope-fidelity-check.md` into one final PASS report, removed stale FAIL block, kept guardrail checks and `输入` rollback evidence explicit.
- 2026-02-21T11:40:00Z Changelog wording was corrected to match rollback final state: 2026-02-21 entry now states regular-input semantics changed while UI copy remains `输入`, and still notes cost path unchanged.
