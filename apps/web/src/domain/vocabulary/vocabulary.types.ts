import type { VocabQuestion, VocabQuestionType, VocabProgress, Vocabulary, VocabularySession, VocabularySessionAnswer } from "@exam/shared-types";

export type { VocabQuestion, VocabQuestionType, VocabProgress, Vocabulary, VocabularySession, VocabularySessionAnswer };

export interface VocabularyInput {
  english: string;
  vietnamese: string;
  pronunciation?: string;
  exampleSentence?: string;
  note?: string;
}

export interface VocabularySessionState {
  session: VocabularySession;
  questions: VocabQuestion[];
  answers: Record<string, string>;
  currentQuestionIndex: number;
}

export interface VocabularyResult {
  sessionId: string;
  correct: number;
  wrong: number;
  percentage: number;
  byType: Record<VocabQuestionType, { correct: number; total: number }>;
}
