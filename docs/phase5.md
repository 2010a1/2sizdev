# Phase 5 — Vocabulary / Từ vựng

## Architecture

`React UI → Controller → Domain Service → Repository → Dexie/IndexedDB`.

Vocabulary engine, generator and scoring are pure TypeScript and do not import React or access IndexedDB. IndexedDB is the source of truth; UI state is presentation/session state only.

## Data model

Phase 1/2 already had `vocabularies`, `vocabQuestions`, and `vocabProgress`. Phase 5 reuses those tables and adds only the minimum fields plus `vocabSessions` and `vocabSessionAnswers` for durable vocabulary-session recovery. Dexie v1 and v2 are immutable; v3 is the explicit Phase 5 migration.

Vocabulary stores normalized English/Vietnamese, generation, optional pronunciation/example/note and soft-delete state. Generated questions store generator version, vocabulary generation, availability and deterministic content. Progress is keyed by vocabulary generation + question type so editing a definition starts fresh progress without rewriting old progress/history.

## Four generated types

Exactly four records are generated for each vocabulary:

1. `MC_EN_TO_VI`
2. `TEXT_EN_TO_VI`
3. `TEXT_VI_TO_EN`
4. `LETTER_ORDER`

The MC record is retained with `availability=unavailable` when there are fewer than three distinct local distractor meanings. No fake meanings are invented.

## Deterministic generation

`VOCABULARY_GENERATOR_VERSION = 1`. A deterministic FNV/xorshift seed is derived from vocabulary id, updatedAt and generator version. Options and letters therefore do not change across renders/reloads. No `Math.random()` is used by Phase 5 generation.

Changing a vocabulary increments `generation`, soft-deletes the previous generated question set and creates a new set. Historical session/question records remain readable.

## Normalization / scoring

English comparison is case-insensitive and whitespace-normalized. Vietnamese comparison preserves accents and only normalizes Unicode form/whitespace. Letter ordering compares Unicode code points after whitespace normalization and preserves duplicate letters.

## Persistence / recovery

Creating a vocabulary and its four generated questions/progress rows is one transaction. Practice sessions persist question order, current index, visited/flagged state, answers and timestamps. Reload reconstructs the engine from IndexedDB. Session order is persisted, not regenerated on render.

`timeSpent` is stored in seconds and calculated from `questionEnteredAt` to answer time. No interval is used as a source of truth.

## Profile isolation

Every repository read/write receives `profileId` and verifies ownership. A profile cannot read, update or delete another profile's vocabulary.

## Delete semantics

Vocabulary deletion is a soft delete. Active generated questions are soft-deleted and active sessions are abandoned. Progress and completed sessions/answers remain for historical consistency, so there are no broken result references.

## Migration

Dexie v3 upgrades legacy vocabulary rows from `word/meaning` into `english/vietnamese` and adds normalized values/generation metadata. Existing Phase 1–4 tables and version blocks are not edited.

## Limitations

- No backend/API/AI/dictionary lookup.
- No spaced-repetition algorithm; mastery is a simple correct-rate metric.
- Vocabulary “set” management is intentionally limited to one vocabulary item per practice session in this phase.
- MC availability depends entirely on local vocabulary meanings.
