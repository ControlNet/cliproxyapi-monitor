# Corepack runtime migration error

## Summary

When a production dashboard container crashes during startup migrations with the following signature:

```text
TypeError [ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING]
.../corepack/.../pnpm.cjs
```

the failure usually means the runtime invoked `pnpm` through Corepack instead of using the repo's current startup path.

## Repo-specific findings

- Current container startup path is `Dockerfile -> scripts/start-dashboard.sh -> node /app/scripts/migrate.mjs`.
- `scripts/start-dashboard.sh` does **not** call `pnpm` at runtime.
- `scripts/migrate.mjs` is the canonical migration entrypoint.
- A stale manual command in `README.md` previously suggested `pnpm run migrate`; that command was corrected to `node /app/scripts/migrate.mjs`.

## Likely causes in production

1. The running container image was built before the runtime migration path stopped using `pnpm`.
2. An operator manually ran `pnpm run migrate` inside the container.
3. A deployment rebuilt nothing and only restarted the old container.

## Safe response

1. Rebuild the dashboard image.
2. Recreate the dashboard container from the rebuilt image.
3. For manual migration debugging, run `node /app/scripts/migrate.mjs` instead of `pnpm run migrate`.
4. Validate only in isolated compose/runtime stacks when production must remain untouched.

## External compatibility note

The error class matches a known Node VM / dynamic import callback failure mode when package-manager shims are executed through Corepack-managed paths. Even if the underlying Node/Corepack/pnpm combination is part of the trigger, the safest repo-level mitigation is still to avoid invoking `pnpm` during runtime-critical startup and migration paths.
