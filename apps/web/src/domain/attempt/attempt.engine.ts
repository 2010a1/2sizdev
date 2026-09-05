import type { AnswerValue, Question } from "../exam/exam.types";
import { InvalidAttemptStateError, QuestionNotFoundError } from "../exam/exam.errors";
import { isAnswerCorrect } from "../practice/practice.scoring";
import { InvalidAttemptActionError } from "./attempt.errors";
import type { AttemptAnswerOutcome, AttemptEngineConfig, AttemptEngineOptions, AttemptState } from "./attempt.types";

export const PRACTICE_CONFIG: AttemptEngineConfig = { allowBack: true, requireAnswerToAdvance: false, timed: false };
export const TOURNAMENT_CONFIG: AttemptEngineConfig = { allowBack: false, requireAnswerToAdvance: true, timed: false };

/** State machine dùng chung cho luyện tập và thi đấu.
 * Hành vi khác nhau nhau điều khiển bởi config; scoring thuộc về service (calculatePracticeScore / TournamentResult). */
export class AttemptEngine {
  private state: AttemptState;

  constructor(
    private readonly questions: Question[],
    options: AttemptEngineOptions,
    private readonly config: AttemptEngineConfig,
    private readonly durationSeconds?: number
  ) {
    const index = Math.min(Math.max(options.currentQuestionIndex ?? 0, 0), Math.max(questions.length - 1, 0));
    const now = options.now ?? Date.now();
    const answers = { ...(options.answers ?? {}) };
    // Đếm đúng/sai luôn suy ra từ answers để chống lệch với state đã lưu.
    let correctCount = 0, wrongCount = 0;
    for (const question of questions) {
      const answer = answers[question.id];
      if (answer === undefined) continue;
      if (isAnswerCorrect(question, answer)) correctCount += 1; else wrongCount += 1;
    }
    this.state = {
      currentQuestionIndex: index,
      answers,
      visitedQuestions: [...new Set(options.visitedQuestions ?? (questions[index] ? [questions[index].id] : []))],
      flaggedQuestions: [...new Set(options.flaggedQuestions ?? [])],
      correctCount, wrongCount,
      streak: options.streak ?? 0,
      bestStreak: options.bestStreak ?? 0,
      startedAt: options.startedAt,
      finishedAt: options.finishedAt,
      elapsedTime: Math.max(0, Math.floor((now - options.startedAt) / 1000)),
      questionEnteredAt: options.questionEnteredAt ?? options.startedAt,
      status: options.status ?? "in_progress"
    };
  }

  getState(now = Date.now()): AttemptState {
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
  isExpired(now = Date.now()): boolean {
    return this.config.timed && this.durationSeconds !== undefined && this.durationSeconds > 0 && this.elapsed(now) >= this.durationSeconds;
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

  /** Ghi nhận đáp án câu hiện tại. Trả về outcome khi lượt kết thúc ngay (thi đấu), null nếu còn tiếp. */
  answerCurrent(answer: AnswerValue, now = Date.now()): AttemptAnswerOutcome | null {
    this.ensureActive();
    if (this.isExpired(now)) { this.timeout(now); return { finished: true }; }
    const question = this.getCurrentQuestion();
    if (!question) throw new QuestionNotFoundError();
    if (!this.config.requireAnswerToAdvance) {
      // Luyện tập: ghi đè đáp án tự do, không tự kết thúc.
      this.touch(question.id);
      this.state.answers[question.id] = answer;
      return null;
    }
    // Thi đấu: mỗi câu trả lời một lần, sai là hết, đúng mới tiến.
    if (this.state.answers[question.id] !== undefined) throw new InvalidAttemptActionError("Câu này đã được trả lời.");
    this.touch(question.id);
    const correct = isAnswerCorrect(question, answer);
    this.state.answers[question.id] = answer;
    if (!correct) {
      this.state.wrongCount += 1; this.state.streak = 0;
      this.state.status = "lost"; this.state.finishedAt = now;
      return { finished: true, failedQuestionId: question.id };
    }
    this.state.correctCount += 1;
    this.state.streak += 1;
    this.state.bestStreak = Math.max(this.state.bestStreak, this.state.streak);
    if (this.state.currentQuestionIndex >= this.questions.length - 1) {
      this.state.status = "won"; this.state.finishedAt = now;
      return { finished: true };
    }
    this.state.currentQuestionIndex += 1;
    this.state.questionEnteredAt = now;
    return null;
  }

  next(now = Date.now()): void {
    this.ensureActive();
    if (this.state.currentQuestionIndex >= this.questions.length - 1) return;
    this.enter(this.state.currentQuestionIndex + 1, now);
  }
  previous(now = Date.now()): void {
    this.ensureActive();
    if (!this.config.allowBack) throw new InvalidAttemptActionError("Chế độ này không cho quay lại câu trước.");
    if (this.state.currentQuestionIndex <= 0) return;
    this.enter(this.state.currentQuestionIndex - 1, now);
  }
  jump(index: number, now = Date.now()): void {
    this.ensureActive();
    if (!this.config.allowBack) throw new InvalidAttemptActionError("Chế độ này không cho nhảy câu.");
    if (!Number.isInteger(index) || index < 0 || index >= this.questions.length) throw new InvalidAttemptActionError("Câu hỏi không hợp lệ.");
    this.enter(index, now);
  }
  toggleFlag(questionId: string): void {
    this.ensureActive();
    if (!this.config.allowBack) throw new InvalidAttemptActionError("Chế độ này không có đánh dấu câu.");
    this.touch(questionId);
    const set = new Set(this.state.flaggedQuestions);
    if (set.has(questionId)) set.delete(questionId); else set.add(questionId);
    this.state.flaggedQuestions = [...set];
  }

  /** Kết thúc và chấm bài (luyện tập). */
  submit(now = Date.now()): void {
    this.ensureActive();
    this.state.status = "submitted";
    this.state.finishedAt = now;
    this.state.elapsedTime = this.elapsed(now);
  }

  /** Hết giờ: luyện tập chấm như nộp bài, thi đấu ghi nhận timeout. Không đổi gì nếu lượt đã kết thúc. */
  timeout(now = Date.now()): void {
    if (this.state.status !== "in_progress") return;
    this.state.status = this.config.requireAnswerToAdvance ? "timeout" : "submitted";
    this.state.finishedAt = now;
    this.state.elapsedTime = this.elapsed(now);
  }
}
