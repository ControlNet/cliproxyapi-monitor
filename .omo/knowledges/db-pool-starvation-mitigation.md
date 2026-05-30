# Dashboard DB pool starvation mitigation

Date: 2026-05-29

The dashboard's PostgreSQL pool timeout (`timeout exceeded when trying to connect`) was not caused by the `/api/prices` query itself. The main hotspot is `lib/queries/overview.ts:getOverview()`: one cold `/api/overview` or `/api/user/overview` request used to schedule 11 independent DB queries at once, which can exhaust the default pool of 10 connections and make light routes wait for a client.

Mitigation applied:

- `getOverview()` now executes those 11 reads in small batches of at most 3 concurrent queries, leaving pool headroom for prices, sync status, and other users.
- `app/api/overview/route.ts` and `app/api/user/overview/route.ts` keep their 30s completed-result caches and now also dedupe same-key in-flight requests. `skipCache` is included in the in-flight key so forced refreshes do not join normal cacheable reads.
- `app/api/prices/route.ts` now reads through `lib/queries/model-prices.ts`, which provides a 30s process cache and in-flight dedupe. Manual price writes/deletes and successful model price sync updates call `invalidateModelPricesCache()`.

Operational note: this complements, but does not replace, the pool defaults (`DATABASE_POOL_MAX=10`, `DATABASE_POOL_CONNECTION_TIMEOUT_MS=30000`). Avoid blindly raising the pool further unless PostgreSQL `max_connections` headroom and app instance count are known.
