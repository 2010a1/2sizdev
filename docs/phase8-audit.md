# Phase 8 Audit

## Audit method
The Phase 7 archive was unpacked and inventoried before changes. The audit covered the root workspace manifests, all TypeScript/TSX/JS sources under `apps/web`, `apps/api`, and `packages`, all existing docs, the Dexie database schema/migrations v1–v5, the `.exam` format implementation, Phase 7 sync/share code, tests and deployment files. The archive contains 126 relevant source/config/document files.

## Architecture
- `apps/web`: React 19 + React Router + Vite/PWA.
- Local source of truth: Dexie/IndexedDB in `apps/web/src/db/database.ts`.
- Domain services/controllers: exam, practice, tournament, vocabulary, profile.
- Sync: local mutation queue + `SyncEngine` + API transport + remote apply.
- Share: `.exam` export/import + API share endpoints.
- `packages/exam-format`: JSZip package format, hashing, size/path validation and migration entry points.
- `packages/schemas`: shared Zod validation.
- `packages/shared-types`: DTO/domain types.
- `packages/utils`: IDs, shuffle and utility functions.
- `apps/api`: Fastify API. Phase 7 stored server entities, mutations and shares in process memory.
- `apps/api/prisma/schema.prisma` exists, but Phase 7 runtime does not use Prisma for persistence.

## Dependency graph
```text
apps/web
 ├─ @exam/exam-format ──> @exam/schemas
 ├─ @exam/shared-types
 ├─ @exam/utils
 ├─ @exam/schemas
 └─ Dexie / React / Router / Vite PWA

apps/api
 ├─ @exam/exam-format ──> @exam/schemas
 ├─ @exam/shared-types
 └─ Fastify / CORS / Zod / Node crypto

packages
 └─ shared packages are consumed by both web and api
```

## Data flow
### Offline
UI -> domain service -> Dexie transaction -> local UI state. Exam assets and exam data stay in IndexedDB rather than service-worker API caches.

### Sync
Local mutation -> `syncQueue` -> single `SyncEngine` -> `/api/sync/push` -> server revision/change log -> `/api/sync/pull` -> remote apply transaction -> local state/cursor.

### Share
Local exam -> `.exam` export -> client validation -> `POST /api/share` -> server independently imports/validates `.exam` -> generated code -> GET -> client independently imports/validates -> preview/import.

## Original production blockers found
1. Root scripts lacked `test` and `lint`; package build/typecheck coverage was incomplete.
2. No pnpm lockfile was present in the archive.
3. PWA configuration had no explicit cache version and referenced icon/assets that were absent.
4. API used permissive `CORS origin: true`, a 40 MB body limit, no explicit request timeout, no security headers, and no generic error handler.
5. API storage was in-memory and embedded in the route module.
6. Share GET had rate limiting, but share creation and general API requests did not have a shared server-side limit.
7. Share deletion was addressable by share code alone; it did not use the owner device identifier even when one was recorded.
8. `SyncEngine` used a process-global boolean and returned `SYNCING` to a concurrent caller rather than sharing the active promise.
9. `generateId` contained a `Math.random()` legacy fallback.
10. The service worker correctly denied `/api/*` navigation fallback, but cache/update strategy was not explicitly versioned.
11. Graceful shutdown was not implemented.
12. Production documentation and environment example were incomplete.

## Existing strengths preserved
- Dexie v1–v5 were explicit historical migrations. Phase 8 does not edit those migration blocks.
- `.exam` format already had strong limits: package size, total uncompressed bytes, per-asset size, asset count, canonical paths, CRC validation, duplicate paths, declared assets and content hashing.
- Server-side share creation already re-imported `.exam`, preventing client-only validation.
- Phase 7 sync already had mutation IDs, revisions, retry/backoff and tombstone concepts.
- Existing Phase 1–7 tests remain in place.

## Migration risks
- Changing old Dexie version blocks would risk real-user upgrade corruption; no old block was modified.
- v5 sync-state upgrade assumes historical keys can map to `profile:<id>`; Phase 8 leaves that migration untouched.
- `.exam` format remains version 1. Future format versions are rejected rather than silently interpreted.

## Sync risks
- Concurrent calls could overlap conceptually because the old guard was not a shared promise.
- A failed push must retain queue items and backoff state.
- Pull cursor must only advance after remote changes are applied.
- Conflict resolution must not resurrect deleted entities.
- Process restart still loses server-side state because storage is memory-only.

## Share/security risks
- Short human-readable codes can be brute-forced; server-side per-IP rate limiting is therefore required but is not a cryptographic authorization mechanism.
- Package validation must remain server-side.
- ZIP path traversal/ZIP bomb protections are implemented in the shared format package.
- Public sharing intentionally has no authentication; this is a product constraint, not a credential boundary.

## Privacy/observability
- `profileId` and `deviceId` are identifiers, not credentials.
- Logs must never include answer content, vocabulary content, profile content or package payloads.
- Phase 8 adds a sanitized logger abstraction on the web and sanitized API errors.

## Test gaps
- No Playwright dependency/config was present, so browser E2E cannot be honestly reported as verified.
- The archive has strong domain/format/Phase 7 tests, but adversarial API and migration coverage was not exhaustive before Phase 8.
- Environment constraints prevented dependency installation and real pnpm execution in this audit environment.

## Deployment blockers after hardening
- A pnpm lockfile remains absent because the archive had none and this environment could not download pnpm from the npm registry.
- The final pnpm command suite is therefore `BLOCKED` in this environment, not falsely marked PASS.
- Durable multi-instance server storage remains a deliberate limitation.

## Phase boundary
No AI, dictionary API, leaderboard, multiplayer, teacher/admin, mandatory authentication, payment or advanced spaced repetition was introduced.
