import type { AnswerValue } from "../exam/exam.types";
import { tournamentService } from "./tournament.service";
import type { TournamentResult, TournamentSession, TournamentState } from "./tournament.types";

export class TournamentController {
  private currentState: TournamentState;
  constructor(private readonly session: TournamentSession) { this.currentState = session.state; }
  get state() { return this.currentState; }
  get questions() { return this.session.questions; }
  get attemptId() { return this.session.attempt.id; }
  private setState(state: TournamentState) { this.currentState = state; return state; }
  async answer(answer: AnswerValue, now = Date.now()): Promise<TournamentResult | undefined> {
    const result = await tournamentService.answer(this.attemptId, answer, now);
    this.setState(result.state);
    return result.result;
  }
  async timeout(now = Date.now()) {
    return tournamentService.timeout(this.attemptId, now);
  }
  async checkExpiration(now = Date.now()) { return tournamentService.checkExpiration(this.attemptId, now); }
}
