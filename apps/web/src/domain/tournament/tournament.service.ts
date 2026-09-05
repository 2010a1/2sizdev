import { examRepository } from "../exam/exam.repository";
import { examService } from "../exam/exam.service";
import { attemptService } from "../exam/attempt.service";
import type { AnswerValue, Attempt, Question } from "../exam/exam.types";
import { isAnswerCorrect } from "../practice/practice.scoring";
import { generateId } from "@exam/utils";
import { applyCompetitionOrder, buildCompetitionOrder } from "./competition.random";
import { AttemptEngine, TOURNAMENT_CONFIG } from "../attempt/attempt.engine";
import type { AttemptEngineConfig, AttemptState } from "../attempt/attempt.types";
import { calculateTournamentPercentage } from "./tournament.scoring";
import type { TournamentResult, TournamentSession, TournamentState } from "./tournament.types";

function answersMap(records: Awaited<ReturnType<typeof attemptService.getAnswers>>): Record<string, AnswerValue> {
  return Object.fromEntries(records.map(record => [record.questionId, record.answer]));
}

function tournamentConfig(duration: number | undefined): AttemptEngineConfig {
  return { ...TOURNAMENT_CONFIG, timed: duration !== undefined };
}

function orderedQuestions(questions:Question[],attempt:Attempt):Question[]{const order=attempt.questionOrder??questions.map(q=>q.id);const options=attempt.optionOrderByQuestion??{};return applyCompetitionOrder(questions,order,options);}
async function ensureCompetitionOrder(attempt:Attempt,questions:Question[]):Promise<Attempt>{const seed=attempt.seed??generateId('tournament-seed');const built=buildCompetitionOrder(questions,seed);const questionOrder=attempt.questionOrder?.length===questions.length?attempt.questionOrder:built.questionOrder;const optionOrderByQuestion={...built.optionOrderByQuestion,...(attempt.optionOrderByQuestion??{})};if(!attempt.seed||!attempt.questionOrder||!attempt.optionOrderByQuestion){await attemptService.persistState(attempt.id,{seed,questionOrder,optionOrderByQuestion});return {...attempt,seed,questionOrder,optionOrderByQuestion};}return attempt;}

function restoreOptions(attempt: Attempt, currentQuestionIndex: number, answers: Record<string, AnswerValue>, status: AttemptState["status"]) {
  return {
    startedAt: attempt.startedAt, currentQuestionIndex, answers,
    streak: attempt.streak, bestStreak: attempt.bestStreak, status,
    finishedAt: attempt.finishedAt, questionEnteredAt: attempt.questionEnteredAt
  };
}
function liveStatus(attempt: Attempt): AttemptState["status"] {
  return attempt.status === "won" || attempt.status === "lost" || attempt.status === "timeout" ? attempt.status : attempt.status === "abandoned" ? "abandoned" : "in_progress";
}

function buildResult(state: AttemptState, totalQuestions: number, failedQuestionId?: string): TournamentResult {
  const finishedAt = state.finishedAt ?? Date.now();
  return {
    // AttemptEngine trong config thi đấu chỉ kết thúc bằng won/lost/timeout.
    status: state.status as TournamentResult["status"],
    correctCount: state.correctCount, wrongCount: state.wrongCount, totalQuestions,
    percentage: calculateTournamentPercentage(state.correctCount, totalQuestions),
    bestStreak: state.bestStreak, duration: Math.max(0, Math.floor((finishedAt - state.startedAt) / 1000)),
    startedAt: state.startedAt, finishedAt, failedQuestionId, answers: { ...state.answers }
  };
}

async function persist(attemptId: string, state: TournamentState, extra: Partial<Attempt> = {}) {
  await attemptService.persistState(attemptId, {
    currentQuestionIndex: state.currentQuestionIndex,
    correctCount: state.correctCount, wrongCount: state.wrongCount, streak: state.streak,
    bestStreak: state.bestStreak, status: state.status, finishedAt: state.finishedAt,
    duration: state.finishedAt ? state.elapsedTime : undefined, score: state.correctCount,
    skippedCount: 0, questionEnteredAt: state.questionEnteredAt, ...extra
  });
  return state;
}

async function loadCommandContext(attemptId: string, now: number) {
  const attempt = await attemptService.getAttempt(attemptId);
  const exam = await examService.getExam(attempt.examId);
  const rawQuestions = await examRepository.getQuestionsByExam(exam.id);
  const orderedAttempt = await ensureCompetitionOrder(attempt, rawQuestions);
  const questions = orderedQuestions(rawQuestions, orderedAttempt);
  const currentQuestionIndex = Math.min(Math.max(orderedAttempt.currentQuestionIndex ?? 0, 0), Math.max(questions.length - 1, 0));
  const answers = answersMap(await attemptService.getAnswers(attemptId));
  const engine = new AttemptEngine(questions, restoreOptions(orderedAttempt, currentQuestionIndex, answers, "in_progress"), tournamentConfig(exam.duration), exam.duration);
  return { attempt: orderedAttempt, exam, questions, answers, engine, now };
}

export const tournamentService = {
  async resume(profileId: string, examId: string, now = Date.now()): Promise<TournamentSession | undefined> {
    const attempt = await attemptService.resumeAttempt(profileId, examId, "tournament");
    if (!attempt) return undefined;
    const exam = await examService.getExam(attempt.examId);
    const rawQuestions = await examRepository.getQuestionsByExam(exam.id);
    const ordered = await ensureCompetitionOrder(attempt, rawQuestions);
    const questions = orderedQuestions(rawQuestions, ordered);
    const currentQuestionIndex = Math.min(Math.max(attempt.currentQuestionIndex ?? 0, 0), Math.max(questions.length - 1, 0));
    const answers = answersMap(await attemptService.getAnswers(attempt.id));
    const state = new AttemptEngine(questions, restoreOptions(ordered, currentQuestionIndex, answers, liveStatus(attempt)), tournamentConfig(exam.duration), exam.duration).getState(now);
    return { attempt: ordered, questions, state };
  },
  async abandon(attemptId: string) { await attemptService.abandonAttempt(attemptId); },
  async create(profileId: string, examId: string, startedAt = Date.now()): Promise<TournamentSession> {
    const questions = await examRepository.getQuestionsByExam(examId);
    if (questions.length === 0) throw new Error("Đề chưa có câu hỏi.");
    const seed = generateId('tournament-seed');
    const {questionOrder,optionOrderByQuestion} = buildCompetitionOrder(questions,seed);
    const attempt = await attemptService.createAttempt(profileId, examId, "tournament", startedAt, {seed,questionOrder,optionOrderByQuestion});
    return this.resume(profileId, examId, startedAt).then(s => s ?? { attempt, questions, state: new AttemptEngine(questions, restoreOptions(attempt, 0, {}, "in_progress"), tournamentConfig(undefined), undefined).getState(startedAt) });
  },
  async answer(attemptId: string, answer: AnswerValue, now = Date.now()): Promise<{ state: TournamentState; result?: TournamentResult }> {
    const { exam, questions, engine } = await loadCommandContext(attemptId, now);
    const question = engine.getCurrentQuestion();
    if (!question) return { state: engine.getState(now) };
    const timeSpent = engine.currentQuestionTimeSpent(now);
    const outcome = engine.answerCurrent(answer, now);
    const state = engine.getState(now);
    if (state.status !== "timeout") {
      const correct = isAnswerCorrect(question, answer);
      await attemptService.saveAnswer(attemptId, question.id, answer, correct, timeSpent);
    }
    await persist(attemptId, state);
    return { state, result: outcome?.finished ? buildResult(state, questions.length, outcome.failedQuestionId) : undefined };
  },
  async timeout(attemptId: string, now = Date.now()): Promise<TournamentResult> {
    const { questions, engine } = await loadCommandContext(attemptId, now);
    engine.timeout(now);
    const state = engine.getState(now);
    await persist(attemptId, state, { status: "timeout", finishedAt: state.finishedAt, duration: state.elapsedTime, score: state.correctCount });
    return buildResult(state, questions.length);
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
    const orderedAttempt = await ensureCompetitionOrder(attempt, rawQuestions);
    const questions = orderedQuestions(rawQuestions, orderedAttempt);
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
