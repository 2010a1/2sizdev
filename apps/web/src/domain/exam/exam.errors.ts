export class ExamDomainError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "ExamDomainError";
  }
}

export class AttemptNotFoundError extends ExamDomainError {
  constructor() { super("Không tìm thấy bài làm.", "ATTEMPT_NOT_FOUND"); }
}
export class InvalidAttemptStateError extends ExamDomainError {
  constructor(message = "Bài làm không còn ở trạng thái đang làm.") { super(message, "INVALID_ATTEMPT_STATE"); }
}
export class ExamNotFoundError extends ExamDomainError {
  constructor() { super("Không tìm thấy đề thi.", "EXAM_NOT_FOUND"); }
}
export class QuestionNotFoundError extends ExamDomainError {
  constructor() { super("Không tìm thấy câu hỏi.", "QUESTION_NOT_FOUND"); }
}
export class TimeExpiredError extends ExamDomainError {
  constructor() { super("Đã hết thời gian làm bài.", "TIME_EXPIRED"); }
}
