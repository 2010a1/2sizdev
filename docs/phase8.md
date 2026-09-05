# Phase 8 — Production Hardening

## Scope
Phase 8 hardens the existing Phase 1–7 offline-first platform without adding Phase 9 business features.

## Implemented
- Production build scripts and explicit root commands: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint`.
- PWA cache version `exam-platform-v8`, outdated cache cleanup, safe app-shell navigation fallback, and no API runtime caching.
- Real public PWA assets for manifest/icon precaching.
- Secure random ID generation and server-side cryptographic share-code generation.
- Single-flight SyncEngine to prevent concurrent sync runs.
- API body/request limits, strict validation, CORS allow-list, security headers, sanitized errors, and rate limiting.
- ServerRepository, SyncRepository, ShareRepository interfaces with SQLite production adapters and memory test adapters.
- Graceful SIGTERM/SIGINT shutdown.
- `.env.example` and deployment/security/offline/testing documentation.
- Static security/lint scan.

## Deliberate limitations
- Authentication is not introduced. `profileId` and `deviceId` are identifiers, not credentials.
- SQLite persistence is used in production; restart/redeploy durability depends on the deployment volume. A Railway Volume mounted at `/data` is required for durable single-instance state.
- A pnpm lockfile was not fabricated because the source archive did not contain one and this environment cannot download pnpm/dependencies.
