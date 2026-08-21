import type { AnswerValue, Question } from "../exam/exam.types";
import { InvalidAttemptStateError, QuestionNotFoundError, TimeExpiredError } from "../exam/exam.errors";
import { InvalidPracticeActionError } from "./practice.errors";
import { calculatePracticeScore } from "./practice.scoring";
import type { PracticeResult, PracticeState } from "./practice.types";

export interface PracticeEngineOptions {
  startedAt: number;
  currentQuestionIndex?: number;
  answers?: Record<string, AnswerValue>;
  visitedQuestions?: string[];
  flaggedQuestions?: string[];
  status?: PracticeState["status"];
  finishedAt?: number;
  questionEnteredAt?: number;
  now?: number;
}

export class PracticeEngine {
  private state: PracticeState;

  constructor(private readonly questions: Question[], options: PracticeEngineOptions) {
    const index = Math.min(Math.max(options.currentQuestionIndex ?? 0, 0), Math.max(questions.length - 1, 0));
    const now = options.now ?? Date.now();
    const questionEnteredAt = options.questionEnteredAt ?? options.startedAt;
    this.state = {
      currentQuestionIndex: index,
      answers: { ...(options.answers ?? {}) },
      visitedQuestions: [...new Set(options.visitedQuestions ?? (questions[index] ? [questions[index].id] : []))],
      flaggedQuestions: [...new Set(options.flaggedQuestions ?? [])],
      startedAt: options.startedAt,
      finishedAt: options.finishedAt,
      elapsedTime: Math.max(0, Math.floor((now - options.startedAt) / 1000)),
      questionEnteredAt,
      status: options.status ?? "in_progress"
    };
  }

  getState(now = Date.now()): PracticeState {
    return {
      ...this.state,
      answers: { ...this.state.answers },
      visitedQuestions: [...this.state.visitedQuestions],
      flaggedQuestions: [...this.state.flaggedQuestions],
      elapsedTime: this.elapsed(now)
    };
  }

  getCurrentQuestion(): Question | undefined { return this.questions[this.state.currentQuestionIndex]; }
  elapsed(now = Date.now()): number { return Math.max(0, Math.floor((now - this.state.startedAt) / 1000)); }
  currentQuestionTimeSpent(now = Date.now()): number { return Math.max(0, Math.floor((now - this.state.questionEnteredAt) / 1000)); }
  isExpired(durationSeconds: number | undefined, now = Date.now()): boolean {
    return durationSeconds !== undefined && durationSeconds > 0 && this.elapsed(now) >= durationSeconds;
  }

  private ensureActive() { if (this.state.status !== "in_progress") throw new InvalidAttemptStateError(); }
  private touch(questionId: string) {
    if (!this.questions.some(q => q.id === questionId)) throw new QuestionNotFoundError();
    if (!this.state.visitedQuestions.includes(questionId)) this.state.visitedQuestions.push(questionId);
  }
  private enter(index: number, now: number) {
    this.state.currentQuestionIndex = index;
    this.touch(this.questions[index].id);
    this.state.questionEnteredAt = now;
    this.state.elapsedTime = this.elapsed(now);
  }

  answerQuestion(questionId: string, answer: AnswerValue, now = Date.now()): number {
    this.ensureActive();
    const current = this.getCurrentQuestion();
    if (!current || current.id !== questionId) throw new InvalidPracticeActionError("Chỉ có thể trả lời câu hỏi đang mở.");
    this.touch(questionId);
    const timeSpent = this.currentQuestionTimeSpent(now);
    this.state.answers[questionId] = answer;
    return timeSpent;
  }

  next(now = Date.now()): void {
    this.ensureActive();
    if (this.state.currentQuestionIndex >= this.questions.length - 1) return;
    this.enter(this.state.currentQuestionIndex + 1, now);
  }
  previous(now = Date.now()): void {
    this.ensureActive();
    if (this.state.currentQuestionIndex <= 0) return;
    this.enter(this.state.currentQuestionIndex - 1, now);
  }
  jump(index: number, now = Date.now()): void {
    this.ensureActive();
    if (!Number.isInteger(index) || index < 0 || index >= this.questions.length) throw new InvalidPracticeActionError("Câu hỏi không hợp lệ.");
    this.enter(index, now);
  }
  toggleFlag(questionId: string): void {
    this.ensureActive();
    this.touch(questionId);
    const set = new Set(this.state.flaggedQuestions);
    set.has(questionId) ? set.delete(questionId) : set.add(questionId);
    this.state.flaggedQuestions = [...set];
  }
  submit(now = Date.now()): PracticeResult {
    this.ensureActive();
    this.state.status = "submitted";
    this.state.finishedAt = now;
    this.state.elapsedTime = this.elapsed(now);
    return calculatePracticeScore(this.questions, this.state.answers, this.state.startedAt, now);
  }
  timeout(now = Date.now()): PracticeResult {
    if (this.state.status !== "in_progress") {
      return calculatePracticeScore(this.questions, this.state.answers, this.state.startedAt, this.state.finishedAt ?? now);
    }
    return this.submit(now);
  }
}
