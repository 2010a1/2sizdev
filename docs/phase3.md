# Phase 3 — Practice + Tournament + Attempt + Scoring

Implemented offline-first Practice and Tournament flows on top of Phase 2.

## Architecture

React UI → Practice/Tournament Controller → Engine → AttemptService → ExamRepository → Dexie

Engines contain no React or IndexedDB imports and operate from supplied data/timestamps.

## Practice

- Free navigation: previous, next, jump to any question.
- Answer changes persist immediately.
- Visited and flagged question state persists.
- Submit confirmation for unanswered questions.
- Timestamp-based timer and automatic timeout.
- Score, percentage, correct/wrong/unanswered and duration.
- Result review with user answer, correct answer and explanation.

## Tournament

- One question at a time.
- No navigator, skip or back navigation.
- Correct answer advances and increases streak.
- Wrong answer ends the attempt immediately.
- Final correct answer produces `won`.
- Timestamp-based timeout produces `timeout`.
- Best streak and percentage are persisted.

## Recovery and history

- Active attempt lookup by profile + exam + mode.
- Continue or abandon-and-start-new flow.
- Current question, answers, streak, flags and timer timestamps survive reload.
- Profile page contains local attempt history.
- Exam soft-delete does not delete attempt history.

## Verification

The environment does not contain the workspace dependencies or pnpm. A real `pnpm typecheck`, test run and production build therefore cannot be truthfully reported as passing.

A TypeScript static invocation was attempted with the globally available compiler. It reached the source but reported the expected missing dependency/module errors (`react`, `react-router-dom`, Dexie, Vitest, workspace packages, etc.). No Phase 3 engine/controller-specific type error remained after fixing the one actionable controller return-type issue found during this pass.


## Phase 3 hardening contract

- `duration` is seconds in domain, IndexedDB, and `.exam`/API data. UI inputs are minutes and use `durationFromMinutes()` / `durationToMinutes()`.
- `AttemptService.createAttempt()` always creates a new attempt. `resumeAttempt()` only discovers the latest active attempt.
- Practice/Tournament controllers only dispatch UI-facing commands to their services; services own engine reconstruction and persistence.
- `Answer.correct` is denormalized cache data. Final scoring recomputes correctness from questions + answers.
- Active question timestamps are persisted as `Attempt.questionEnteredAt`; `Answer.timeSpent` is stored in seconds.
- Expiration is checked on mount, focus, visibility changes, and timer refresh.
