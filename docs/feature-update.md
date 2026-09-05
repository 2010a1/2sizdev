# Exam Platform — Feature Update

## Implemented

- JSON-first Exam creation with parse/schema/semantic validation, preview and repository save.
- JSON file import in the editor.
- Gemini image-assisted prompt panel; image is user-supplied and Gemini only produces JSON.
- Exam question domain restricted to `ABCD`, `TRUE_FALSE`, `SHORT_ANSWER`.
- Legacy Phase 1–4 Exam question data is adapted at the boundary; Vocabulary models remain separate.
- Stable option IDs and `correctOptionId` semantics.
- Deterministic question/ABCD option shuffling for both Practice and Tournament, with fixed ABCD → True/False → Short Answer section order.
- Tournament session persists seed, question order and option order in the existing Attempt model.
- Tournament UI locks navigation to one question at a time; no previous/jump.
- Keyboard controls for ABCD, TRUE/FALSE and Enter with repeat protection.
- SHORT_ANSWER NFC/whitespace/case normalization and accepted answers.
- Vocabulary create/edit UI now only asks for English and Vietnamese.
- Vocabulary streak is not displayed in its UI.

## Regression coverage added

- Competition seeded randomization.
- Stable correct option identity after shuffle.
- Practice order remains unchanged.
- Keyboard mapping and Enter answer validation.
- JSON draft validation and semantic correct-option validation.
- SHORT_ANSWER normalization and accepted answers.
- Phase 3 tournament timeout/wrong-answer/recovery order behavior.
- Legacy self-answer adaptation to `SHORT_ANSWER`.

## Verification

- Direct static lint/security script: PASS.
- Static TypeScript parse check: PASS (no TS syntax/parser errors detected).
- Pure compiled feature smoke tests for deterministic shuffle and scoring: PASS.
- Pure compiled keyboard rule smoke tests: PASS.
- `pnpm typecheck`: NOT VERIFIED — Corepack cannot download pnpm because registry DNS/network access is unavailable.
- `pnpm test`: NOT VERIFIED — same dependency/bootstrap blocker.
- `pnpm build`: NOT VERIFIED — same dependency/bootstrap blocker.
- `pnpm lint`: NOT VERIFIED as a pnpm command; the underlying `node scripts/lint.mjs` passed directly.
- Playwright: NOT VERIFIED — pnpm bootstrap/dependency blocker.

The project is therefore **not claimed production-verified** in this environment.
