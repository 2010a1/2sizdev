import Dexie, { type Table } from "dexie";
import type {
  Profile,
  ExamMetadata,
  Question,
  Attempt,
  Answer,
  Vocabulary,
  VocabProgress,
  VocabQuestionType,
  SharedExamRef,
  SyncQueueItem,
  SyncState,
  Settings,
  VocabQuestion,
  VocabularySession,
  VocabularySessionAnswer,
  VocabularySet,
  VocabularySetItem
} from "@exam/shared-types";

/**
 * IndexedDB is the frontend's source of truth (see docs/architecture.md).
 * The API is never a required dependency for the app to function — every
 * table here must be readable/writable fully offline.
 */
export interface StoredExamMetadata extends ExamMetadata { deletedAt?: number; }

export async function upgradeVocabularyToV3(tx: any): Promise<void> {
  const vocabularies = tx.table("vocabularies");
  const questions = tx.table("vocabQuestions");
  await vocabularies.toCollection().modify((row: any) => {
    const english = typeof row.english === "string" ? row.english : (row.word ?? "");
    const vietnamese = typeof row.vietnamese === "string" ? row.vietnamese : (row.meaning ?? "");
    row.english = english;
    row.vietnamese = vietnamese;
    row.word = row.word ?? english;
    row.meaning = row.meaning ?? vietnamese;
    row.normalizedEnglish = english.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    row.normalizedVietnamese = vietnamese.trim().replace(/\s+/g, " ");
    row.generation = row.generation ?? 1;
  });
  await questions.toCollection().modify((row: any) => {
    row.generatorVersion = row.generatorVersion ?? 0;
    row.vocabularyGeneration = row.vocabularyGeneration ?? 1;
    row.updatedAt = row.updatedAt ?? row.createdAt ?? Date.now();
    row.availability = row.availability ?? "available";
  });
}



export async function upgradeVocabularyToV4(tx: any): Promise<void> {
  // v4 adds set tables and optional set-session fields only; all existing
  // Phase 5 vocabulary/progress/session rows remain byte-for-byte compatible.
  // Recompute any pre-existing set word counts if a prior local beta had
  // created set rows, without touching vocabulary/progress/history.
  const sets = tx.table('vocabularySets');
  const items = tx.table('vocabularySetItems');
  const existing = await sets.toArray();
  for (const set of existing) {
    const count = await items.where('setId').equals(set.id).count();
    await sets.update(set.id, { wordCount: count, version: Number.isFinite(set.version) && set.version > 0 ? set.version : 1 });
  }
}

export class ExamDatabase extends Dexie {
  profiles!: Table<Profile, string>;
  exams!: Table<StoredExamMetadata, string>;
  questions!: Table<Question, string>;
  attempts!: Table<Attempt, string>;
  answers!: Table<Answer, string>;
  vocabularies!: Table<Vocabulary, string>;
  vocabQuestions!: Table<VocabQuestionRecord, string>;
  vocabProgress!: Table<VocabProgress, string>;
  sharedExams!: Table<SharedExamRef, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  syncState!: Table<SyncState, string>;
  settings!: Table<Settings, string>;
  vocabSessions!: Table<VocabularySessionRecord, string>;
  vocabSessionAnswers!: Table<VocabularySessionAnswerRecord, string>;
  examAssets!: Table<ExamAssetRecord, string>;
  vocabularySets!: Table<VocabularySet, string>;
  vocabularySetItems!: Table<VocabularySetItem, string>;

  constructor(name = "exam-platform") {
    super(name);

    // v1 — initial schema. This has not shipped to any real user yet, so a
    // single version is fine for now. From the first real release onward,
    // schema changes MUST be added as a NEW `.version(n)` block with
    // `.upgrade()` migrations rather than editing v1 in place — Dexie skips
    // straight to the highest version's `.stores()` for new databases but
    // walks every intermediate `.version().upgrade()` for existing ones, so
    // editing an already-deployed version in place silently corrupts
    // upgrades for users who already have a v1 database on disk.
    this.version(1).stores({
      profiles: "id, name, updatedAt, lastActiveAt",
      exams: "id, subject, grade, source, updatedAt, contentHash, isFavorite",
      questions: "id, examId, [examId+order], type",
      attempts: "id, profileId, examId, mode, status, startedAt, [profileId+status]",
      answers: "id, attemptId, questionId, [attemptId+questionId]",
      vocabularies: "id, profileId, word, updatedAt",
      vocabQuestions: "id, vocabularyId, profileId, type, [profileId+vocabularyId]",
      vocabProgress: "id, vocabularyId, profileId, questionType, nextReviewAt, [profileId+nextReviewAt]",
      sharedExams: "id, examId, code",
      syncQueue: "id, profileId, type, status, createdAt, [profileId+status]",
      syncState: "key",
      settings: "key"
    });

    this.version(2).stores({
      profiles: "id, name, updatedAt, lastActiveAt",
      exams: "id, subject, grade, source, updatedAt, contentHash, isFavorite",
      questions: "id, examId, [examId+order], type",
      attempts: "id, profileId, examId, mode, status, startedAt, [profileId+status]",
      answers: "id, attemptId, questionId, [attemptId+questionId]",
      vocabularies: "id, profileId, word, updatedAt",
      vocabQuestions: "id, vocabularyId, profileId, type, [profileId+vocabularyId]",
      vocabProgress: "id, vocabularyId, profileId, questionType, nextReviewAt, [profileId+nextReviewAt]",
      sharedExams: "id, examId, code",
      syncQueue: "id, profileId, type, status, createdAt, [profileId+status]",
      syncState: "key",
      settings: "key",
      examAssets: "id, examId, path, hash"
    });

    // v3 — Phase 5 vocabulary schema. v1/v2 are immutable historical
    // versions; all vocabulary evolution is explicit here.
    this.version(3).stores({
      profiles: "id, name, updatedAt, lastActiveAt",
      exams: "id, subject, grade, source, updatedAt, contentHash, isFavorite",
      questions: "id, examId, [examId+order], type",
      attempts: "id, profileId, examId, mode, status, startedAt, [profileId+status]",
      answers: "id, attemptId, questionId, [attemptId+questionId]",
      vocabularies: "id, profileId, normalizedEnglish, normalizedVietnamese, updatedAt, [profileId+normalizedEnglish], [profileId+normalizedVietnamese]",
      vocabQuestions: "id, vocabularyId, profileId, type, vocabularyGeneration, generatorVersion, deletedAt, [profileId+vocabularyId]",
      vocabProgress: "id, vocabularyId, profileId, questionType, vocabularyGeneration, lastAttemptAt, [profileId+vocabularyId], [profileId+vocabularyGeneration]",
      vocabSessions: "id, profileId, vocabularyId, status, startedAt, [profileId+status]",
      vocabSessionAnswers: "id, sessionId, questionId, [sessionId+questionId]",
      sharedExams: "id, examId, code",
      syncQueue: "id, profileId, type, status, createdAt, [profileId+status]",
      syncState: "key",
      settings: "key",
      examAssets: "id, examId, path, hash"
    }).upgrade(upgradeVocabularyToV3);
    // v4 — Phase 6 vocabulary sets. v1/v2/v3 remain immutable.
    this.version(4).stores({
      profiles: "id, name, updatedAt, lastActiveAt",
      exams: "id, subject, grade, source, updatedAt, contentHash, isFavorite",
      questions: "id, examId, [examId+order], type",
      attempts: "id, profileId, examId, mode, status, startedAt, [profileId+status]",
      answers: "id, attemptId, questionId, [attemptId+questionId]",
      vocabularies: "id, profileId, normalizedEnglish, normalizedVietnamese, updatedAt, [profileId+normalizedEnglish], [profileId+normalizedVietnamese]",
      vocabQuestions: "id, vocabularyId, profileId, type, vocabularyGeneration, generatorVersion, deletedAt, [profileId+vocabularyId]",
      vocabProgress: "id, vocabularyId, profileId, questionType, vocabularyGeneration, lastAttemptAt, [profileId+vocabularyId], [profileId+vocabularyGeneration]",
      vocabSessions: "id, profileId, vocabularyId, setId, status, startedAt, [profileId+status], [profileId+setId+status]",
      vocabSessionAnswers: "id, sessionId, questionId, [sessionId+questionId]",
      vocabularySets: "id, profileId, updatedAt, deletedAt, [profileId+deletedAt]",
      vocabularySetItems: "id, setId, profileId, vocabularyId, position, [setId+position], [profileId+setId]",
      sharedExams: "id, examId, code",
      syncQueue: "id, profileId, type, status, createdAt, [profileId+status]",
      syncState: "key",
      settings: "key",
      examAssets: "id, examId, path, hash"
    }).upgrade(upgradeVocabularyToV4);

    // v5 — Phase 7 offline sync/share foundation. v1-v4 are immutable.
    this.version(5).stores({
      profiles: "id, name, updatedAt, lastActiveAt",
      exams: "id, subject, grade, source, updatedAt, contentHash, isFavorite, deletedAt",
      questions: "id, examId, [examId+order], type",
      attempts: "id, profileId, examId, mode, status, startedAt, [profileId+status]",
      answers: "id, attemptId, questionId, [attemptId+questionId]",
      vocabularies: "id, profileId, normalizedEnglish, normalizedVietnamese, updatedAt, [profileId+normalizedEnglish], [profileId+normalizedVietnamese]",
      vocabQuestions: "id, vocabularyId, profileId, type, vocabularyGeneration, generatorVersion, deletedAt, [profileId+vocabularyId]",
      vocabProgress: "id, vocabularyId, profileId, questionType, vocabularyGeneration, lastAttemptAt, [profileId+vocabularyId], [profileId+vocabularyGeneration]",
      vocabSessions: "id, profileId, vocabularyId, setId, status, startedAt, [profileId+status], [profileId+setId+status]",
      vocabSessionAnswers: "id, sessionId, questionId, [sessionId+questionId]",
      vocabularySets: "id, profileId, updatedAt, deletedAt, [profileId+deletedAt]",
      vocabularySetItems: "id, setId, profileId, vocabularyId, position, [setId+position], [profileId+setId]",
      sharedExams: "id, examId, code, expiresAt",
      syncQueue: "id, profileId, entityType, entityId, operation, status, createdAt, nextRetryAt, [profileId+status], [profileId+nextRetryAt]",
      syncState: "key, profileId, deviceId, status, cursor, lastSyncAt",
      settings: "key",
      examAssets: "id, examId, path, hash"
    }).upgrade(async (tx: any) => {
      const states = tx.table("syncState");
      const existing = await states.toArray();
      for (const row of existing) {
        if (!row.profileId) await states.update(row.key, { profileId: row.key.startsWith("profile:") ? row.key.slice(8) : undefined, status: "IDLE", cursor: row.serverVersion ?? 0 });
      }
    });

    // v6 — sync queue compaction needs an indexed entity identity lookup.
    this.version(6).stores({
      profiles: "id, name, updatedAt, lastActiveAt",
      exams: "id, subject, grade, source, updatedAt, contentHash, isFavorite, deletedAt",
      questions: "id, examId, [examId+order], type",
      attempts: "id, profileId, examId, mode, status, startedAt, [profileId+status]",
      answers: "id, attemptId, questionId, [attemptId+questionId]",
      vocabularies: "id, profileId, normalizedEnglish, normalizedVietnamese, updatedAt, [profileId+normalizedEnglish], [profileId+normalizedVietnamese]",
      vocabQuestions: "id, vocabularyId, profileId, type, vocabularyGeneration, generatorVersion, deletedAt, [profileId+vocabularyId]",
      vocabProgress: "id, vocabularyId, profileId, questionType, vocabularyGeneration, lastAttemptAt, [profileId+vocabularyId], [profileId+vocabularyGeneration]",
      vocabSessions: "id, profileId, vocabularyId, setId, status, startedAt, [profileId+status], [profileId+setId+status]",
      vocabSessionAnswers: "id, sessionId, questionId, [sessionId+questionId]",
      vocabularySets: "id, profileId, updatedAt, deletedAt, [profileId+deletedAt]",
      vocabularySetItems: "id, setId, profileId, vocabularyId, position, [setId+position], [profileId+setId]",
      sharedExams: "id, examId, code, expiresAt",
      syncQueue: "id, profileId, entityType, entityId, operation, status, createdAt, nextRetryAt, [profileId+status], [profileId+nextRetryAt], [profileId+entityType+entityId+status]",
      syncState: "key, profileId, deviceId, status, cursor, lastSyncAt",
      settings: "key",
      examAssets: "id, examId, path, hash"
    });

    // v7 — bind local sync queue/state to the authenticated account so a
    // queue created while User A was offline can never be replayed as User B.
    this.version(7).stores({
      profiles: "id, name, updatedAt, lastActiveAt",
      exams: "id, subject, grade, source, updatedAt, contentHash, isFavorite, deletedAt",
      questions: "id, examId, [examId+order], type",
      attempts: "id, profileId, examId, mode, status, startedAt, [profileId+status]",
      answers: "id, attemptId, questionId, [attemptId+questionId]",
      vocabularies: "id, profileId, normalizedEnglish, normalizedVietnamese, updatedAt, [profileId+normalizedEnglish], [profileId+normalizedVietnamese]",
      vocabQuestions: "id, vocabularyId, profileId, type, vocabularyGeneration, generatorVersion, deletedAt, [profileId+vocabularyId]",
      vocabProgress: "id, vocabularyId, profileId, questionType, vocabularyGeneration, lastAttemptAt, [profileId+vocabularyId], [profileId+vocabularyGeneration]",
      vocabSessions: "id, profileId, vocabularyId, setId, status, startedAt, [profileId+status], [profileId+setId+status]",
      vocabSessionAnswers: "id, sessionId, questionId, [sessionId+questionId]",
      vocabularySets: "id, profileId, updatedAt, deletedAt, [profileId+deletedAt]",
      vocabularySetItems: "id, setId, profileId, vocabularyId, position, [setId+position], [profileId+setId]",
      sharedExams: "id, examId, code, expiresAt",
      syncQueue: "id, profileId, accountId, entityType, entityId, operation, status, createdAt, nextRetryAt, [profileId+status], [profileId+nextRetryAt], [profileId+entityType+entityId+status]",
      syncState: "key, profileId, accountId, deviceId, status, cursor, lastSyncAt",
      settings: "key",
      examAssets: "id, examId, path, hash"
    });
  }
}

/**
 * A generated vocabulary question, cached so the same quiz instance is
 * stable across re-renders/reloads instead of re-randomized every time.
 */
export interface ExamAssetRecord {
  id: string;
  examId: string;
  path: string;
  data: Uint8Array;
  mimeType?: string;
  hash: string;
}

export type VocabQuestionRecord = VocabQuestion;
export type VocabularySessionRecord = VocabularySession;
export type VocabularySessionAnswerRecord = VocabularySessionAnswer;

export const db = new ExamDatabase();
