import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';

describe('Phase 7 Dexie v3/v4 -> v5 migration',()=>{
  it('preserves Phase 6 vocabulary, progress and session data while adding sync schema',async()=>{
    const name='exam-platform-migration-phase7';
    const old=new Dexie(name);
    old.version(4).stores({
      profiles:'id', exams:'id', questions:'id', attempts:'id', answers:'id',
      vocabularies:'id, profileId, normalizedEnglish', vocabQuestions:'id, vocabularyId, profileId', vocabProgress:'id, vocabularyId, profileId',
      vocabSessions:'id, profileId, vocabularyId, setId', vocabSessionAnswers:'id, sessionId', vocabularySets:'id, profileId', vocabularySetItems:'id, setId, profileId',
      sharedExams:'id', syncQueue:'id, profileId, type, status', syncState:'key', settings:'key', examAssets:'id, examId'
    });
    await old.open(); await old.table('vocabularies').add({id:'v1',profileId:'p1',normalizedEnglish:'apple',normalizedVietnamese:'quả táo'}); await old.table('vocabProgress').add({id:'v1:g1:MC_EN_TO_VI',vocabularyId:'v1',profileId:'p1',questionType:'MC_EN_TO_VI',vocabularyGeneration:1,correctCount:2,wrongCount:1,attemptCount:3}); await old.table('vocabSessions').add({id:'s1',profileId:'p1',vocabularyId:'v1',mode:'practice',questionIds:['q1'],currentIndex:0,startedAt:1,status:'submitted',visitedQuestionIds:[],flaggedQuestionIds:[]}); await old.close();
    const upgraded=new Dexie(name); upgraded.version(4).stores({profiles:'id', exams:'id', questions:'id', attempts:'id', answers:'id', vocabularies:'id, profileId, normalizedEnglish', vocabQuestions:'id, vocabularyId, profileId', vocabProgress:'id, vocabularyId, profileId', vocabSessions:'id, profileId, vocabularyId, setId', vocabSessionAnswers:'id, sessionId', vocabularySets:'id, profileId', vocabularySetItems:'id, setId, profileId', sharedExams:'id', syncQueue:'id, profileId, type, status', syncState:'key', settings:'key', examAssets:'id, examId'}); upgraded.version(5).stores({profiles:'id', exams:'id, deletedAt', questions:'id', attempts:'id', answers:'id', vocabularies:'id, profileId, normalizedEnglish', vocabQuestions:'id, vocabularyId, profileId', vocabProgress:'id, vocabularyId, profileId', vocabSessions:'id, profileId, vocabularyId, setId', vocabSessionAnswers:'id, sessionId', vocabularySets:'id, profileId', vocabularySetItems:'id, setId, profileId', sharedExams:'id, expiresAt', syncQueue:'id, profileId, entityType, entityId, operation, status', syncState:'key, profileId, deviceId, status, cursor', settings:'key', examAssets:'id, examId'}); await upgraded.open(); expect(await upgraded.table('vocabularies').get('v1')).toBeTruthy(); expect(await upgraded.table('vocabProgress').get('v1:g1:MC_EN_TO_VI')).toMatchObject({correctCount:2,wrongCount:1}); expect(await upgraded.table('vocabSessions').get('s1')).toBeTruthy(); await upgraded.close();

  });
});
