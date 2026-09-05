/** Backwards-compatible facade for the old Phase-1/2 import path. */
export { vocabularyService } from "../domain/vocabulary/vocabulary.service";
export { generateVocabularyQuestions, VOCABULARY_GENERATOR_VERSION, VOCABULARY_QUESTION_TYPES } from "../domain/vocabulary/vocabulary.generator";
export { scoreVocabularyAnswer } from "../domain/vocabulary/vocabulary.scoring";
export { normalizeEnglish, normalizeVietnamese, normalizeWhitespace } from "../domain/vocabulary/vocabulary.normalizer";
