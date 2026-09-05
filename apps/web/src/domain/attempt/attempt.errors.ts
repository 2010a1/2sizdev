import { ExamDomainError } from "../exam/exam.errors";

export class InvalidAttemptActionError extends ExamDomainError {
  constructor(message: string) { super(message, "INVALID_ATTEMPT_ACTION"); }
}
