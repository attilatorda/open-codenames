import { useEffect, useRef, useState } from 'react';
import { AIPlayerError, LLMPlayer } from '@core/ai/LLMPlayer';
import { LLMClientError } from '@core/ai/LLMClient';
import type { ClueSizeMode } from '@core/ai/strategy/clueSize';
import { GameEngine, RuleViolation } from '@core/engine/GameEngine';
import { MatchAborted, MatchController, type ErrorChoice } from '@core/engine/MatchController';
import { HumanPlayer, type HumanRequest } from '@core/players/HumanPlayer';
import type { Activity, Seat } from '@core/players/IPlayer';
import { GameRecorder, type GameRecord, type PlayerRecord } from '@core/replay/GameRecord';
import type { CardKind, GameState, TeamId } from '@core/types';
import { deriveSeed } from '@core/util/rng';
import { play } from '../audio/sfx';
import type { BoardReady } from '../state/nav';
import { PACE_MS, matchLayout, type MatchConfig } from './matchConfig';
import { RemoteLLMClient } from './RemoteLLMClient';

export interface FeedEntry {
  id: number;
  turn: number;
  team: TeamId;
  kind: 'turn' | 'clue' | 'guess' | 'speech' | 'pass' | 'system';
  seatId?: string;
  name?: string;
  text?: string;
  word?: string;
  number?: number;
  coord?: string;
  cardKind?: CardKind;
  correct?: boolean;
}

export interface PendingError {
  seatId: string;
  seatName: string;
  team: TeamId;
  action: 'clue' | 'guess';
  message: string;
  detail?: string;
  choose: (c: ErrorChoice) => void;
}

export interface MatchHandle {
  state: GameState;
  status: { seatId: string; activity: Activity } | null;
  humanRequest: HumanRequest;
  human: HumanPlayer | null;
  feed: FeedEntry[];
  pointing: { cardId: number; seatId: string } | null;
  error: PendingError | null;
  record: GameRecord | null;
  fatal: string | null;
  /** Set while the AI teammate waits for the human to pick its clue size. */
  clueSizeAsk: { choose: (m: ClueSizeMode) => void } | null;
  quit: () => void;
  memoryOf: (seatId: string) => readonly string[];
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

function friendly(err: unknown): { message: string; detail?: string } {
  if (err instanceof LLMClientError) return { message: err.friendly, detail: err.detail };
  if (err instanceof AIPlayerError) return { message: err.friendly, detail: err.detail };
  if (err instanceof RuleViolation) return { message: `The AI tried an illegal move (${err.message}).` };
  return { message: 'Something unexpected went wrong.', detail: (err as Error)?.stack ?? String(err) };
}

export function useMatch(config: MatchConfig, board: BoardReady): MatchHandle {
  const [state, setState] = useState<GameState>(() =>
    new GameEngine({
      id: config.id,
      seed: config.seed,
      layout: matchLayout(config),
      cards: board.cards,
      startingTeam: board.startingTeam,
    }).getState(),
  );
  const [status, setStatus] = useState<MatchHandle['status']>(null);
  const [humanRequest, setHumanRequest] = useState<HumanRequest>(null);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [pointing, setPointing] = useState<MatchHandle['pointing']>(null);
  const [error, setError] = useState<PendingError | null>(null);
  const [record, setRecord] = useState<GameRecord | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [clueSizeAsk, setClueSizeAsk] = useState<MatchHandle['clueSizeAsk']>(null);
  const abortRef = useRef<AbortController | null>(null);
  const humanRef = useRef<HumanPlayer | null>(null);
  const playersRef = useRef(new Map<string, LLMPlayer>());

  useEffect(() => {
    const abort = new AbortController();
    abortRef.current = abort;
    // A fresh engine per effect run (React StrictMode runs effects twice in development).
    const engine = new GameEngine({
      id: config.id,
      seed: config.seed,
      layout: matchLayout(config),
      cards: board.cards,
      startingTeam: board.startingTeam,
    });
    setState(engine.getState());
    setFeed([]);
    setRecord(null);
    setFatal(null);
    let feedId = 0;
    const push = (e: Omit<FeedEntry, 'id'>) => setFeed((f) => [...f, { ...e, id: ++feedId }]);
    const client = new RemoteLLMClient();
    const human = config.seats.some((s) => s.kind === 'human') ? new HumanPlayer('human') : null;
    humanRef.current = human;
    const offHuman = human?.subscribe(setHumanRequest);
    const paceMs = PACE_MS[config.pace];
    const players = new Map<string, LLMPlayer>();
    playersRef.current = players;

    // Before each of its clues, the human's AI teammate waits for the human to pick the clue size.
    const chooseClueSize = (signal: AbortSignal) =>
      new Promise<ClueSizeMode>((resolve, reject) => {
        const onAbort = () => {
          setClueSizeAsk(null);
          reject(new MatchAborted());
        };
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
        setClueSizeAsk({
          choose: (m) => {
            signal.removeEventListener('abort', onAbort);
            setClueSizeAsk(null);
            resolve(m);
          },
        });
      });

    const seats: Seat[] = config.seats.map((sc) => {
      if (sc.kind === 'human') return { id: sc.id, team: sc.team, role: sc.role, name: sc.name, player: human! };
      const slot = board.slots.find((s) => s.slot === sc.slot) ?? board.slots.find((s) => s.ready);
      const humanTeammateSpymaster = sc.team === config.humanTeam && sc.role === 'spymaster';
      const player = new LLMPlayer({
        id: sc.id,
        name: sc.name,
        team: sc.team,
        role: sc.role,
        slot: slot?.slot ?? 0,
        modelLabel: slot ? `${slot.providerName} · ${slot.modelLabel}` : 'unknown',
        client,
        seed: deriveSeed(config.seed, sc.id),
        chooseClueSize: humanTeammateSpymaster ? chooseClueSize : undefined,
        riskBias: config.riskBias,
      });
      players.set(sc.id, player);
      return { id: sc.id, team: sc.team, role: sc.role, name: sc.name, player };
    });
    const operativeOf = (team: TeamId) => seats.find((s) => s.team === team && s.role === 'operative')!;
    const spymasterOf = (team: TeamId) => seats.find((s) => s.team === team && s.role === 'spymaster')!;

    const playerRecords: PlayerRecord[] = config.seats.map((sc) => {
      const slot = board.slots.find((s) => s.slot === sc.slot);
      return {
        seatId: sc.id,
        team: sc.team,
        role: sc.role,
        kind: sc.kind,
        name: sc.name,
        provider: sc.kind === 'ai' ? slot?.providerName : undefined,
        model: sc.kind === 'ai' ? slot?.model : undefined,
      };
    });
    const recorder = new GameRecorder({
      state: engine.getState(),
      modeId: config.modeId,
      styleId: config.styleId,
      humanTeam: config.humanTeam,
      players: playerRecords,
    });

    const reasons = new Map<number, string | undefined>();
    const coordOf = (id: number) => engine.getState().cards[id]?.coord ?? '?';

    push({ kind: 'turn', turn: 1, team: board.startingTeam });

    const unsubscribe = engine.subscribe((s, e) => {
      setState(s);
      if (!e) return;
      recorder.onEvent(e);
      if (e.type === 'clue') {
        play('clue');
        const sm = spymasterOf(e.team);
        push({ kind: 'clue', turn: e.turn, team: e.team, seatId: sm.id, name: sm.name, word: e.word, number: e.number });
      } else if (e.type === 'guess') {
        play('flip');
        setTimeout(() => play(e.kind === 'ASSASSIN' ? 'assassin' : e.correct ? 'correct' : e.kind === 'NEUTRAL' ? 'neutral' : 'opponent'), 260);
        const op = operativeOf(e.team);
        push({
          kind: 'guess',
          turn: e.turn,
          team: e.team,
          seatId: op.id,
          name: op.name,
          coord: e.coord,
          cardKind: e.kind,
          correct: e.correct,
          text: reasons.get(e.cardId),
        });
      } else if (e.type === 'turnEnd') {
        if (e.reason === 'skipped') push({ kind: 'system', turn: e.turn, team: e.team, text: 'Turn skipped.' });
        if (s.phase !== 'over') {
          play('turn');
          push({ kind: 'turn', turn: s.turn.number, team: s.turn.team });
        }
      } else if (e.type === 'gameOver') {
        const youWin = config.spectator || e.winner === config.humanTeam;
        setTimeout(() => play(youWin ? 'win' : 'lose'), e.reason === 'assassin' ? 900 : 350);
      }
    });

    const controller = new MatchController(
      engine,
      seats,
      {
        onStatus: (st) => setStatus(st ? { seatId: st.seat.id, activity: st.activity } : null),
        onSpeech: (seat, text) => {
          const turn = engine.getState().turn.number;
          recorder.onSpeech(seat, text, turn);
          push({ kind: 'speech', turn, team: seat.team, seatId: seat.id, name: seat.name, text });
        },
        onClue: (seat, d, turn) => recorder.onClue(seat, d, turn, coordOf),
        onGuessDecision: (seat, d, turn) => {
          recorder.onGuessDecision(seat, d, turn);
          if (d.type === 'guess') reasons.set(d.cardId, d.reason);
          else push({ kind: 'pass', turn, team: seat.team, seatId: seat.id, name: seat.name, text: d.reason });
        },
        beforeReveal: async (seat, cardId) => {
          setPointing({ cardId, seatId: seat.id });
          await sleep(paceMs, abort.signal);
          setPointing(null);
        },
        pace: async () => sleep(paceMs * 0.6, abort.signal),
        onError: (seat, err, action) =>
          new Promise<ErrorChoice>((resolve) => {
            play('error');
            const f = friendly(err);
            setError({
              seatId: seat.id,
              seatName: seat.name,
              team: seat.team,
              action,
              ...f,
              choose: (c) => {
                setError(null);
                resolve(c);
              },
            });
          }),
      },
      abort.signal,
    );

    const finish = (aborted: boolean) => {
      if (aborted) recorder.markAborted();
      const rec = recorder.snapshot();
      if (!aborted || rec.turns.some((t) => t.clue)) void window.oc.replays.save(rec).catch(() => undefined);
      return rec;
    };

    controller
      .run()
      .then(() => {
        if (abort.signal.aborted) return;
        setStatus(null);
        setRecord(finish(false));
      })
      .catch((err) => {
        if (err instanceof MatchAborted || abort.signal.aborted) {
          finish(true);
          return;
        }
        setFatal(friendly(err).message);
      });

    return () => {
      abort.abort();
      unsubscribe();
      offHuman?.();
    };
  }, [config.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    state,
    status,
    humanRequest,
    human: humanRef.current,
    feed,
    pointing,
    error,
    record,
    fatal,
    clueSizeAsk,
    quit: () => abortRef.current?.abort(),
    memoryOf: (seatId) => playersRef.current.get(seatId)?.memory ?? [],
  };
}
