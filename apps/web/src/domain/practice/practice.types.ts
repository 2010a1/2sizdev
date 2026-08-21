import type { AnswerValue, Attempt, Question } from "../exam/exam.types";

export type PracticeStatus = "in_progress" | "submitted" | "abandoned";

export interface PracticeState {
  currentQuestionIndex: number;
  answers: Record<string, AnswerValue>;
  visitedQuestions: string[];
  flaggedQuestions: string[];
  startedAt: number;
  finishedAt?: number;
  elapsedTime: number;
  questionEnteredAt: number;
  status: PracticeStatus;
}

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
