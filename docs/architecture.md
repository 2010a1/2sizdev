# Technical Architecture

## Core principle

IndexedDB is the client source of truth. The HTTP API is optional infrastructure for Phase 7 sync/share and never a prerequisite for local study.

## Offline flow

1. PWA shell loads from Service Worker cache.
2. UI reads local data from IndexedDB through repositories/services.
3. Local mutations enqueue sync records in IndexedDB.
4. When connectivity/API availability returns, SyncEngine batches and pushes mutations.
5. Remote changes are pulled by cursor and applied in one IndexedDB transaction.
6. UI continues to render from IndexedDB throughout.

## Layering

`React → Controller → Domain Service → Repository → IndexedDB`

Sync/share HTTP is infrastructure only. UI and pure engines do not call `fetch()`.

## Practice / Tournament

Phase 3 engines remain pure and timestamp-driven. Attempts and answers remain local history.

## Vocabulary / Sets

Phase 5–6 vocabulary, generated questions, progress, sets and smart practice remain local. Phase 7 syncs definition/set content only; active engine state is not synchronized.

## `.exam` / Sharing

Phase 4 `.exam` remains the only exam package format:
- `manifest.json`
- `exam.json`
- `assets/*`

Phase 7 share uploads the validated package, generates a bearer share code, and returns the same package to recipients. Recipient import always re-runs the Phase 4 validation/hash/asset pipeline. Attempts, answers, profiles and sync state are never part of the package.
