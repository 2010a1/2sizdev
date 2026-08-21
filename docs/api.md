# API

Phase 7 API is optional. The browser app remains functional without it.

## Health
`GET /api/health`

## Sync
`POST /api/sync/push`

Pushes an idempotent batch of CREATE/UPDATE/DELETE mutations identified by `mutationId` and `baseRevision`.

`GET /api/sync/pull?cursor=N&profileId=P`

Returns profile-scoped changes after cursor. Cursor advances only through the server change log; the client commits it after an atomic IndexedDB apply.

## Share
`POST /api/share`

Uploads an already-valid Phase-4 `.exam` package. The server validates the package again, generates a 6-character bearer code, and persists a named `shared-exams/<CODE>.exam` file when SQLite storage is active.

`GET /api/share/:code`

Returns the package when the code exists and is not expired/deleted.

`DELETE /api/share/:code`

Deletes the share entry in the current MVP store.

There is intentionally no authentication in Phase 7. A profile ID is a sync scope, not a security credential.
