# Exam JSON First

Exam creation now uses a user-facing JSON draft. The only supported Exam question types are `ABCD`, `TRUE_FALSE`, and `SHORT_ANSWER`.

Flow:

`JSON -> parse -> Zod schema -> semantic validation -> preview -> repository/IndexedDB`

Invalid JSON or invalid semantic data is rejected before any database write.

## Draft rules

- ABCD has exactly four options and a stable `correctOptionId`.
- TRUE_FALSE stores `correctAnswer: boolean`.
- SHORT_ANSWER stores `correctAnswers` and uses normalized text comparison.
- Runtime state such as profile, attempts, answers/history, sync state, React state and UI state is not part of the draft.
- `needsReview`/`reviewNote` may be produced by an image-to-JSON workflow when an answer cannot be established confidently. Save is blocked until review is resolved.

## Gemini workflow

Attach the exam image to Gemini, copy the generated prompt from the Create Exam screen, and paste Gemini's JSON into the editor. Gemini never writes to the repository directly.

## Competition randomization

Only Tournament/THI ĐẤU uses deterministic seeded shuffling. The attempt persists:

- `seed`
- `questionOrder`
- `optionOrderByQuestion`

The stored correct answer remains an option ID, never a UI position.
