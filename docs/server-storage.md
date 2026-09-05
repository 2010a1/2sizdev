# Server storage

Phase 8 keeps the repository abstraction and uses SQLite as the production adapter by default.

## Current adapters
- `SqliteServerRepository`
- `SqliteSyncRepository`
- `SqliteShareRepository`
- Memory adapters remain available for tests.

## Shared exam storage
A shared exam continues to use the existing Phase 4 `.exam` package. When SQLite storage is active, each new share is also materialized as:

```text
shared-exams/<CODE>.exam
```

The code is generated server-side and validated before it is ever used as a filename. The SQLite row stores the metadata and a compatibility copy of the package. Reads prefer the named `.exam` file and fall back to the database copy if an older deployment does not have the file.

## Railway persistence
The API must have a persistent Railway Volume mounted at `/data` when using the default SQLite configuration, for example:

```text
DATABASE_URL=file:/data/exam-platform.db
SHARED_EXAMS_DIR=/data/shared-exams
STORAGE_DRIVER=sqlite
```

Without a persistent volume, SQLite and the `shared-exams` files can be lost on redeploy/restart. The application does not silently switch to another external database or object store.

## Railway deployment safety

This project uses SQLite, so the database is persistent **only when the Railway
service has a Volume attached**. The deployment entrypoint now fails fast when
running on Railway without a Volume instead of silently creating `/data` on the
ephemeral container filesystem.

Recommended Railway setup:

- Create/keep one Railway Volume attached to the **same web service**.
- Mount it at `/data` (the application also honors Railway's
  `RAILWAY_VOLUME_MOUNT_PATH`).
- Do not delete/wipe the Volume when redeploying.
- The application stores the SQLite database at `/data/exam-platform.db` and
  shared exam packages under `/data/shared-exams/`.
- Railway Volume backups should be enabled where available.

A code redeploy replaces the container, not the attached Volume. Railway's
Volumes are specifically designed to persist data across deploys and restarts.
