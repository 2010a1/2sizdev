export interface Profile { id:string; name:string; avatar?:string; createdAt:number; updatedAt:number; lastActiveAt:number; }
export type ExamSource = "official" | "shared" | "local" | "vocabulary";
export interface ExamMetadata { id:string; title:string; description?:string; subject:string; grade?:number; duration?:number; questionCount:number; source:ExamSource; version:number; contentHash:string; createdAt:number; updatedAt:number; downloadedAt?:number; isFavorite?:boolean; }

export type QuestionType = "ABCD" | "TRUE_FALSE" | "SHORT_ANSWER";
export interface QuestionOption { id:string; text:string; imageUrl?:string; }
export interface BaseQuestion { id:string; examId:string; order:number; content:string; imageUrl?:string; explanation?:string; }
export interface ABCDQuestion extends BaseQuestion { type:"ABCD"; options:QuestionOption[]; answer:string; }
export interface TrueFalseQuestion extends BaseQuestion { type:"TRUE_FALSE"; answer:boolean; }
export interface ShortAnswerQuestion extends BaseQuestion { type:"SHORT_ANSWER"; answer:string; acceptedAnswers?:string[]; caseSensitive?:boolean; }
export type Question = ABCDQuestion | TrueFalseQuestion | ShortAnswerQuestion;

export type QuizMode = "practice" | "tournament";
export type AttemptStatus = "in_progress" | "submitted" | "completed" | "failed" | "won" | "lost" | "timeout" | "abandoned";
export interface Attempt { id:string; profileId:string; examId:string; mode:QuizMode; status:AttemptStatus; score:number; correctCount:number; wrongCount:number; skippedCount:number; startedAt:number; finishedAt?:number; duration?:number; streak:number; bestStreak:number; currentQuestionIndex?:number; visitedQuestionIds?:string[]; flaggedQuestionIds?:string[]; questionEnteredAt?:number; seed?:string; questionOrder?:string[]; optionOrderByQuestion?:Record<string,string[]>; }
export interface Answer { id:string; attemptId:string; questionId:string; answer:unknown; correct:boolean; answeredAt:number; timeSpent:number; }
export interface SharedExamRef { id:string; examId:string; code:string; expiresAt?:number; importedAt:number; }

export interface Vocabulary { id:string; profileId:string; english:string; vietnamese:string; normalizedEnglish:string; normalizedVietnamese:string; pronunciation?:string; exampleSentence?:string; note?:string; createdAt:number; updatedAt:number; generation:number; deletedAt?:number; word?:string; meaning?:string; }
export type VocabQuestionType = "MC_EN_TO_VI" | "TEXT_EN_TO_VI" | "TEXT_VI_TO_EN" | "LETTER_ORDER";
export interface VocabQuestion { id:string; vocabularyId:string; profileId:string; type:VocabQuestionType; prompt:string; answer:string; options?:string[]; letters?:string[]; availability:"available"|"unavailable"; unavailableReason?:string; generatorVersion:number; vocabularyGeneration:number; createdAt:number; updatedAt:number; deletedAt?:number; }
export interface VocabProgress { id:string; vocabularyId:string; profileId:string; questionType:VocabQuestionType; vocabularyGeneration:number; correctCount:number; wrongCount:number; attemptCount:number; currentStreak:number; bestStreak:number; mastery:number; lastAttemptAt?:number; lastCorrectAt?:number; lastWrongAt?:number; }
export type VocabularySessionStatus = "in_progress"|"submitted"|"abandoned";
export interface VocabularySession { id:string; profileId:string; vocabularyId:string; setId?:string; mode:"practice"|"quick_review"|"set_practice"; questionIds:string[]; selectedQuestionIds?:string[]; selectedQuestionTypes?:VocabQuestionType[]; requestedCount?:number|"all"; seed?:string; currentIndex:number; startedAt:number; finishedAt?:number; status:VocabularySessionStatus; visitedQuestionIds:string[]; flaggedQuestionIds:string[]; questionEnteredAt?:number; }
export interface VocabularySet { id:string; profileId:string; name:string; description?:string; createdAt:number; updatedAt:number; deletedAt?:number; wordCount:number; version:number; }
export interface VocabularySetItem { id:string; setId:string; profileId:string; vocabularyId:string; position:number; createdAt:number; updatedAt:number; }
export interface VocabularySessionAnswer { id:string; sessionId:string; questionId:string; answer:string; correct:boolean; answeredAt:number; timeSpent:number; }
export type LegacyVocabQuestionType = "en_to_vi"|"vi_to_en"|"write_en"|"write_vi"|"unscramble";

export type SyncEntityType = 'exam'|'question'|'examAsset'|'vocabulary'|'vocabQuestion'|'vocabularySet'|'vocabularySetItem'|'legacy';
export type SyncMutationOperation = 'CREATE'|'UPDATE'|'DELETE';
export type SyncStatus = 'IDLE'|'SYNCING'|'OFFLINE'|'ERROR';
export interface SyncMutationDto { mutationId:string; profileId:string; deviceId:string; entityType:SyncEntityType; entityId:string; operation:SyncMutationOperation; baseRevision:number; updatedAt:number; payload?:unknown; }
export interface SyncChangeDto { cursor:number; entityType:SyncEntityType; entityId:string; profileId:string; revision:number; operation:SyncMutationOperation; payload?:unknown; updatedAt:number; deviceId:string; deletedAt?:number; }
export interface SyncPushResponse { acknowledgements:string[]; conflicts:Array<{mutationId:string; entityType:SyncEntityType; entityId:string; current:SyncChangeDto}>; serverCursor:number; }
export interface SyncPullResponse { changes:SyncChangeDto[]; cursor:number; hasMore:boolean; }
export interface SyncQueueItem { id:string; mutationId:string; profileId:string; accountId?:string; entityType:SyncEntityType; entityId:string; operation:SyncMutationOperation; baseRevision:number; payload?:unknown; status:'pending'|'failed'; attempts:number; retryCount:number; lastError?:string; nextRetryAt?:number; createdAt:number; updatedAt:number; }
export interface SyncState { key:string; profileId?:string; accountId?:string; deviceId?:string; status:SyncStatus; cursor?:number; lastSyncAt?:number; lastError?:string; }


