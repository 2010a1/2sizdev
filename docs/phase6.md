# Phase 6 — Vocabulary Sets + Smart Practice

Phase 6 extends the Phase 5 offline vocabulary model without replacing it.
IndexedDB remains the source of truth; React is presentation/session orchestration.

## Architecture

`React UI → Controller → Domain Service → Repository → Dexie/IndexedDB`

Pure domain modules:
- `vocabulary.smart-selection.ts`
- existing vocabulary scoring/generator
- existing vocabulary practice engine
- set statistics/mastery aggregation

No smart-selection, scoring, generator or engine module accesses Dexie or React.

## Database v4

Phase 6 adds:
- `vocabularySets`
- `vocabularySetItems`

Phase 5 `vocabularies`, `vocabQuestions`, `vocabProgress`, `vocabSessions` and `vocabSessionAnswers` are reused.

v1, v2 and v3 are immutable. v4 has an explicit upgrade callback. Existing vocabulary, progress and sessions remain readable.

## Set model

A set contains relations, not copied vocabulary data. A vocabulary can belong to multiple sets.
Deleting a set soft-deletes the set and abandons only its active sessions. Vocabulary, generated questions, progress and history remain.
Deleting vocabulary keeps the set item safe; the deleted word is omitted from active set detail but historical session question records remain readable.

## Smart selection

Modes:
- ALL
- WEAK
- WRONG
- NEW
- CUSTOM

Selection excludes unavailable questions, applies question-type filters and requested count, and is deterministic for the same inputs and seed. The selector never uses `Math.random()`.

Wrong/new selection uses persisted session-answer history when available; weak selection uses Phase 5 progress/mastery. Selection limits consecutive questions from the same vocabulary when alternatives exist.

## Practice recovery

Set practice reuses `VocabularyPracticeEngine` and `vocabSessions`/`vocabSessionAnswers`. The persisted session contains setId, selected question IDs/order, mode, selected types, requested count, seed, current index, answers, visited/flagged state and timestamps.

Reload reconstructs the same engine from IndexedDB. It does not regenerate or reshuffle the active session.

## Mastery

Set mastery is derived from Phase 5 vocabulary progress. No second mastery counter is stored. Learned/weak/wrong/new counts are derived from the set's active vocabulary IDs and their progress.

## Known limitations

- Phase 6 does not add a spaced-repetition scheduler or timer; review priority is local heuristic selection.
- A deleted vocabulary is hidden from active set detail, while historical generated questions remain available for result reconstruction.
- There is no online sync, backend, AI, dictionary API, sharing or leaderboard.
