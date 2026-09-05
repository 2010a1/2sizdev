import type { AnswerValue } from "../exam/exam.types";
import { practiceService } from "./practice.service";
import type { PracticeResult, PracticeSession, PracticeState } from "./practice.types";

export class PracticeController {
  private currentState: PracticeState;
  constructor(private readonly session: PracticeSession) {
    this.currentState = session.state;
  }
  get state() { return this.currentState; }
  get questions() { return this.session.questions; }
  get attemptId() { return this.session.attempt.id; }
  private setState(state: PracticeState) { this.currentState = state; return state; }
  async answer(answer: AnswerValue, now = Date.now()) { const result = await practiceService.answer(this.attemptId, answer, now); this.setState(result.state); return result; }
  async next(now = Date.now()) { return this.setState(await practiceService.next(this.attemptId, now)); }
  async previous(now = Date.now()) { return this.setState(await practiceService.previous(this.attemptId, now)); }
  async jump(index: number, now = Date.now()) { return this.setState(await practiceService.jump(this.attemptId, index, now)); }
  async toggleFlag(questionId: string) { return this.setState(await practiceService.toggleFlag(this.attemptId, questionId)); }
  async submit(now = Date.now()): Promise<PracticeResult> { return practiceService.submit(this.attemptId, now); }
  async checkExpiration(now = Date.now()): Promise<PracticeResult | undefined> { return practiceService.checkExpiration(this.attemptId, now); }
}
