# Release Checklist — Phase 10

## Classification

- [x] PASS — source archive integrity
- [x] PASS — native SQLite transaction smoke test
- [x] PASS — static forbidden-pattern scan
- [x] PASS — `.exam` validation path reviewed
- [x] PASS — Dexie v1–v5 history left unchanged
- [ ] BLOCKED — reproducible pnpm install (missing `pnpm-lock.yaml`)
- [ ] NOT VERIFIED — typecheck
- [ ] NOT VERIFIED — unit/integration tests through pnpm
- [ ] NOT VERIFIED — production web build
- [ ] NOT VERIFIED — production API build
- [ ] NOT VERIFIED — Docker build/start/restart persistence
- [ ] NOT VERIFIED — Playwright browser smoke suite
- [ ] NOT VERIFIED — GitHub Actions CI

## Architecture

- [x] IndexedDB remains local source of truth.
- [x] API is not required for local exam/practice operations.
- [x] Repository interfaces remain between API/domain and SQLite.
- [x] No Phase 11 features added.

## Database

- [x] SQLite runtime migration is transactional.
- [x] Mutation IDs are unique.
- [x] Share codes are unique.
- [x] Tombstones are persisted server-side.
- [x] Backup/restore scripts exist.
- [ ] NOT VERIFIED — real restart persistence through the built API process.
- [ ] NOT VERIFIED — backup/restore CLI against production-shaped DB.

## Sync

- [x] Push mutation transaction boundary reviewed.
- [x] Duplicate mutation handling reviewed.
- [x] Cursor advancement occurs after local remote-apply transaction.
- [x] Single-flight client sync retained.
- [ ] NOT VERIFIED — concurrent multi-device integration suite.

## Share

- [x] Server independently validates `.exam`.
- [x] Hash/version mismatch rejected.
- [x] Expiration/deletion/owner checks retained.
- [x] Share code contains no exam content.
- [ ] NOT VERIFIED — adversarial ZIP matrix through the installed test suite.

## Offline / PWA

- [x] `/api/*` excluded from SPA navigation fallback.
- [x] No API response runtime cache configured.
- [x] Cache cleanup/versioning retained.
- [ ] NOT VERIFIED — browser offline smoke suite.

## Deployment

- [x] SQLite uses persistent Docker volume.
- [x] API healthcheck exists.
- [x] Graceful shutdown exists.
- [x] `.dockerignore` excludes secrets and local state.
- [ ] NOT VERIFIED — Docker image build/run/restart.

## Security

- [x] Zod validation retained.
- [x] Request/body limits retained.
- [x] CORS/security headers retained.
- [x] Rate limits retained.
- [x] ZIP/path/hash protections retained.
- [x] No forbidden dynamic-code patterns found.
- [ ] NOT VERIFIED — dependency vulnerability scan.

## Release gate

The project must not be called `production ready` until all critical/high verification blockers are resolved and the following commands have real results:

```text
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --filter @exam/api db:migrate
pnpm --filter @exam/api test
pnpm exec playwright test
```
