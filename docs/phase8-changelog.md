# Phase 8 Changelog

## Files changed/added
- Root `package.json`, `.env.example`, `.gitignore`, `README.md`
- `apps/web/vite.config.ts`
- `apps/web/src/db/database.ts`
- `apps/web/src/infrastructure/sync/sync.engine.ts`
- `apps/web/src/infrastructure/errors.ts`
- `apps/web/src/infrastructure/logger.ts`
- `apps/web/src/app/App.tsx`, `AppErrorBoundary.tsx`
- `apps/web/src/infrastructure/share/share.service.ts`
- PWA `public/` assets
- `apps/api/src/app.ts`, `server.ts`, `repositories.ts`, tests
- `packages/utils/src/index.ts`
- `scripts/lint.mjs`
- Phase 8 documentation under `docs/`

## Bugs/hardening fixed
- Added explicit root test/lint/build/typecheck commands.
- Added safe PWA cache versioning and app-shell-only caching.
- Added missing PWA assets.
- Added sync single-flight behavior.
- Removed the security-sensitive random fallback from ID generation.
- Added API request limits, timeout, CORS policy, headers, sanitized errors and rate limiting.
- Added strict API request schemas.
- Added owner-device protection for shares created with an owner.
- Added repository abstractions around memory storage.
- Added graceful API shutdown.
- Added a UI error boundary.

## Migration changes
No historical Dexie v1–v5 migration block was modified. The only schema-level Phase 8 change is making the database constructor testable with a custom database name.

## Tests added
- API security/header/unknown-field/share-owner tests.
- v1–v5 -> current Dexie migration regression tests.

## Limitations
- No durable database adapter was added.
- No mandatory authentication was added.
- No Playwright E2E runner was present in the archive.
- No pnpm lockfile was fabricated because the archive had none.

## Verification status
See `docs/testing.md` and the final Phase 8 report. In this environment the pnpm command suite is BLOCKED because pnpm/dependencies cannot be downloaded without network access.
