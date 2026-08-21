export type TournamentState =
  | "ready"
  | "question"
  | "correct"
  | "finished";

export interface TournamentResult {
  correct: boolean;
  finished: boolean;
}

export class TournamentEngine {
  private index = 0;
  private state: TournamentState = "ready";
  private streak = 0;

  start() {
    this.index = 0;
    this.streak = 0;
    this.state = "question";
  }

  answer(correct: boolean): TournamentResult {
    if (this.state !== "question") {
      throw new Error("Tournament is not accepting an answer");
    }

    if (!correct) {
      this.state = "finished";
      return { correct: false, finished: true };
    }

    this.streak++;
    this.index++;
    this.state = "correct";
    return { correct: true, finished: false };
  }

  next() {
    if (this.state === "correct") this.state = "question";
  }

  get currentIndex() {
    return this.index;
  }

  get currentStreak() {
    return this.streak;
  }

  get currentState() {
    return this.state;
  }
}
