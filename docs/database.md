# Phase 9 Database

Production storage is SQLite through `SqliteServerRepository`, `SqliteSyncRepository`, and `SqliteShareRepository`. Domain/UI code remains independent of SQLite.

## Configuration

`STORAGE_DRIVER=sqlite` is the production default. `STORAGE_DRIVER=memory` is intended for tests/dev only. `DATABASE_URL=file:./data/exam-platform.db` selects the database file. `SHARED_EXAMS_DIR` controls where named shared `.exam` files are materialized.

The API fails at startup when the configured SQLite database cannot be opened; it never silently falls back to memory.

## Schema

The database stores server entities, sync changes, mutation IDs, share records, and devices. Primary/unique indexes protect entity identity, mutation idempotency and share-code uniqueness.

## Migrations

Runtime migrations are tracked in `_migrations` and are transactionally applied by `apps/api/src/db/sqlite.ts`. The canonical SQL is also kept under `apps/api/prisma/migrations/0001_initial_sqlite/migration.sql` for review and release auditing. Dexie v1–v5 migrations are client-side and untouched.

## Atomic sync

A push mutation is executed inside one SQLite `BEGIN IMMEDIATE` transaction. Mutation-id insertion, entity update, and change append commit together or roll back together.
