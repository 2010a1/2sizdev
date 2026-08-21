import type { VocabQuestion, VocabQuestionType, VocabProgress, Vocabulary, VocabularySet, VocabularySetItem } from '@exam/shared-types';

export type VocabularySetMode = 'ALL' | 'WEAK' | 'WRONG' | 'NEW' | 'CUSTOM';
export type RequestedQuestionCount = number | 'all';

export interface VocabularySetInput { name: string; description?: string; }
export interface VocabularySetDetail { set: VocabularySet; items: VocabularySetItem[]; vocabularies: Vocabulary[]; }
export interface SmartSelectionInput {
  questions: VocabQuestion[];
  progress: VocabProgress[];
  mode: VocabularySetMode;
  requestedCount: RequestedQuestionCount;
  questionTypes: VocabQuestionType[];
  seed: string;
  wrongQuestionIds?: Set<string>;
  attemptedQuestionIds?: Set<string>;
  recentQuestionIds?: Set<string>;
}
