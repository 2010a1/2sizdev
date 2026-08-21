import { describe, expect, it } from "vitest";
import Dexie from "dexie";
import "fake-indexeddb/auto";
import { ExamDatabase, upgradeVocabularyToV3, upgradeVocabularyToV4 } from "../db/database";

it("opens Phase 6 schema at Dexie version 4 and exposes explicit migration version", async () => {
  const db = new ExamDatabase();
  expect(db.verno).toBe(4);
  db.close();
});

describe("legacy vocabulary migration contract", () => {
  it("keeps old v2 fields available for the explicit v3 upgrade path", async () => {
    const name = `exam-platform-migration-${Date.now()}`;
    const legacy = new Dexie(name);
    legacy.version(2).stores({ vocabularies: "id, profileId, word, updatedAt", vocabQuestions: "id, vocabularyId, profileId, type", vocabProgress: "id, vocabularyId, profileId, questionType" });
    await legacy.open();
    await legacy.table("vocabularies").add({ id:"v1", profileId:"p1", word:"Apple", meaning:"quả táo", createdAt:1, updatedAt:1 });
    await legacy.close();

    const upgraded = new Dexie(name);
    upgraded.version(2).stores({ vocabularies: "id, profileId, word, updatedAt", vocabQuestions: "id, vocabularyId, profileId, type", vocabProgress: "id, vocabularyId, profileId, questionType" });
    upgraded.version(3).stores({ vocabularies: "id, profileId, normalizedEnglish, normalizedVietnamese, updatedAt", vocabQuestions: "id, vocabularyId, profileId, type, vocabularyGeneration, generatorVersion, deletedAt", vocabProgress: "id, vocabularyId, profileId, questionType, vocabularyGeneration" }).upgrade(upgradeVocabularyToV3);
    await upgraded.open();
    const migrated = await upgraded.table("vocabularies").get("v1");
    expect(migrated.english).toBe("Apple");
    expect(migrated.vietnamese).toBe("quả táo");
    expect(migrated.normalizedEnglish).toBe("apple");
    expect(migrated.normalizedVietnamese).toBe("quả táo");
    expect(migrated.generation).toBe(1);
    await upgraded.close();
    await Dexie.delete(name);
  });
});

describe('Phase 6 v3 -> v4 migration', () => {
  it('preserves Phase 5 vocabulary, progress and sessions while adding set tables', async () => {
    const name = `exam-platform-v4-migration-${Date.now()}`;
    const legacy = new Dexie(name);
    legacy.version(3).stores({
      profiles:'id', vocabularies:'id, profileId, normalizedEnglish, normalizedVietnamese, updatedAt',
      vocabQuestions:'id, vocabularyId, profileId, type, vocabularyGeneration',
      vocabProgress:'id, vocabularyId, profileId, questionType, vocabularyGeneration',
      vocabSessions:'id, profileId, vocabularyId, status, startedAt', vocabSessionAnswers:'id, sessionId, questionId'
    });
    await legacy.open();
    await legacy.table('vocabularies').add({id:'v1',profileId:'p1',english:'Apple',vietnamese:'quả táo',normalizedEnglish:'apple',normalizedVietnamese:'quả táo',createdAt:1,updatedAt:1,generation:1});
    await legacy.table('vocabProgress').add({id:'v1:1:TEXT_EN_TO_VI',vocabularyId:'v1',profileId:'p1',questionType:'TEXT_EN_TO_VI',vocabularyGeneration:1,correctCount:2,wrongCount:1,attemptCount:3,currentStreak:0,bestStreak:2,mastery:67});
    await legacy.table('vocabSessions').add({id:'s1',profileId:'p1',vocabularyId:'v1',mode:'practice',questionIds:[],currentIndex:0,startedAt:1,status:'submitted',visitedQuestionIds:[],flaggedQuestionIds:[]});
    await legacy.close();
    const upgraded = new Dexie(name);
    upgraded.version(3).stores({profiles:'id',vocabularies:'id, profileId, normalizedEnglish, normalizedVietnamese, updatedAt',vocabQuestions:'id, vocabularyId, profileId, type, vocabularyGeneration',vocabProgress:'id, vocabularyId, profileId, questionType, vocabularyGeneration',vocabSessions:'id, profileId, vocabularyId, status, startedAt',vocabSessionAnswers:'id, sessionId, questionId'});
    upgraded.version(4).stores({profiles:'id',vocabularies:'id, profileId, normalizedEnglish, normalizedVietnamese, updatedAt',vocabQuestions:'id, vocabularyId, profileId, type, vocabularyGeneration',vocabProgress:'id, vocabularyId, profileId, questionType, vocabularyGeneration',vocabSessions:'id, profileId, vocabularyId, setId, status, startedAt, [profileId+setId+status]',vocabSessionAnswers:'id, sessionId, questionId',vocabularySets:'id, profileId, updatedAt, deletedAt',vocabularySetItems:'id, setId, profileId, vocabularyId, position'}).upgrade(upgradeVocabularyToV4);
    await upgraded.open();
    expect(upgraded.verno).toBe(4);
    expect((await upgraded.table('vocabularies').get('v1')).english).toBe('Apple');
    expect((await upgraded.table('vocabProgress').get('v1:1:TEXT_EN_TO_VI')).correctCount).toBe(2);
    expect((await upgraded.table('vocabSessions').get('s1')).mode).toBe('practice');
    expect(await upgraded.table('vocabularySets').count()).toBe(0);
    await upgraded.close(); await Dexie.delete(name);
  });
});
