# Exam Platform

Offline-first exam platform built with React/Vite/PWA, IndexedDB/Dexie and a Fastify API.

## Prerequisites
- Node.js 22+
- pnpm 10.x

## Commands
```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm lint
```

`pnpm lint` runs the dependency-free Phase 8 static security/lint scan.

## Production
### Web / Railway
`pnpm build` outputs `apps/web/dist`. For a separate static web host, set `VITE_API_URL` to the public API origin at build time.

The repository also contains a root `Dockerfile` for a simple single-service Railway deployment. It runs Fastify + nginx in one container, proxies `/api/*` to Fastify, and avoids the common `HTTP_405` failure caused by sending POST requests to a static nginx SPA.

For the split Docker deployment, `Dockerfile.web` proxies `/api/*` to `API_UPSTREAM` (default `http://api:3000` in Docker Compose).

### API
```bash
node apps/api/dist/server.js
```

Environment variables are documented in `.env.example`.

The API exposes `GET /api/health` for health checks and handles SIGTERM/SIGINT gracefully.

## Offline behavior
IndexedDB is the source of truth for exam/vocabulary data. The service worker precaches the app shell and static assets only; API responses and mutations are not runtime-cached. After the shell is cached, application routes remain navigable offline.

Offline mutations stay in the local sync queue and are retried after reconnect. A server failure must not delete local data.

## Server storage limitation
Phase 7 uses in-memory server storage behind `ServerRepository`, `SyncRepository`, and `ShareRepository`. A restart or redeploy loses share/sync state and multiple API instances do not share state. This is explicitly documented and is **not** claimed as durable production persistence.

## Security
- Server independently validates `.exam` packages.
- ZIP path traversal, asset count/size, total uncompressed size and package-size limits are enforced.
- Share codes use cryptographic randomness and share lookups are rate-limited.
- CORS is allow-list based.
- API body/request limits and sanitized errors are enabled.
- No secrets are committed; use `.env` locally and `.env.example` as the template.

## Scope
Phase 8 is production hardening + deployment only. No AI, dictionary, leaderboard, multiplayer, teacher/admin, mandatory authentication, payment or advanced spaced repetition features were added.

## Phase 9 production persistence

The API uses SQLite by default for persistent sync/share state. Configure `DATABASE_URL` and `STORAGE_DRIVER=sqlite`.

### Commands

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm --filter @exam/api db:migrate
pnpm --filter @exam/api db:backup ./backups/exam-platform.db
pnpm --filter @exam/api db:restore ./backups/exam-platform.db
pnpm e2e
pnpm start:api
```

### Docker

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

SQLite is mounted at `/data/exam-platform.db` in the API container. The web container serves the production SPA and proxies `/api/` to the API. The Compose web port is `80 -> 8080`.

### CI

GitHub Actions runs install, typecheck, lint, tests, SQLite migration smoke test, build and Playwright E2E. The workflow intentionally requires a committed `pnpm-lock.yaml`; this Phase 9 archive does not fabricate one when the source archive did not contain it.

## Phase 10 release verification

See `docs/phase10.md` and `docs/release-checklist.md` for the production verification status and release gate. Do not treat the project as production-ready until the listed verification commands have real PASS results.

## Exam creation (JSON First)

Official Exam creation uses the JSON editor in **Tạo đề mới**. The flow is parse → schema validation → semantic validation → preview → repository. Invalid JSON never reaches IndexedDB/API.

Supported Exam question types are only `ABCD`, `TRUE_FALSE`, and `SHORT_ANSWER`.

For Gemini-assisted creation, attach the source exam image, copy the built-in Gemini prompt, review the returned JSON, then validate/preview/import it through the same editor. Gemini has no direct database write path.

Tournament mode persists a deterministic seed, question order, and ABCD option order so reloads reproduce the same session. Practice mode keeps its existing ordering behavior.

## In-app Wiki

Ứng dụng có Knowledge Base tại `/wiki`, bao gồm hướng dẫn sử dụng, offline-first, sync, share code cho đề/bộ từ và Railway deployment. Trung tâm nhận/chia sẻ nội dung nằm tại `/share`.

## Authentication and administration
Authentication is server-side and uses opaque HttpOnly sessions. Passwords are hashed with Node.js `scryptSync`; plaintext passwords are never persisted or returned. Set `ADMIN_INITIAL_USERNAME` and `ADMIN_INITIAL_PASSWORD` only as deployment/initialization environment variables. The initial admin is seeded once and the database stores only the hash.

Admin routes: `/admin`, `/admin/users`, `/admin/exams`, `/admin/security`. Official exams use the existing `.exam` package format, are versioned by the same exam id, and are soft-unpublished on destructive admin removal. Downloaded official exams remain local/offline and are not sent back through the user sync queue.

Security events, activity aggregates, account restrictions and sessions are stored in the existing SQLite database via a forward migration (`0003_auth_admin`). Security logs are retained for 90 days by cleanup.

## Account & security hardening

The current production-hardening layer keeps the existing offline-first/Dexie/sync architecture and adds:

- server-side USER/ADMIN authorization with opaque HttpOnly sessions;
- optional email login/registration, password change/reset, temporary-password enforcement;
- ACTIVE/SUSPENDED/BANNED/DELETED/LOCKED/LIMITED account states;
- admin user management, force logout, security events, alerts and audit logs;
- feature flags enforced by backend routes as well as frontend UI;
- real API/database/storage health checks;
- backend rate limits and aggregated high-severity Discord webhook alerts;
- Official Exam JSON/.exam import with schema/hash validation and stable ID/versioning;
- local JSON backup/restore that deliberately excludes sync queue/state to avoid replaying stale mutations.

Security webhook configuration is server-only:

```env
DISCORD_SECURITY_WEBHOOK_URL=
```

Never commit the webhook URL or the initial admin password. `.env.example` contains placeholders only.
