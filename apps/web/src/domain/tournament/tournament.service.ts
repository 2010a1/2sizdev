import { examRepository } from "../exam/exam.repository";
import { examService } from "../exam/exam.service";
import { attemptService } from "../exam/attempt.service";
import type { AnswerValue, Attempt, Question } from "../exam/exam.types";
import { isAnswerCorrect } from "../practice/practice.scoring";
import { generateId } from "@exam/utils";
import { applyCompetitionOrder, buildCompetitionOrder } from "./competition.random";
import { TournamentEngine } from "./tournament.engine";
import type { TournamentResult, TournamentSession, TournamentState } from "./tournament.types";

function answersMap(records: Awaited<ReturnType<typeof attemptService.getAnswers>>): Record<string, AnswerValue> {
  return Object.fromEntries(records.map(record => [record.questionId, record.answer]));
}

function orderedQuestions(questions:Question[],attempt:Attempt):Question[]{const order=attempt.questionOrder??questions.map(q=>q.id);const options=attempt.optionOrderByQuestion??{};return applyCompetitionOrder(questions,order,options);}
async function ensureCompetitionOrder(attempt:Attempt,questions:Question[]):Promise<Attempt>{const seed=attempt.seed??generateId('tournament-seed');const built=buildCompetitionOrder(questions,seed);const questionOrder=attempt.questionOrder?.length===questions.length?attempt.questionOrder:built.questionOrder;const optionOrderByQuestion={...built.optionOrderByQuestion,...(attempt.optionOrderByQuestion??{})};if(!attempt.seed||!attempt.questionOrder||!attempt.optionOrderByQuestion){await attemptService.persistState(attempt.id,{seed,questionOrder,optionOrderByQuestion});return {...attempt,seed,questionOrder,optionOrderByQuestion};}return attempt;}

async function buildSession(attempt:Attempt,now=Date.now()):Promise<TournamentSession>{
  const exam=await examService.getExam(attempt.examId);
  const rawQuestions=await examRepository.getQuestionsByExam(exam.id);
  const rawCurrentId=rawQuestions[attempt.currentQuestionIndex ?? 0]?.id;
  attempt=await ensureCompetitionOrder(attempt,rawQuestions);
  const questions=orderedQuestions(rawQuestions,attempt);
  const currentQuestionIndex=rawCurrentId ? Math.max(0, questions.findIndex(q=>q.id===rawCurrentId)) : (attempt.currentQuestionIndex ?? 0);
  const answers=answersMap(await attemptService.getAnswers(attempt.id));
  const state=new TournamentEngine(questions,{startedAt:attempt.startedAt,currentQuestionIndex,answers,correctCount:attempt.correctCount,wrongCount:attempt.wrongCount,streak:attempt.streak,bestStreak:attempt.bestStreak,status:attempt.status==='won'||attempt.status==='lost'||attempt.status==='timeout'?attempt.status:attempt.status==='abandoned'?'abandoned':'in_progress',finishedAt:attempt.finishedAt,questionStartedAt:attempt.questionEnteredAt},exam.duration).getState(now);
  return {attempt,questions,state};
}

async function persist(attemptId: string, state: TournamentState, extra: Partial<Attempt> = {}) {
  await attemptService.persistState(attemptId, {
    currentQuestionIndex: state.currentQuestionIndex,
    correctCount: state.correctCount, wrongCount: state.wrongCount, streak: state.streak,
    bestStreak: state.bestStreak, status: state.status, finishedAt: state.finishedAt,
    duration: state.finishedAt ? state.duration : undefined, score: state.correctCount,
    skippedCount: 0, questionEnteredAt: state.questionStartedAt, ...extra
  });
  return state;
}

export const tournamentService = {
  async resume(profileId: string, examId: string, now = Date.now()): Promise<TournamentSession | undefined> {
    const attempt = await attemptService.resumeAttempt(profileId, examId, "tournament");
    return attempt ? buildSession(attempt, now) : undefined;
  },
  async abandon(attemptId: string) { await attemptService.abandonAttempt(attemptId); },
  async create(profileId: string, examId: string, startedAt = Date.now()): Promise<TournamentSession> {
    const questions = await examRepository.getQuestionsByExam(examId);
    if (questions.length === 0) throw new Error("Đề chưa có câu hỏi.");
    const seed=generateId('tournament-seed');
    const {questionOrder,optionOrderByQuestion}=buildCompetitionOrder(questions,seed);
    const attempt = await attemptService.createAttempt(profileId, examId, "tournament", startedAt,{seed,questionOrder,optionOrderByQuestion});
    return buildSession(attempt);
  },
  async answer(attemptId: string, answer: AnswerValue, now = Date.now()): Promise<{ state: TournamentState; result?: TournamentResult }> {
    const attempt = await attemptService.getAttempt(attemptId);
    const exam = await examService.getExam(attempt.examId);
    const rawQuestions = await examRepository.getQuestionsByExam(exam.id);
    const rawCurrentId = rawQuestions[attempt.currentQuestionIndex ?? 0]?.id;
    const orderedAttempt = await ensureCompetitionOrder(attempt, rawQuestions);
    const questions = orderedQuestions(rawQuestions, orderedAttempt);
    const currentQuestionIndex = rawCurrentId ? Math.max(0, questions.findIndex(q => q.id === rawCurrentId)) : (orderedAttempt.currentQuestionIndex ?? 0);
    const answers = answersMap(await attemptService.getAnswers(attemptId));
    const engine = new TournamentEngine(questions, {
      startedAt: orderedAttempt.startedAt, currentQuestionIndex, answers,
      correctCount: attempt.correctCount, wrongCount: attempt.wrongCount, streak: attempt.streak,
      bestStreak: attempt.bestStreak, status: attempt.status === "in_progress" ? "in_progress" : attempt.status === "abandoned" ? "abandoned" : attempt.status as TournamentState["status"],
      finishedAt: attempt.finishedAt, questionStartedAt: attempt.questionEnteredAt
    }, exam.duration);
    const question = engine.getCurrentQuestion();
    if (!question) return { state: engine.getState(now) };
    const timeSpent = engine.currentQuestionTimeSpent(now);
    const outcome = engine.answerCurrentQuestion(answer, now);
    const state = engine.getState(now);
    const correct = isAnswerCorrect(question, answer);
    if (engine.getState(now).status !== "timeout") await attemptService.saveAnswer(attemptId, question.id, answer, correct, timeSpent);
    await persist(attemptId, state);
    return { state, result: outcome ?? undefined };
  },
  async timeout(attemptId: string, now = Date.now()): Promise<TournamentResult> {
    const attempt = await attemptService.getAttempt(attemptId);
    const exam = await examService.getExam(attempt.examId);
    const rawQuestions = await examRepository.getQuestionsByExam(exam.id);
    const rawCurrentId = rawQuestions[attempt.currentQuestionIndex ?? 0]?.id;
    const orderedAttempt = await ensureCompetitionOrder(attempt, rawQuestions);
    const questions = orderedQuestions(rawQuestions, orderedAttempt);
    const currentQuestionIndex = rawCurrentId ? Math.max(0, questions.findIndex(q => q.id === rawCurrentId)) : (orderedAttempt.currentQuestionIndex ?? 0);
    const answers = answersMap(await attemptService.getAnswers(attemptId));
    const engine = new TournamentEngine(questions, {
      startedAt: orderedAttempt.startedAt, currentQuestionIndex, answers,
      correctCount: attempt.correctCount, wrongCount: attempt.wrongCount, streak: attempt.streak,
      bestStreak: attempt.bestStreak, status: "in_progress", finishedAt: attempt.finishedAt,
      questionStartedAt: attempt.questionEnteredAt
    }, exam.duration);
    const result = engine.timeout(now);
    await persist(attemptId, engine.getState(now), { status: "timeout", finishedAt: result.finishedAt, duration: result.duration, score: result.correctCount });
    return result;
  },
  async checkExpiration(attemptId: string, now = Date.now()): Promise<TournamentResult | undefined> {
    const attempt = await attemptService.getAttempt(attemptId);
    if (attempt.status !== "in_progress") return undefined;
    const exam = await examService.getExam(attempt.examId);
    if (exam.duration === undefined) return undefined;
    if (Math.max(0, Math.floor((now - attempt.startedAt) / 1000)) < exam.duration) return undefined;
    return this.timeout(attemptId, now);
  },
  async result(attemptId: string): Promise<TournamentResult> {
    const attempt = await attemptService.getAttempt(attemptId);
    const exam = await examService.getExam(attempt.examId);
    const rawQuestions = await examRepository.getQuestionsByExam(exam.id);
    const rawCurrentId = rawQuestions[attempt.currentQuestionIndex ?? 0]?.id;
    const orderedAttempt = await ensureCompetitionOrder(attempt, rawQuestions);
    const questions = orderedQuestions(rawQuestions, orderedAttempt);
    const currentQuestionIndex = rawCurrentId ? Math.max(0, questions.findIndex(q => q.id === rawCurrentId)) : (orderedAttempt.currentQuestionIndex ?? 0);
    const answers = answersMap(await attemptService.getAnswers(attemptId));
    const correct = questions.filter((q: Question) => answers[q.id] && isAnswerCorrect(q, answers[q.id])).length;
    const wrong = Object.keys(answers).length - correct;
    return {
      status: (attempt.status === "won" || attempt.status === "lost" || attempt.status === "timeout") ? attempt.status : "lost",
      correctCount: correct, wrongCount: wrong, totalQuestions: questions.length,
      percentage: questions.length ? correct / questions.length * 100 : 0,
      bestStreak: attempt.bestStreak,
      duration: attempt.duration ?? Math.max(0, Math.floor(((attempt.finishedAt ?? Date.now()) - attempt.startedAt) / 1000)),
      startedAt: attempt.startedAt, finishedAt: attempt.finishedAt ?? Date.now(),
      failedQuestionId: questions.find((q: Question) => answers[q.id] && !isAnswerCorrect(q, answers[q.id]))?.id,
      answers
    };
  }
};
