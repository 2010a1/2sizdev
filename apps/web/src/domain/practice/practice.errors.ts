import { ExamDomainError } from "../exam/exam.errors";
export class InvalidPracticeActionError extends ExamDomainError {
  constructor(message: string) { super(message, "INVALID_PRACTICE_ACTION"); }
}
