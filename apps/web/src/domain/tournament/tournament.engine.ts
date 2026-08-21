import type { AnswerValue, Question } from "../exam/exam.types";
import { InvalidAttemptStateError, QuestionNotFoundError } from "../exam/exam.errors";
import { InvalidTournamentActionError } from "./tournament.errors";
import { calculateTournamentPercentage, tournamentAnswerCorrect } from "./tournament.scoring";
import type { TournamentResult, TournamentState, TournamentStatus } from "./tournament.types";

export interface TournamentEngineOptions {
  startedAt: number; currentQuestionIndex?: number; answers?: Record<string, AnswerValue>;
  correctCount?: number; wrongCount?: number; streak?: number; bestStreak?: number;
  status?: TournamentState["status"]; finishedAt?: number; questionStartedAt?: number; now?: number;
}

export class TournamentEngine {
  private state: Omit<TournamentState, "answeredQuestions">;
  constructor(private readonly questions: Question[], options: TournamentEngineOptions, private readonly durationSeconds?: number) {
    const now = options.now ?? Date.now();
    const index = Math.min(Math.max(options.currentQuestionIndex ?? 0, 0), Math.max(questions.length - 1, 0));
    const status = questions.length === 0 ? "won" : (options.status ?? "in_progress");
    const answers = { ...(options.answers ?? {}) };
    const correctCount = questions.reduce((count, question) => {
      const answer = answers[question.id];
      return answer && tournamentAnswerCorrect(question, answer) ? count + 1 : count;
    }, 0);
    const wrongCount = Object.keys(answers).filter(questionId => {
      const question = questions.find(item => item.id === questionId);
      return Boolean(question && !tournamentAnswerCorrect(question, answers[questionId]));
    }).length;
    this.state = {
      currentQuestionIndex: index,
      answers,
      correctCount,
      wrongCount,
      streak: options.streak ?? 0,
      bestStreak: options.bestStreak ?? 0,
      status,
      startedAt: options.startedAt,
      finishedAt: options.finishedAt ?? (questions.length === 0 ? options.startedAt : undefined),
      duration: Math.max(0, Math.floor((now - options.startedAt) / 1000)),
      questionStartedAt: options.questionStartedAt ?? options.startedAt
    };
  }
  getState(now = Date.now()): TournamentState {
    return { ...this.state, answers: { ...this.state.answers }, answeredQuestions: Object.keys(this.state.answers).length, duration: this.elapsed(now) };
  }
  getCurrentQuestion(): Question | undefined { return this.questions[this.state.currentQuestionIndex]; }
  elapsed(now = Date.now()): number { return Math.max(0, Math.floor((now - this.state.startedAt) / 1000)); }
  currentQuestionTimeSpent(now = Date.now()): number { return Math.max(0, Math.floor((now - this.state.questionStartedAt) / 1000)); }
  isExpired(now = Date.now()): boolean { return this.durationSeconds !== undefined && this.durationSeconds > 0 && this.elapsed(now) >= this.durationSeconds; }
  private ensureActive() { if (this.state.status !== "in_progress") throw new InvalidAttemptStateError(); }

  answerCurrentQuestion(answer: AnswerValue, now = Date.now()): TournamentResult | null {
    this.ensureActive();
    if (this.isExpired(now)) return this.timeout(now);
    const question = this.getCurrentQuestion();
    if (!question) throw new QuestionNotFoundError();
    if (this.state.answers[question.id]) throw new InvalidTournamentActionError("Câu này đã được trả lời.");
    const timeSpent = this.currentQuestionTimeSpent(now);
    const correct = tournamentAnswerCorrect(question, answer);
    this.state.answers[question.id] = answer;
    if (!correct) {
      this.state.wrongCount += 1; this.state.streak = 0; this.state.status = "lost"; this.state.finishedAt = now;
      return this.result(now, question.id);
    }
    this.state.correctCount += 1;
    this.state.streak += 1;
    this.state.bestStreak = Math.max(this.state.bestStreak, this.state.streak);
    if (this.state.currentQuestionIndex >= this.questions.length - 1) {
      this.state.status = "won"; this.state.finishedAt = now;
      return this.result(now);
    }
    this.state.currentQuestionIndex += 1;
    this.state.questionStartedAt = now;
    return null;
  }

  timeout(now = Date.now()): TournamentResult {
    this.ensureActive(); this.state.status = "timeout"; this.state.finishedAt = now;
    return this.result(now);
  }
  private result(now: number, failedQuestionId?: string): TournamentResult {
    const finishedAt = this.state.finishedAt ?? now;
    return {
      status: this.state.status as Exclude<TournamentState["status"], "in_progress" | "abandoned">,
      correctCount: this.state.correctCount, wrongCount: this.state.wrongCount,
      totalQuestions: this.questions.length,
      percentage: calculateTournamentPercentage(this.state.correctCount, this.questions.length),
      bestStreak: this.state.bestStreak, duration: this.elapsed(finishedAt),
      startedAt: this.state.startedAt, finishedAt, failedQuestionId, answers: { ...this.state.answers }
    };
  }
}
