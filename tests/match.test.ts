import { describe, expect, it } from 'vitest';
import { LLMPlayer, AIPlayerError } from '@core/ai/LLMPlayer';
import type { LLMClient, LLMRequest } from '@core/ai/LLMClient';
import { mockBrainReply } from '@core/ai/mockBrain';
import { MatchController } from '@core/engine/MatchController';
import { buildOperativeView, buildSpymasterView } from '@core/engine/views';
import { GameRecorder } from '@core/replay/GameRecord';
import type { Seat, TurnContext } from '@core/players/IPlayer';
import { HumanPlayer } from '@core/players/HumanPlayer';
import type { Role, TeamId } from '@core/types';
import { makeEngine } from './helpers';

const mockClient: LLMClient = {
  async complete(req) {
    return { text: mockBrainReply(req), model: 'mock' };
  },
};

function aiSeat(team: TeamId, role: Role, client: LLMClient = mockClient, seed = 1): Seat {
  const id = `${team}-${role}`;
  return {
    id,
    team,
    role,
    name: id,
    player: new LLMPlayer({
      id,
      team,
      role,
      name: id,
      slot: 0,
      modelLabel: 'mock',
      client,
      seed,
    }),
  };
}

const ctx = (): TurnContext => ({ signal: new AbortController().signal, status: () => {}, say: () => {} });

describe('LLM player', () => {
  it('gives a legal clue whose number matches its intended targets', async () => {
    const engine = makeEngine(8);
    const s = engine.getState();
    const seat = aiSeat(s.turn.team, 'spymaster');
    const view = buildSpymasterView(s, s.turn.team);
    const d = await seat.player.giveClue(view, ctx());
    expect(d.number).toBe(d.intendedTargets!.length);
    for (const id of d.intendedTargets!) expect(s.cards[id].kind).toBe(s.turn.team);
    expect(() => engine.giveClue(s.turn.team, d.word, d.number)).not.toThrow();
    expect(d.meta?.sizeReason).toMatch(/Opening policy/);
  });

  it('retries once when the model replies with garbage, then succeeds', async () => {
    let calls = 0;
    const flaky: LLMClient = {
      async complete(req: LLMRequest) {
        calls++;
        if (calls === 1) return { text: 'Hmm, let me think. I like B2!', model: 'mock' };
        // The corrective turn is the last user message; answer the original task.
        const original = { ...req, messages: [req.messages[0]] };
        return { text: mockBrainReply(original), model: 'mock' };
      },
    };
    const engine = makeEngine(9);
    const s = engine.getState();
    const seat = aiSeat(s.turn.team, 'spymaster', flaky);
    await seat.player.giveClue(buildSpymasterView(s, s.turn.team), ctx());
    // Garbage, then a valid clue reply, then the teammate prediction.
    expect(calls).toBe(3);
  });

  it('raises a friendly error when the model never produces usable output', async () => {
    const broken: LLMClient = { complete: async () => ({ text: 'no', model: 'mock' }) };
    const engine = makeEngine(9);
    const s = engine.getState();
    const seat = aiSeat(s.turn.team, 'spymaster', broken);
    await expect(seat.player.giveClue(buildSpymasterView(s, s.turn.team), ctx())).rejects.toBeInstanceOf(AIPlayerError);
  });

  it('never repeats a clue already given this game', async () => {
    const engine = makeEngine(8);
    const team = engine.getState().turn.team;
    const other = team === 'A' ? 'B' : 'A';
    // Earlier turns: this team said OCEAN, the opponents said FOREST.
    engine.giveClue(team, 'ocean', 1);
    engine.skipTurn(team);
    engine.giveClue(other, 'forest', 1);
    engine.skipTurn(other);
    const s = engine.getState();
    const mine = s.cards.filter((c) => c.kind === team && !c.revealed).map((c) => c.coord);
    const prompts: string[] = [];
    const repeating: LLMClient = {
      async complete(req) {
        prompts.push(JSON.stringify(req.messages));
        const candidates = ['Ocean', 'forests', 'ocean'].map((clue, i) => ({ clue, targets: [{ card: mine[i], strength: 0.95 }], risks: [] }));
        // Second attempt (after being told the repeats are not allowed): a fresh word.
        if (prompts.length > 1) candidates.push({ clue: 'harbor', targets: [{ card: mine[0], strength: 0.6 }], risks: [] });
        return { text: JSON.stringify({ candidates }), model: 'mock' };
      },
    };
    const seat = aiSeat(team, 'spymaster', repeating);
    const d = await seat.player.giveClue(buildSpymasterView(s, team), ctx());
    expect(d.word).toBe('harbor');
    expect(prompts[0]).toContain('Clues already used (do not repeat any of them): OCEAN, FOREST');
    expect(prompts[1]).toMatch(/no clue given earlier this game may be repeated/);
  });

  it('asks for the clue size before every clue when a human teammate chooses it', async () => {
    const engine = makeEngine(8);
    const s = engine.getState();
    const asked: string[] = [];
    const player = new LLMPlayer({
      id: 'teammate',
      name: 'teammate',
      team: s.turn.team,
      role: 'spymaster',
      slot: 0,
      modelLabel: 'mock',
      client: mockClient,
      seed: 3,
      chooseClueSize: async () => {
        asked.push('size');
        return 1;
      },
    });
    const d = await player.giveClue(buildSpymasterView(s, s.turn.team), ctx());
    expect(asked).toEqual(['size']);
    expect(d.meta?.desiredSize).toBe(1);
    expect(d.meta?.sizeReason).toMatch(/Player setting/);
  });

  it('the operative makes one model call per turn and guesses only hidden cards', async () => {
    let calls = 0;
    const counting: LLMClient = {
      async complete(req) {
        calls++;
        return { text: mockBrainReply(req), model: 'mock' };
      },
    };
    const engine = makeEngine(10);
    const team = engine.getState().turn.team;
    engine.giveClue(team, 'ocean', 3);
    const seat = aiSeat(team, 'operative', counting);
    for (let i = 0; i < 4 && engine.getState().phase === 'guess' && engine.getState().turn.team === team; i++) {
      const d = await seat.player.nextGuess(buildOperativeView(engine.getState(), team), ctx());
      if (d.type === 'pass') {
        engine.pass(team);
        break;
      }
      expect(engine.getState().cards[d.cardId].revealed).toBe(false);
      engine.guess(team, d.cardId);
    }
    expect(calls).toBe(1);
  });
});

describe('full match', () => {
  it.each([13, 52, 91])('four AI players finish a game without repeating a clue (board %i)', async (seed) => {
    const engine = makeEngine(seed);
    const seats = [
      aiSeat('A', 'spymaster', mockClient, 1),
      aiSeat('A', 'operative', mockClient, 2),
      aiSeat('B', 'spymaster', mockClient, 3),
      aiSeat('B', 'operative', mockClient, 4),
    ];
    const recorder = new GameRecorder({
      state: engine.getState(),
      modeId: 'ai-vs-ai',
      players: seats.map((s) => ({ seatId: s.id, team: s.team, role: s.role, kind: 'ai', name: s.name })),
    });
    engine.subscribe((_s, e) => e && recorder.onEvent(e));
    const coordOf = (id: number) => engine.getState().cards[id].coord;
    const controller = new MatchController(engine, seats, {
      onClue: (seat, d, turn) => recorder.onClue(seat, d, turn, coordOf),
      onGuessDecision: (seat, d, turn) => recorder.onGuessDecision(seat, d, turn),
    });
    const final = await controller.run();
    expect(final.phase).toBe('over');
    expect(final.winner).toBeDefined();
    const record = recorder.snapshot();
    expect(record.winner).toBe(final.winner);
    expect(record.turns.length).toBeGreaterThan(0);
    const withClue = record.turns.filter((t) => t.clue);
    expect(withClue.every((t) => t.clue!.intendedTargets!.length === t.clue!.number)).toBe(true);
    const words = withClue.map((t) => t.clue!.word);
    expect(new Set(words).size).toBe(words.length);
  });

  it('routes AI failures to the error hook and can skip the turn', async () => {
    const engine = makeEngine(77);
    const broken: LLMClient = {
      async complete() {
        throw new Error('network down');
      },
    };
    const start = engine.getState().turn.team;
    const other = start === 'A' ? 'B' : 'A';
    const seats = [
      aiSeat(start, 'spymaster', broken),
      aiSeat(start, 'operative'),
      aiSeat(other, 'spymaster'),
      aiSeat(other, 'operative'),
    ];
    const errors: string[] = [];
    const abort = new AbortController();
    const controller = new MatchController(
      engine,
      seats,
      {
        onError: async (seat, err) => {
          errors.push(`${seat.id}:${(err as Error).message}`);
          return errors.length > 2 ? 'quit' : 'skip';
        },
      },
      abort.signal,
    );
    // The other (random mock) team may finish the game before the third outage; either ending is fine.
    const outcome = await controller.run().then(
      () => 'finished',
      (e: Error) => e.message,
    );
    expect(['finished', 'Match aborted']).toContain(outcome);
    expect(errors[0]).toBe(`${start}-spymaster:network down`);
    expect(engine.getState().events.some((e) => e.type === 'turnEnd' && e.reason === 'skipped')).toBe(true);
  });

  it('waits for a human and accepts UI input', async () => {
    const engine = makeEngine(5);
    const start = engine.getState().turn.team;
    const other = start === 'A' ? 'B' : 'A';
    const human = new HumanPlayer('human');
    const seats: Seat[] = [
      { id: 'human', team: start, role: 'spymaster', name: 'You', player: human },
      aiSeat(start, 'operative'),
      aiSeat(other, 'spymaster'),
      aiSeat(other, 'operative'),
    ];
    const abort = new AbortController();
    const controller = new MatchController(engine, seats, {}, abort.signal);
    const run = controller.run();
    let requests = 0;
    const secondRequest = new Promise<void>((resolve) => {
      human.subscribe((r) => {
        if (r?.type !== 'clue') return;
        requests++;
        if (requests === 1) queueMicrotask(() => human.submitClue('ocean', 2));
        else resolve();
      });
    });
    // The AI operative and the opponents play until it is the human's turn again.
    await secondRequest;
    abort.abort();
    await expect(run).rejects.toThrow('Match aborted');
    expect(engine.getState().events[0]).toMatchObject({ type: 'clue', word: 'ocean', number: 2 });
    expect(engine.getState().phase).not.toBe('over');
  });
});
