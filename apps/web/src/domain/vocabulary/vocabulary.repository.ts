import { db, type VocabQuestionRecord, type VocabularySessionRecord, type VocabularySessionAnswerRecord } from "../../db/database";
import type { VocabProgress, Vocabulary } from "@exam/shared-types";

export const vocabularyRepository = {
  async create(v: Vocabulary) { await db.vocabularies.add(v); },
  async get(profileId: string, id: string) { const v = await db.vocabularies.get(id); return v?.profileId === profileId ? v : undefined; },
  async list(profileId: string) { return db.vocabularies.where("profileId").equals(profileId).toArray().then(rows => rows.filter(v => !v.deletedAt).sort((a,b)=>b.updatedAt-a.updatedAt)); },
  async search(profileId: string, query: string) { const rows = await this.list(profileId); const englishQuery=query.toLocaleLowerCase("en-US"); return rows.filter(v => v.normalizedEnglish.includes(englishQuery) || v.normalizedVietnamese.includes(query)); },
  async update(profileId: string, id: string, patch: Partial<Vocabulary>) { const v = await this.get(profileId,id); if (!v) return false; await db.vocabularies.update(id, patch); return true; },
  async softDelete(profileId: string, id: string) {
    const v = await this.get(profileId,id); if (!v) return false;
    const now=Date.now();
    await db.transaction("rw", [db.vocabularies, db.vocabQuestions, db.vocabSessions], async () => {
      await db.vocabularies.update(id,{deletedAt:now,updatedAt:now});
      await db.vocabQuestions.where("vocabularyId").equals(id).modify({deletedAt:now,updatedAt:now});
      await db.vocabSessions.where("vocabularyId").equals(id).and(s=>s.status === "in_progress").modify({status:"abandoned",finishedAt:now});
    });
    return true;
  },
  async all(profileId: string) { return db.vocabularies.where("profileId").equals(profileId).toArray(); },
  async questions(profileId: string, vocabularyId: string, includeDeleted = false) { const rows = await db.vocabQuestions.where("[profileId+vocabularyId]").equals([profileId,vocabularyId]).toArray(); return rows.filter(q=>includeDeleted || !q.deletedAt).sort((a,b)=>a.type.localeCompare(b.type)); },
  async createWithQuestions(v: Vocabulary, questions: VocabQuestionRecord[], progress: VocabProgress[]) {
    await db.transaction("rw", [db.vocabularies, db.vocabQuestions, db.vocabProgress], async () => {
      await db.vocabularies.add(v);
      if (questions.length) await db.vocabQuestions.bulkAdd(questions);
      if (progress.length) await db.vocabProgress.bulkAdd(progress);
    });
  },
  async updateDefinition(v: Vocabulary, oldGeneration: number, questions: VocabQuestionRecord[], progress: VocabProgress[], now: number) {
    await db.transaction("rw", [db.vocabularies, db.vocabQuestions, db.vocabProgress], async () => {
      await db.vocabularies.put(v);
      await db.vocabQuestions.where("vocabularyId").equals(v.id).and(q=>q.vocabularyGeneration===oldGeneration && !q.deletedAt).modify({deletedAt:now,updatedAt:now});
      if (questions.length) await db.vocabQuestions.bulkAdd(questions);
      if (progress.length) await db.vocabProgress.bulkAdd(progress);
    });
  },
  async putQuestions(questions: VocabQuestionRecord[]) { if (questions.length) await db.vocabQuestions.bulkPut(questions); },
  async softDeleteQuestions(vocabularyId: string, generation: number, now: number) { await db.vocabQuestions.where("vocabularyId").equals(vocabularyId).and(q=>q.vocabularyGeneration===generation && !q.deletedAt).modify({deletedAt:now,updatedAt:now}); },
  async getProgress(profileId:string,vocabularyId:string,generation:number) { const rows=await db.vocabProgress.where("[profileId+vocabularyId]").equals([profileId,vocabularyId]).toArray(); return rows.filter(p=>p.vocabularyGeneration===generation); },
  async getProgressType(profileId:string,vocabularyId:string,generation:number,type:string) { return db.vocabProgress.get(`${vocabularyId}:${generation}:${type}`); },
  async saveProgress(progress: VocabProgress) { await db.vocabProgress.put(progress); },
  async createSession(session: VocabularySessionRecord) { await db.vocabSessions.add(session); },
  async getSession(profileId:string,id:string) { const s=await db.vocabSessions.get(id); return s?.profileId===profileId?s:undefined; },
  async findActiveSession(profileId:string,vocabularyId:string,mode:"practice"|"quick_review") { const rows=await db.vocabSessions.where("[profileId+status]").equals([profileId,"in_progress"]).toArray(); return rows.filter(s=>s.vocabularyId===vocabularyId&&s.mode===mode).sort((a,b)=>b.startedAt-a.startedAt)[0]; },
  async updateSession(id:string,patch:Partial<VocabularySessionRecord>) { await db.vocabSessions.update(id,patch); },
  async latestFinishedSession(profileId:string,vocabularyId:string) { const rows=await db.vocabSessions.where("vocabularyId").equals(vocabularyId).toArray(); return rows.filter(s=>s.profileId===profileId&&s.status==="submitted").sort((a,b)=>(b.finishedAt??0)-(a.finishedAt??0))[0]; },
  async saveSessionAnswer(answer:VocabularySessionAnswerRecord) { await db.vocabSessionAnswers.put(answer); },
  async getSessionAnswers(sessionId:string) { return db.vocabSessionAnswers.where("sessionId").equals(sessionId).toArray(); },
  async deleteSessionAnswers(sessionId:string) { await db.vocabSessionAnswers.where("sessionId").equals(sessionId).delete(); }
};
