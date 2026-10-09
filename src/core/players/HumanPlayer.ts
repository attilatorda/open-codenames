import type { OperativeView, SpymasterView } from '../engine/views';
import type { ClueDecision, GuessDecision, IPlayer, TurnContext } from './IPlayer';

export type HumanRequest =
  | { type: 'clue'; view: SpymasterView }
  | { type: 'guess'; view: OperativeView }
  | null;

interface Pending<T> {
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

/** Bridges UI input to the player interface: each request resolves when the UI submits. */
export class HumanPlayer implements IPlayer {
  readonly kind = 'human' as const;
  private clue?: Pending<ClueDecision>;
  private guess?: Pending<GuessDecision>;
  private request: HumanRequest = null;
  private listeners = new Set<(r: HumanRequest) => void>();

  constructor(readonly id: string) {}

  subscribe(fn: (r: HumanRequest) => void): () => void {
    this.listeners.add(fn);
    fn(this.request);
    return () => this.listeners.delete(fn);
  }

  get current(): HumanRequest {
    return this.request;
  }

  giveClue(view: SpymasterView, ctx: TurnContext): Promise<ClueDecision> {
    return new Promise((resolve, reject) => {
      this.clue = { resolve, reject };
      this.setRequest({ type: 'clue', view });
      ctx.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  }

  nextGuess(view: OperativeView, ctx: TurnContext): Promise<GuessDecision> {
    return new Promise((resolve, reject) => {
      this.guess = { resolve, reject };
      this.setRequest({ type: 'guess', view });
      ctx.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  }

  submitClue(word: string, number: number): void {
    const p = this.clue;
    if (!p) return;
    this.clue = undefined;
    this.setRequest(null);
    p.resolve({ word, number });
  }

  submitGuess(cardId: number): void {
    const p = this.guess;
    if (!p) return;
    this.guess = undefined;
    this.setRequest(null);
    p.resolve({ type: 'guess', cardId });
  }

  pass(): void {
    const p = this.guess;
    if (!p) return;
    this.guess = undefined;
    this.setRequest(null);
    p.resolve({ type: 'pass' });
  }

  private setRequest(r: HumanRequest): void {
    this.request = r;
    for (const l of this.listeners) l(r);
  }
}
