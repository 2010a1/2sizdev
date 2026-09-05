import { examRepository } from "../exam/exam.repository";
import { examService } from "../exam/exam.service";
import { attemptService } from "../exam/attempt.service";
import type { AnswerValue, Attempt, Question } from "../exam/exam.types";
import { InvalidAttemptStateError, TimeExpiredError } from "../exam/exam.errors";
import { AttemptEngine, PRACTICE_CONFIG } from "../attempt/attempt.engine";
import type { AttemptEngineConfig } from "../attempt/attempt.types";
import { calculatePracticeScore, isAnswerCorrect } from "./practice.scoring";
import type { PracticeResult, PracticeSession, PracticeState } from "./practice.types";

function answersMap(records: Awaited<ReturnType<typeof attemptService.getAnswers>>): Record<string, AnswerValue> {
  return Object.fromEntries(records.map(record => [record.questionId, record.answer]));
}

function practiceConfig(duration: number | undefined): AttemptEngineConfig {
  return { ...PRACTICE_CONFIG, timed: duration !== undefined };
}

async function ensurePracticeOrder(attempt: Attempt, rawQuestions: Question[]): Promise<Attempt> {
  const questionOrder = rawQuestions.map(q => q.id);
  const optionOrderByQuestion = Object.fromEntries(rawQuestions.filter(q => q.type === "ABCD").map(q => [q.id, q.options.map(o => o.id)]));
  const sameQuestionOrder = attempt.questionOrder?.length === questionOrder.length && attempt.questionOrder.every((id, i) => id === questionOrder[i]);
  const sameOptionOrder = rawQuestions.filter(q => q.type === "ABCD").every(q => {
    const saved = attempt.optionOrderByQuestion?.[q.id];
    return Array.isArray(saved) && saved.length === q.options.length && saved.every((id, i) => id === q.options[i].id);
  });
  if (!sameQuestionOrder || !sameOptionOrder) {
    await attemptService.persistState(attempt.id, { questionOrder, optionOrderByQuestion });
    return { ...attempt, questionOrder, optionOrderByQuestion };
  }
  return attempt;
}

function orderedQuestions(rawQuestions: Question[], attempt: Attempt): Question[] {
  const byId = new Map(rawQuestions.map(q => [q.id, q]));
  const ordered = (attempt.questionOrder ?? rawQuestions.map(q => q.id)).map(id => byId.get(id)).filter((q): q is Question => !!q);
  return ordered.length === rawQuestions.length ? ordered : [...rawQuestions].sort((a,b) => a.order-b.order);
}

async function buildSession(attempt: Attempt, now = Date.now()): Promise<PracticeSession> {
  const exam = await examService.getExam(attempt.examId);
  const rawQuestions = await examRepository.getQuestionsByExam(exam.id);
  const currentId = rawQuestions[attempt.currentQuestionIndex ?? 0]?.id;
  attempt = await ensurePracticeOrder(attempt, rawQuestions);
  const questions = orderedQuestions(rawQuestions, attempt);
  const currentQuestionIndex = currentId ? Math.max(0, questions.findIndex(q => q.id === currentId)) : (attempt.currentQuestionIndex ?? 0);
  const records = await attemptService.getAnswers(attempt.id);
  const state = new AttemptEngine(questions, {
    startedAt: attempt.startedAt,
    currentQuestionIndex,
    answers: answersMap(records),
    visitedQuestions: attempt.visitedQuestionIds,
    flaggedQuestions: attempt.flaggedQuestionIds,
    questionEnteredAt: attempt.questionEnteredAt,
    status: attempt.status === "submitted" ? "submitted" : attempt.status === "abandoned" ? "abandoned" : "in_progress",
    finishedAt: attempt.finishedAt
  }, practiceConfig(exam.duration), exam.duration).getState(now);
  return { attempt, questions, state };
}

async function activeSession(profileId: string, examId: string, now = Date.now()): Promise<PracticeSession | undefined> {
  const attempt = await attemptService.resumeAttempt(profileId, examId, "practice");
  return attempt ? buildSession(attempt, now) : undefined;
}

async function persistState(attemptId: string, state: PracticeState, extra: Partial<Attempt> = {}) {
  await attemptService.persistState(attemptId, {
    currentQuestionIndex: state.currentQuestionIndex,
    visitedQuestionIds: state.visitedQuestions,
    flaggedQuestionIds: state.flaggedQuestions,
    questionEnteredAt: state.questionEnteredAt,
    ...extra
  });
  return state;
}

function practiceResultFrom(questions: Question[], state: PracticeState): PracticeResult {
  return calculatePracticeScore(questions, state.answers, state.startedAt, state.finishedAt ?? Date.now());
}

export const practiceService = {
  async resume(profileId: string, examId: string, now = Date.now()): Promise<PracticeSession | undefined> {
    return activeSession(profileId, examId, now);
  },

  async abandon(attemptId: string) { await attemptService.abandonAttempt(attemptId); },
  async create(profileId: string, examId: string, startedAt = Date.now()): Promise<PracticeSession> {
    const rawQuestions = await examRepository.getQuestionsByExam(examId);
    if (rawQuestions.length === 0) throw new Error("Đề chưa có câu hỏi.");
    const questionOrder = rawQuestions.map(q => q.id);
    const optionOrderByQuestion = Object.fromEntries(rawQuestions.filter(q => q.type === "ABCD").map(q => [q.id, q.options.map(o => o.id)]));
    const attempt = await attemptService.createAttempt(profileId, examId, "practice", startedAt, { questionOrder, optionOrderByQuestion });
    return buildSession(attempt, startedAt);
  },

  async answer(attemptId: string, answer: AnswerValue, now = Date.now()) {
    const { exam, questions, engine } = await loadCommandContext(attemptId, now);
    await ensureNotExpired(attemptId, engine, questions, now);
    const question = engine.getCurrentQuestion();
    if (!question) throw new Error("Không có câu hỏi hiện tại.");
    const timeSpent = engine.currentQuestionTimeSpent(now);
    engine.answerCurrent(answer, now);
    const correct = isAnswerCorrect(question, answer);
    await attemptService.saveAnswer(attemptId, question.id, answer, correct, timeSpent);
    const state = engine.getState(now);
    await persistState(attemptId, state);
    return { state, expired: false };
  },

  async next(attemptId: string, now = Date.now()) { return navigate(attemptId, "next", undefined, now); },
  async previous(attemptId: string, now = Date.now()) { return navigate(attemptId, "previous", undefined, now); },
  async jump(attemptId: string, index: number, now = Date.now()) { return navigate(attemptId, "jump", index, now); },
  async toggleFlag(attemptId: string, questionId: string, now = Date.now()) {
    const { attempt, exam, questions, engine } = await loadCommandContext(attemptId, now);
    await ensureNotExpired(attempt.id, engine, questions, now);
    engine.toggleFlag(questionId);
    return persistState(attemptId, engine.getState(now));
  },

  async submit(attemptId: string, now = Date.now()): Promise<PracticeResult> {
    const { questions, engine } = await loadCommandContext(attemptId, now);
    if (engine.isExpired(now)) engine.timeout(now); else engine.submit(now);
    const state = engine.getState(now);
    const result = practiceResultFrom(questions, state);
    await persistState(attemptId, state, {
      status: "submitted", finishedAt: result.finishedAt, duration: result.duration,
      score: result.score, correctCount: result.correctQuestions, wrongCount: result.wrongQuestions,
      skippedCount: result.unansweredQuestions
    });
    return result;
  },

  async checkExpiration(attemptId: string, now = Date.now()): Promise<PracticeResult | undefined> {
    const attempt = await attemptService.getAttempt(attemptId);
    if (attempt.status !== "in_progress") return undefined;
    const exam = await examService.getExam(attempt.examId);
    if (exam.duration === undefined) return undefined;
    const elapsed = Math.max(0, Math.floor((now - attempt.startedAt) / 1000));
    if (elapsed < exam.duration) return undefined;
    return this.submit(attemptId, now);
  },

  async result(attemptId: string): Promise<PracticeResult> {
    const attempt = await attemptService.getAttempt(attemptId);
    const exam = await examService.getExam(attempt.examId);
    const questions = await examRepository.getQuestionsByExam(exam.id);
    const answers = answersMap(await attemptService.getAnswers(attemptId));
    return calculatePracticeScore(questions, answers, attempt.startedAt, attempt.finishedAt ?? Date.now());
  },

  async examDuration(attemptId: string): Promise<number | undefined> {
    const attempt = await attemptService.getAttempt(attemptId);
    return (await examService.getExam(attempt.examId)).duration;
  }
};

async function loadCommandContext(attemptId: string, now: number) {
  const attempt = await attemptService.getAttempt(attemptId);
  if (attempt.status !== "in_progress") throw new InvalidAttemptStateError("Bài làm đã kết thúc.");
  const exam = await examService.getExam(attempt.examId);
  const rawQuestions = await examRepository.getQuestionsByExam(exam.id);
  const currentId = rawQuestions[attempt.currentQuestionIndex ?? 0]?.id;
  const orderedAttempt = await ensurePracticeOrder(attempt, rawQuestions);
  const questions = orderedQuestions(rawQuestions, orderedAttempt);
  const currentQuestionIndex = currentId ? Math.max(0, questions.findIndex(q => q.id === currentId)) : (orderedAttempt.currentQuestionIndex ?? 0);
  const records = await attemptService.getAnswers(attemptId);
  const engine = new AttemptEngine(questions, {
    startedAt: orderedAttempt.startedAt,
    currentQuestionIndex,
    answers: answersMap(records),
    visitedQuestions: orderedAttempt.visitedQuestionIds,
    flaggedQuestions: orderedAttempt.flaggedQuestionIds,
    questionEnteredAt: orderedAttempt.questionEnteredAt,
    status: "in_progress",
    finishedAt: orderedAttempt.finishedAt,
    now
  }, practiceConfig(exam.duration), exam.duration);
  return { attempt, exam, questions, engine };
}

async function ensureNotExpired(attemptId: string, engine: AttemptEngine, questions: Question[], now: number) {
  if (!engine.isExpired(now)) return;
  engine.timeout(now);
  const state = engine.getState(now);
  const result = practiceResultFrom(questions, state);
  await persistState(attemptId, state, {
    status: "submitted", finishedAt: result.finishedAt, duration: result.duration,
    score: result.score, correctCount: result.correctQuestions, wrongCount: result.wrongQuestions,
    skippedCount: result.unansweredQuestions
  });
  throw new TimeExpiredError();
}

async function navigate(attemptId: string, action: "next" | "previous" | "jump", index: number | undefined, now: number) {
  const { exam, questions, engine } = await loadCommandContext(attemptId, now);
  await ensureNotExpired(attemptId, engine, questions, now);
  if (action === "next") engine.next(now);
  else if (action === "previous") engine.previous(now);
  else engine.jump(index!, now);
  return persistState(attemptId, engine.getState(now));
}
