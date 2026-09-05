# Testing

## Commands
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm lint`

## Matrix
### Unit
Exam format, migrations, vocabulary, smart selection, practice, tournament, sync, conflict resolution, share validation.

### Integration
IndexedDB repositories, import transactions, sync push/pull, API validation, share create/get/delete.

### Adversarial
Malformed JSON/ZIP, path traversal, ZIP bomb limits, duplicate assets, invalid hash, future format, corrupted local data, duplicate mutation, stale revision, conflicting update, deleted entity resurrection, expired/invalid shares, oversized bodies and repeated requests.

### E2E
The Phase 7 archive does not contain Playwright. E2E smoke coverage is therefore documented as **NOT VERIFIED** in this environment rather than being reported as PASS.

## Verification rule
Never report PASS when a command was not actually run. Use PASS, FAIL, NOT RUN, or BLOCKED.
