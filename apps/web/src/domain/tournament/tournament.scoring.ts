import type { AnswerValue, Question } from "../exam/exam.types";
import { isAnswerCorrect } from "../practice/practice.scoring";
export function calculateTournamentPercentage(correctCount: number, totalQuestions: number): number { return totalQuestions === 0 ? 0 : (correctCount / totalQuestions) * 100; }
export function tournamentAnswerCorrect(question: Question, answer: AnswerValue): boolean { return isAnswerCorrect(question, answer); }
