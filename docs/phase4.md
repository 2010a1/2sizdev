# Phase 4 — `.exam` Format 2.0

## Scope

Phase 4 adds a framework-independent `.exam` ZIP exchange format, local import/export, validation, SHA-256 integrity, asset packaging, migration hooks, and atomic IndexedDB import. No backend, sync, share API, QR, vocabulary, multiplayer, or leaderboard work is included.

## Package

```text
exam.exam
├── manifest.json
├── exam.json
└── assets/
    └── ...
```

No runtime/signature files are emitted.

### `manifest.json`

`format = "exam"`, `formatVersion = 1`, non-empty `examId/title`, non-negative `version/questionCount`, SHA-256 `contentHash`, ISO timestamps, and canonical `assets[]` paths.

### `exam.json`

Contains only portable exam content. It does not contain profile, attempt, answer history, favorite state, sync metadata, or React state. Duration is seconds. `contentHash` is the hash of the same content with `contentHash` removed.

Question `imageAssetId`, when used, is the portable asset path (for example `assets/image-001.webp`).

## Hash

SHA-256 over deterministic UTF-8 JSON with recursively sorted object keys. Array order is preserved, so question order changes the hash. Asset binary is not included in `contentHash`; each imported asset also receives a computed SHA-256 value in local storage.

## Security

Import rejects malformed ZIPs, unknown runtime entries, path traversal, absolute/Windows paths, null bytes, duplicate normalized paths, undeclared assets, missing assets, oversized ZIP/JSON/assets, excessive asset count, malformed schemas, future format versions, and hash mismatches.

Limits:

- ZIP: 25 MB
- Total uncompressed: 100 MB
- Single asset: 10 MB
- Assets: 200
- `manifest.json`: 1 MB
- `exam.json`: 5 MB

Validation completes before IndexedDB writes.

## Migration

`CURRENT_EXAM_FORMAT_VERSION = 1`. Version 1 is the first format version, so there are currently **no historical migrations** and no fabricated v0 fixture. The migration framework is intentionally ready for explicit future transitions such as `V1 → V2` and `V2 → V3`.

The API is explicit: `migrateExamContent(content, fromVersion)`. Current v1 content is returned unchanged. A future version is rejected with `UNSUPPORTED_VERSION` before import. An unsupported old version has no migration path and returns `MIGRATION_FAILED`. When a future format version is introduced, each transition must be implemented explicitly (for example `migrateV1ToV2`).

## Import/export architecture

```text
UI
 ↓
ExamFileService
 ↓
@exam/exam-format
 ↓
ExamImportMapper / ExamExportMapper
 ↓
ExamService / Repository
 ↓
Dexie
```

`@exam/exam-format` does not import React, Dexie, ExamService, or ExamRepository.

Export returns a `Blob`/bytes. UI owns the browser download action. Import first creates a preview; only confirmation writes to IndexedDB. Duplicate IDs never overwrite an existing exam; the user can import as a local copy.

## Database

Dexie version 2 adds `examAssets`:

- `id`
- `examId`
- `path`
- `data`
- `mimeType?`
- `hash`

Existing v1 schema is untouched. Import writes exam, questions, and assets in one Dexie transaction, so a failed question/asset cannot leave a partial import.

## Source policy

Manual imports are always stored as `source = local`, even if the file's content declares `official` or `shared`. This prevents a file from granting official/shared edit permissions merely by editing JSON.

## UI

- Library: `Import .exam`
- Import: file selection → validation → preview → confirmation → IndexedDB
- Exam Detail: `Export .exam`
- Export filename: sanitized `<safe-title>.exam`

## Phase 4 verification

The repository currently has no installed `node_modules`/pnpm environment in the execution sandbox. Static TypeScript checking was attempted, but dependency resolution fails for React, Dexie, Vitest, Zod, and workspace packages. Therefore tests and production build are not claimed as passing. The new format tests and golden ZIP fixtures are included for execution in a dependency-complete environment.
