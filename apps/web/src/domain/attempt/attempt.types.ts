import type { AnswerValue } from "../exam/exam.types";

export type AttemptStatus = "in_progress" | "submitted" | "won" | "lost" | "timeout" | "abandoned";

/** Cấu hình hành vi của một lượt làm bài.
 * practice   = { allowBack: true,  requireAnswerToAdvance: false }
 * tournament = { allowBack: false, requireAnswerToAdvance: true  }
 * timed: bài có giới hạn thời gian (exam.duration !== undefined). */
export interface AttemptEngineConfig {
  allowBack: boolean;
  requireAnswerToAdvance: boolean;
  timed: boolean;
}

/** State superset: trường nào một chế độ không dùng thì vẫn hiện diện (bỏ qua). */
export interface AttemptState {
  currentQuestionIndex: number;
  answers: Record<string, AnswerValue>;
  visitedQuestions: string[];
  flaggedQuestions: string[];
  correctCount: number;
  wrongCount: number;
  streak: number;
  bestStreak: number;
  startedAt: number;
  finishedAt?: number;
  elapsedTime: number;
  questionEnteredAt: number;
  status: AttemptStatus;
}

export interface AttemptEngineOptions {
  startedAt: number;
  currentQuestionIndex?: number;
  answers?: Record<string, AnswerValue>;
  visitedQuestions?: string[];
  flaggedQuestions?: string[];
  streak?: number;
  bestStreak?: number;
  status?: AttemptStatus;
  finishedAt?: number;
  questionEnteredAt?: number;
  now?: number;
}

/** Kết quả trả lời khi requireAnswerToAdvance: lượt có thể kết thúc ngay tại câu đó. */
export interface AttemptAnswerOutcome {
  finished: boolean;
  failedQuestionId?: string;
}
