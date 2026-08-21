import type { AnswerValue, Attempt, Question } from "../exam/exam.types";
export type TournamentStatus = "in_progress" | "won" | "lost" | "timeout" | "abandoned";
export interface TournamentState {
  currentQuestionIndex: number;
  answers: Record<string, AnswerValue>;
  answeredQuestions: number;
  correctCount: number;
  wrongCount: number;
  streak: number;
  bestStreak: number;
  status: TournamentStatus;
  startedAt: number;
  finishedAt?: number;
  duration: number;
  questionStartedAt: number;
}
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
