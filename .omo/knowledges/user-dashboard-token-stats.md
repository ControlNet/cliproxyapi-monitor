## User dashboard token stats

- Admin dashboard token semantics live in `app/page.tsx`: `totalInputTokens` is regular input (`raw input - cached`, clamped), `totalRawInputTokens` is the original input total, and cache rate is `totalCachedTokens / totalRawInputTokens`.
- User dashboard data comes from `/api/user/overview`, backed by `lib/queries/user-safe.ts`. If user UI needs admin-compatible token breakdowns, expose the relevant `UsageOverview` fields at the user-safe top level and in `summary`.
- User Estimated Cost model tiles should consume explicit user-safe `models: { model, cost }[]` from `lib/queries/user-safe.ts`, not the full admin model shape in the client.
- Safe cpa-runtime QA can use an isolated compose project with `cpa-runtime/docker-compose.yml` plus a local override that builds the dashboard image from the repo and binds temp config/data directories outside the workspace.
