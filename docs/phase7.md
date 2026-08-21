# Phase 7 — Offline Sync + Share `.exam`

## Scope
Phase 7 adds an optional HTTP synchronization layer and `.exam` sharing. IndexedDB remains the UI source of truth. The API is never required for local study, exam creation, vocabulary, practice, tournament, or local import/export.

## Architecture
`React → Controller → Domain Service → Repository → IndexedDB`

Sync is infrastructure-only:
`IndexedDB queue ↔ SyncEngine ↔ HTTP transport ↔ API repository`

UI never calls `fetch()` directly.

## Database
Phase 7 adds Dexie **v5** only. v1-v4 are immutable. v5 adds indexes/fields for the existing sync queue/state and preserves existing rows. No database reset.

## Queue
New mutations contain `mutationId`, `profileId`, `entityType`, `entityId`, `operation`, `baseRevision`, payload, timestamps and retry state. CREATE/UPDATE/DELETE are supported for exams, questions, assets, vocabulary, sets and set items. Legacy Phase-1 queue records remain readable but are not treated as Phase-7 mutations.

## Cursor and revision
The server is the revision authority. Pull is cursor based. A cursor advances only after a complete IndexedDB transaction applies the returned changes.

## Conflict policy
The server rejects stale base revisions as a conflict and compares `(updatedAt, deviceId)` deterministically. The winner is explicit, not an implicit last-write-wins timestamp-only rule. A local winner is retried against the server revision; a remote winner is applied locally. Deletes are tombstones with revision/updatedAt and are not silently resurrected.

This is an MVP no-auth sync: `profileId` is a synchronization scope, not a security credential.

## Retry
Backoff: 1s, 2s, 5s, 10s, 30s, 60s, 5m. Failed requests leave queue items intact. Startup, `online`, `focus` and `visibilitychange` trigger sync attempts. Tight-loop retries are avoided.

## Share lifecycle
`Exam → Phase-4 .exam export → POST /api/share → share code → GET /api/share/:code → Phase-4 validation/preview → explicit import`.

Default expiry is 7 days. The server validates ZIP/package limits and delegates format/hash validation to the existing `@exam/exam-format` pipeline. Shared imports use `source = shared`. Attempts, answers, profiles and sync state are not part of `.exam`.

## QR
QR contains only the share URL (`/share/<code>`), never the exam package. The web UI uses `qrcode.react` for rendering.

## Offline behavior
When the API is unavailable, local writes continue and mutations accumulate in IndexedDB. Share creation is the one Phase-7 feature that requires a server; local `.exam` export/import remains available offline.

## Server storage
The repository abstraction now has a SQLite production adapter. With a persistent filesystem/volume, share metadata and `shared-exams/<CODE>.exam` survive API restarts; memory remains the test adapter.

## Security limitations
There is no authentication. Share codes are bearer capabilities and should not be treated as identity. Production deployment should add authentication, persistent storage, rate limiting, TLS and stronger abuse controls before exposing the service publicly.
