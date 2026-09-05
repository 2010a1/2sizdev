# Audit fixes — 2sizdev

## Fixed from user test output
- AdminLayout navigation item union typing.
- ExamDetailPage/VocabularySetDetailPage undefined guards.
- ExamEditorPage durationFromMinutes import.
- Backup restore Dexie transaction tuple typing.
- ImportMetaEnv DEV typing and Vite duplicate declaration conflict via skipLibCheck.
- Vocabulary set detail type imports now use the domain-owned VocabularySetDetail type.
- Vocabulary scoring is case-insensitive for Vietnamese while preserving accents.
- Vocabulary generator test now validates multiset/order contract rather than requiring an unshuffled word.
- Competition order fallback no longer loses questions when persisted order is incomplete.
- Profile sync queue test updated to the current SyncQueueItem contract.
- Vite PWA plugin upgraded from 0.21.x to 1.2.0 for Vite 7 peer compatibility; lockfile updated.

## Validation performed here
- Parsed all 164 TypeScript/TSX source files with TypeScript parser: 0 parse errors.
- ZIP/source integrity: pending final packaging.

## Not falsely claimed
Full `pnpm install/typecheck/test/build/e2e` was not executable in this environment because the package manager cannot reach the npm registry. The user's provided logs are treated as the authoritative failing run; fixes were applied against those concrete errors.
