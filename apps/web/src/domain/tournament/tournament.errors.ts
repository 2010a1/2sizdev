import { ExamDomainError } from "../exam/exam.errors";
export class InvalidTournamentActionError extends ExamDomainError { constructor(message: string) { super(message, "INVALID_TOURNAMENT_ACTION"); } }
