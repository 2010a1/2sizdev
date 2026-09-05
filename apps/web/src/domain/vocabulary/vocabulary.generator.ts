import type { VocabQuestion, VocabQuestionType, Vocabulary } from "@exam/shared-types";
import { normalizeEnglish, normalizeVietnamese, normalizeWhitespace } from "./vocabulary.normalizer";

export const VOCABULARY_GENERATOR_VERSION = 1;
export const VOCABULARY_QUESTION_TYPES: readonly VocabQuestionType[] = ["MC_EN_TO_VI", "TEXT_EN_TO_VI", "TEXT_VI_TO_EN", "LETTER_ORDER"];

function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (const ch of input) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let x = seed || 0x9e3779b9;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) / 4294967296);
  };
}

function deterministicShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items]; const random = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function shuffledLetters(word: string, seed: number): string[] {
  const letters = Array.from(word);
  if (letters.length <= 1 || new Set(letters.map(c => c.toLocaleLowerCase("en-US"))).size <= 1) return letters;
  let shuffled = deterministicShuffle(letters, seed);
  if (shuffled.join("") === word) {
    const rotated = [...shuffled.slice(1), shuffled[0]];
    if (rotated.join("") !== word) shuffled = rotated;
  }
  return shuffled;
}

function baseId(vocabulary: Vocabulary, type: VocabQuestionType): string {
  return `vocabq:${vocabulary.id}:${vocabulary.generation}:${type}:v${VOCABULARY_GENERATOR_VERSION}`;
}

export function generateVocabularyQuestions(vocabulary: Vocabulary, allVocabularies: Vocabulary[], now = Date.now()): VocabQuestion[] {
  const distractors = allVocabularies
    .filter(v => v.profileId === vocabulary.profileId && !v.deletedAt && v.id !== vocabulary.id)
    .map(v => normalizeVietnamese(v.vietnamese))
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);
  const seedBase = `${vocabulary.id}|${vocabulary.updatedAt}|${VOCABULARY_GENERATOR_VERSION}`;
  const questions: VocabQuestion[] = [];

  for (const type of VOCABULARY_QUESTION_TYPES) {
    const id = baseId(vocabulary, type);
    const base = { id, vocabularyId: vocabulary.id, profileId: vocabulary.profileId, type, generatorVersion: VOCABULARY_GENERATOR_VERSION, vocabularyGeneration: vocabulary.generation, createdAt: now, updatedAt: now } as const;
    if (type === "MC_EN_TO_VI") {
      const correct = normalizeVietnamese(vocabulary.vietnamese);
      const candidates = distractors.filter(v => v !== correct);
      if (candidates.length < 3) {
        questions.push({ ...base, prompt: `${vocabulary.english} nghĩa là gì?`, answer: correct, availability: "unavailable", unavailableReason: "Chưa có đủ 3 nghĩa khác nhau để tạo đáp án nhiễu." });
      } else {
        const selected = deterministicShuffle(candidates, hashSeed(`${seedBase}|${type}`)).slice(0, 3);
        questions.push({ ...base, prompt: `${vocabulary.english} nghĩa là gì?`, answer: correct, options: deterministicShuffle([correct, ...selected], hashSeed(`${seedBase}|options`)), availability: "available" });
      }
    } else if (type === "TEXT_EN_TO_VI") {
      questions.push({ ...base, prompt: `${vocabulary.english} nghĩa là gì?`, answer: normalizeVietnamese(vocabulary.vietnamese), availability: "available" });
    } else if (type === "TEXT_VI_TO_EN") {
      questions.push({ ...base, prompt: `${vocabulary.vietnamese} tiếng Anh là gì?`, answer: normalizeEnglish(vocabulary.english), availability: "available" });
    } else {
      const english = normalizeWhitespace(vocabulary.english);
      const letters = shuffledLetters(english, hashSeed(`${seedBase}|${type}`));
      questions.push({ ...base, prompt: "Sắp xếp các chữ cái thành từ tiếng Anh đúng.", answer: english, letters, availability: "available" });
    }
  }
  return questions;
}
