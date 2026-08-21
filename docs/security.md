# Security

## Threat model
This application intentionally has no mandatory authentication. `profileId` and `deviceId` are identifiers only and must never be treated as credentials. Local IndexedDB is considered user-controlled and potentially corrupt.

## Server controls
- Strict Zod request schemas.
- JSON/body limits and request timeouts.
- CORS allow-list.
- Security response headers.
- Sanitized production errors.
- Per-IP request/share lookup rate limits.
- Cryptographically generated share codes.
- `.exam` packages are validated server-side independently of the client.
- ZIP path, compressed/uncompressed size, asset-count and asset-size limits come from the shared exam-format validator.
- Share deletion requires the owner device identifier when one was supplied at creation.

## Privacy
Do not log profile content, vocabulary text, exam answers, private package contents, or secrets. Logs should contain only operation/entity/error metadata. The server error handler intentionally returns generic production messages.

## Known residual risks
- No authentication/authorization model exists by design.
- Memory storage is not durable or multi-instance safe; production should use SQLite on persistent storage.
- Share codes are bearer credentials and intentionally rate-limited, not a replacement for authentication.
- Rate limits are process-local and therefore reset on restart and are not shared between replicas.

## Phase 11 production hardening
- Server-side accounts use `scrypt` password hashes and opaque HttpOnly sessions.
- USER/ADMIN authorization is enforced by Fastify endpoints; frontend role state is presentation only.
- Login failure cooldown, register/share/sync/activity/download rate limits and security events are enabled.
- Security events retain IP, user-agent, account, endpoint and result without password/session secrets.
- Official exams are server-controlled, versioned by stable exam id, validated with the existing `.exam` importer and soft-unpublished for destructive admin actions.
- Local official downloads are marked read-only and do not enter the user sync queue.
- SQLite migration `0003_auth_admin` adds auth, sessions, security events, activity aggregates and official exam persistence without resetting existing data.
