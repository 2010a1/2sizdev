import type { VocabQuestion } from "@exam/shared-types";
import { normalizeEnglish, normalizeVietnamese, normalizeWhitespace } from "./vocabulary.normalizer";

export function scoreVocabularyAnswer(question: VocabQuestion, answer: string): boolean {
  if (question.availability !== "available") return false;
  if (question.type === "MC_EN_TO_VI") return normalizeVietnamese(answer) === normalizeVietnamese(question.answer);
  if (question.type === "TEXT_EN_TO_VI") return normalizeVietnamese(answer) === normalizeVietnamese(question.answer);
  if (question.type === "TEXT_VI_TO_EN") return normalizeEnglish(answer) === normalizeEnglish(question.answer);
  return normalizeEnglish(answer) === normalizeEnglish(question.answer);
}
