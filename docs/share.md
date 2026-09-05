# `.exam` Share

Sharing reuses the Phase 4 `.exam` format; there is no second exam package format.

## Flow
1. Export the existing exam as `.exam`.
2. Validate the package locally.
3. POST the validated package to `/api/share`.
4. The server generates a 6-character bearer code such as `A7K92X`.
5. SQLite metadata and `shared-exams/A7K92X.exam` are persisted on the server.
6. A recipient enters the code or opens `/share/A7K92X`.
7. The server returns the package.
8. The client reruns the complete Phase 4 import/hash/asset validation pipeline.
9. The recipient imports a copy into IndexedDB with source `shared`.

Codes are case-insensitive and accept only the human-enterable alphabet `A-HJ-NP-Z2-9`. Path-like input is never used as a filesystem path.

Expiry options remain 24h, 7d (default), or never.
