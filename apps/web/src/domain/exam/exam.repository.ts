import { db } from '../../db/database';
import type { Attempt, Answer, Exam, Question, StoredQuestionRecord } from './exam.types';
import { mapQuestionToStored, mapStoredQuestion } from './exam.mapper';
import type { ExamAssetRecord } from '../../db/database';

export const examRepository = {
  async createExam(exam: Exam) { await db.exams.add(exam); },
  async getExam(id: string) { return db.exams.get(id) as Promise<Exam | undefined>; },
  async listExams(includeDeleted = false) {
    const rows = await db.exams.orderBy('updatedAt').reverse().toArray() as Exam[];
    return includeDeleted ? rows : rows.filter(e => !e.deletedAt);
  },
  async updateExam(id: string, patch: Partial<Exam>) { await db.exams.update(id, patch); },
  async deleteExam(id: string) {
    const questions = await db.questions.where('examId').equals(id).toArray();
    const assets = await db.examAssets.where('examId').equals(id).toArray();
    await db.transaction('rw', [db.exams, db.questions, db.examAssets, db.sharedExams], async () => {
      await db.exams.update(id, { deletedAt: Date.now() });
      await db.questions.where('examId').equals(id).delete();
      await db.examAssets.where('examId').equals(id).delete();
      await db.sharedExams.where('examId').equals(id).delete();
    });
    return { questions, assets };
  },
  async duplicateExam(id: string, exam: Exam, questions: Question[]) {
    await db.transaction('rw', [db.exams, db.questions], async () => {
      await db.exams.add(exam);
      await db.questions.bulkAdd(questions.map(mapQuestionToStored));
    });
  },
  async favoriteExam(id: string, value: boolean) { await db.exams.update(id, { isFavorite: value }); },
  async getQuestion(id: string) { const row = await db.questions.get(id); return row ? mapStoredQuestion(row) : undefined; },
  async addQuestion(question: Question) { await db.questions.add(mapQuestionToStored(question)); },
  async updateQuestion(id: string, question: Question) { await db.questions.put(mapQuestionToStored(question)); },
  async deleteQuestion(id: string) { await db.questions.delete(id); },
  async reorderQuestions(examId: string, orderedIds: string[]) {
    const qs = await this.getQuestionsByExam(examId);
    const byId = new Map(qs.map(q => [q.id, q]));
    await db.transaction('rw', db.questions, async () => {
      await db.questions.bulkPut(orderedIds.map((id, order) => mapQuestionToStored({ ...byId.get(id)!, order } as Question)));
    });
  },
  async getAssetsByExam(examId: string) { return db.examAssets.where('examId').equals(examId).toArray(); },
  async replaceAssets(examId: string, assets: ExamAssetRecord[]) {
    await db.transaction('rw', [db.examAssets], async () => {
      await db.examAssets.where('examId').equals(examId).delete();
      if (assets.length) await db.examAssets.bulkAdd(assets);
    });
  },
  async replaceExamAtomic(exam: Exam, questions: Question[], assets: ExamAssetRecord[]) {
    await db.transaction('rw', [db.exams, db.questions, db.examAssets], async () => {
      await db.questions.where('examId').equals(exam.id).delete();
      await db.examAssets.where('examId').equals(exam.id).delete();
      await db.exams.put(exam);
      if (questions.length) await db.questions.bulkAdd(questions.map(mapQuestionToStored));
      if (assets.length) await db.examAssets.bulkAdd(assets);
    });
  },
  async importExamAtomic(exam: Exam, questions: Question[], assets: ExamAssetRecord[]) {
    await db.transaction('rw', [db.exams, db.questions, db.examAssets], async () => {
      await db.exams.add(exam);
      if (questions.length) await db.questions.bulkAdd(questions.map(mapQuestionToStored));
      if (assets.length) await db.examAssets.bulkAdd(assets);
    });
  },
  async getQuestionsByExam(examId: string) {
    const rows = await db.questions.where('examId').equals(examId).sortBy('order');
    return rows.map(mapStoredQuestion).filter((q): q is Question => !!q);
  },
  async createAttempt(attempt: Attempt) { await db.attempts.add(attempt); },
  async getAttempt(id: string) { return db.attempts.get(id); },
  async updateAttempt(id: string, patch: Partial<Attempt>) { await db.attempts.update(id, patch); },
  async saveAnswer(answer: Answer) { await db.answers.put({ ...answer, answer: answer.answer } as never); },
  async getAnswers(attemptId: string) { return db.answers.where('attemptId').equals(attemptId).toArray(); },
  async listAttempts(profileId: string) { const rows = await db.attempts.where('profileId').equals(profileId).toArray(); return rows.sort((a, b) => b.startedAt - a.startedAt); },
  async findActiveAttempt(profileId: string, examId: string, mode: 'practice'|'tournament') {
    const rows = await db.attempts.where('[profileId+status]').equals([profileId, 'in_progress']).toArray();
    return rows.filter(a => a.examId === examId && a.mode === mode).sort((a, b) => b.startedAt - a.startedAt)[0];
  }
};
