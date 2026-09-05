# Phase 10 — Production Verification + Release Candidate

## Scope

Phase 10 is a verification/hardening pass over the Phase 9 source. Phase 1–9 architecture, Dexie migrations v1–v5, offline-first behavior and `.exam` format are preserved.

## Audit findings

### Architecture
- Web remains offline-first with IndexedDB as local source of truth.
- API persistence is SQLite through repository interfaces.
- Sync and share remain behind repository abstractions.
- `.exam` validation remains in `packages/exam-format` and is used server-side before accepting a share.
- No Phase 11 feature was introduced.

### Database
- Runtime SQLite migration is implemented in `apps/api/src/db/sqlite.ts`.
- The checked-in SQL migration mirrors the runtime schema.
- Dexie v1–v5 history was not modified.
- The existing `apps/api/prisma/schema.prisma` is not used by runtime code and is retained as legacy/non-runtime material; it should not be treated as the SQLite source of truth.

### Persistence / sync
- Mutation recording, entity update and change append execute inside the repository transaction for each mutation.
- Duplicate mutation IDs are idempotent.
- Server revisions are monotonic per entity.
- Pull cursor is committed locally only after remote changes have been applied transactionally.
- Remote application does not enqueue a reverse local mutation.

### Share
- Server independently imports/validates the `.exam` package.
- Supplied content hash and format version are compared with the validated package.
- Share codes use cryptographic randomness and do not contain exam content.
- Expiry, deletion, owner deletion protection and rate limits remain enabled.

### Offline/PWA
- Service worker excludes `/api/*` from navigation fallback.
- API responses are not runtime-cached.
- App shell remains available offline after caching.

### Deployment
- Docker API uses a persistent SQLite volume.
- Web container serves the static SPA and proxies `/api/` to the API container.
- `.dockerignore` now excludes local secrets, database files, dependencies and build/test artifacts from Docker build context.

## Bugs / corrections made in Phase 10

1. Added explicit `TRUST_PROXY` configuration so deployments behind a trusted reverse proxy can opt into correct client-IP handling without blindly trusting forwarded headers.
2. Added regression coverage for server-side share hash mismatch rejection.
3. Added regression coverage for SQLite tombstones, unique mutation IDs and deleted-share persistence after repository reopen.
4. Added `.dockerignore` to prevent accidental `.env`, database and dependency leakage into Docker build context.

## Verification status

| Area | Status | Evidence |
|---|---|---|
| Source archive integrity | PASS | `unzip -t` completed successfully |
| Static forbidden-pattern scan | PASS | no `eval()` / `new Function()` / `dangerouslySetInnerHTML` found |
| Native SQLite transaction smoke test | PASS | BEGIN/COMMIT and forced ROLLBACK verified with Node 22 `node:sqlite` |
| API TypeScript | BLOCKED | dependencies/types are not installed |
| Web TypeScript | BLOCKED | dependencies/types are not installed |
| pnpm install | BLOCKED | pnpm unavailable; Corepack registry access failed |
| pnpm test | NOT VERIFIED | dependency installation blocked |
| pnpm build | NOT VERIFIED | dependency installation blocked |
| pnpm lint | NOT VERIFIED as workspace command | lint script itself is statically inspectable |
| Playwright E2E | NOT VERIFIED | Playwright dependencies/browser unavailable |
| Docker build | NOT VERIFIED | Docker runtime/build was not available for verification |
| GitHub Actions | NOT VERIFIED | CI cannot execute locally |

## Lockfile / CI status

The archive **contains** `pnpm-lock.yaml` with `lockfileVersion: '9.0'`. The repository CI intentionally requires this lockfile and runs `pnpm install --frozen-lockfile` so dependency resolution remains reproducible.

The lockfile must not be removed or regenerated without an intentional dependency-resolution change. Full CI verification still requires a network-enabled environment where the pinned `pnpm@10.0.0` and dependencies can be installed.

## Release recommendation

**NOT RELEASE CANDIDATE / NOT PRODUCTION VERIFIED.**

The source has been audited and targeted corrections/regression tests were added, but the environment prevented dependency installation and therefore prevented full typecheck, test, build, Docker and browser E2E verification.
