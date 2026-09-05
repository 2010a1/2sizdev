import type { AttemptState } from "../attempt/attempt.types";
import type { AnswerValue, Attempt, Question } from "../exam/exam.types";

/** Luyện tập dùng AttemptState chung của AttemptEngine; các trường thi đấu (streak…) hiện diện nhưng bỏ qua. */
export type PracticeState = AttemptState;
export type PracticeStatus = PracticeState["status"];

export interface PracticeResult {
  totalQuestions: number;
  answeredQuestions: number;
  correctQuestions: number;
  wrongQuestions: number;
  unansweredQuestions: number;
  score: number;
  percentage: number;
  duration: number;
  startedAt: number;
  finishedAt: number;
  answers: Record<string, AnswerValue>;
}

export interface PracticeSession {
  attempt: Attempt;
  questions: Question[];
  state: PracticeState;
}
