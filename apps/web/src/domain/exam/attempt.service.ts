import { generateId, nowTs } from '@exam/utils';
import { examRepository } from './exam.repository';
import type { Answer, AnswerValue, Attempt, Question } from './exam.types';
import { AttemptNotFoundError, InvalidAttemptStateError } from './exam.errors';
import { isAnswerCorrect } from './answer.scoring';

export const attemptService = {
  async createAttempt(profileId: string, examId: string, mode: 'practice' | 'tournament', startedAt = nowTs(), sessionPatch: Partial<Attempt> = {}): Promise<Attempt> {
    const attempt: Attempt = {
      id: generateId('attempt'), profileId, examId, mode, status: 'in_progress', score: 0,
      correctCount: 0, wrongCount: 0, skippedCount: 0, startedAt, streak: 0, bestStreak: 0,
      currentQuestionIndex: 0, visitedQuestionIds: [], flaggedQuestionIds: [], questionEnteredAt: startedAt, ...sessionPatch
    };
    await examRepository.createAttempt(attempt); return attempt;
  },
  async saveAnswer(attemptId: string, questionId: string, answer: AnswerValue, _correct: boolean, timeSpent = 0) {
    const attempt = await this.getAttempt(attemptId);
    if (attempt.status !== 'in_progress') throw new InvalidAttemptStateError('Bài làm đã kết thúc.');
    const question = await examRepository.getQuestionsByExam(attempt.examId).then(qs => qs.find((q: Question) => q.id === questionId));
    if (!question) throw new InvalidAttemptStateError("Không thể lưu đáp án cho câu hỏi không tồn tại.");
    // The incoming flag is only a denormalized cache hint; never trust it.
    const verifiedCorrect = isAnswerCorrect(question, answer);
    if (!Number.isFinite(timeSpent) || Number.isNaN(timeSpent) || timeSpent < 0) throw new InvalidAttemptStateError("Thời gian trả lời không hợp lệ.");
    const record: Answer = { id: `${attemptId}:${questionId}`, attemptId, questionId, answer, correct: verifiedCorrect, answeredAt: nowTs(), timeSpent: Math.floor(timeSpent) };
    await examRepository.saveAnswer(record); return record;
  },
  async getAttempt(id: string) { const attempt = await examRepository.getAttempt(id); if (!attempt) throw new AttemptNotFoundError(); return attempt as Attempt; },
  async getAnswers(attemptId: string): Promise<Answer[]> { return (await examRepository.getAnswers(attemptId)) as Answer[]; },
  async resumeAttempt(profileId: string, examId: string, mode: 'practice' | 'tournament') { return examRepository.findActiveAttempt(profileId, examId, mode) as Promise<Attempt | undefined>; },
  async persistState(id: string, patch: Partial<Attempt>) { await this.getAttempt(id); await examRepository.updateAttempt(id, patch); },
  async abandonAttempt(id: string) { await this.persistState(id, { status: 'abandoned', finishedAt: nowTs() }); }
};
