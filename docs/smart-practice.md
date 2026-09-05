# Smart Practice

Smart practice is deterministic and fully local.

## Selection inputs

Questions, Phase 5 progress, mode, requested count, selected question types and a seed are passed to a pure selector. Persisted session-answer history supplies wrong/unseen/recent question IDs.

## Priority

1. Wrong/recently wrong questions
2. Low mastery
3. Unseen questions
4. Questions not recently seen
5. Type coverage

The implementation also tries to avoid consecutive questions from the same vocabulary and caps a vocabulary at two selected questions while other vocabulary is available.

## Session

The selected question IDs are persisted once at session creation. Reload never reruns the selector for the active session.

Result scoring is recomputed from generated question data and persisted answers, not from a cached score field.
