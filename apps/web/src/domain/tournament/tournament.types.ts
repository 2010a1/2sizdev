import type { AttemptState } from "../attempt/attempt.types";
import type { AnswerValue, Attempt, Question } from "../exam/exam.types";

/** Thi đấu dùng AttemptState chung của AttemptEngine; các trường luyện tập (flagged…) hiện diện nhưng bỏ qua. */
export type TournamentState = AttemptState;
export type TournamentStatus = TournamentState["status"];

export interface TournamentResult {
  status: Exclude<TournamentStatus, "in_progress" | "abandoned">;
  correctCount: number;
  wrongCount: number;
  totalQuestions: number;
  percentage: number;
  bestStreak: number;
  duration: number;
  startedAt: number;
  finishedAt: number;
  failedQuestionId?: string;
  answers: Record<string, AnswerValue>;
}

export interface TournamentSession { attempt: Attempt; questions: Question[]; state: TournamentState; }
