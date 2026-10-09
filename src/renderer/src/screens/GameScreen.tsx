import { useEffect, useMemo, useState } from 'react';
import type { ClueSizeMode } from '@core/ai/strategy/clueSize';
import { buildOperativeView, buildSpymasterView } from '@core/engine/views';
import { TEAM_NAMES } from '@core/teams';
import type { TeamId } from '@core/types';
import { useApp } from '../state/AppContext';
import type { BoardReady } from '../state/nav';
import type { MatchConfig } from '../game/matchConfig';
import { swappedRoles } from '../game/matchConfig';
import { useMatch } from '../game/useMatch';
import { Board, type BoardCard } from '../game/Board';
import { ClueInput, GameLog, TeamBoard } from '../game/GameParts';
import { describeActivity, teamClass, winLine } from '../game/text';
import { ClueSizeButtons } from '../components/pickers';
import { Icon } from '../components/Icon';
import { Dots, Modal, TechDetails, Toggle } from '../components/ui';
import { play } from '../audio/sfx';

export function GameScreen({ config, board }: { config: MatchConfig; board: BoardReady }) {
  const { navigate, updateSettings } = useApp();
  const m = useMatch(config, board);
  const { state } = m;
  const [selected, setSelected] = useState<number | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [paused, setPaused] = useState(false);
  const [dismissedOver, setDismissedOver] = useState(false);
  const [clueSize, setClueSize] = useState<ClueSizeMode>(config.clueSize);

  const humanSeat = config.seats.find((s) => s.kind === 'human');
  const over = state.phase === 'over';
  const activeTeam = state.turn.team;
  const clue = state.turn.clue;
  const remaining = useMemo(() => {
    let A = 0;
    let B = 0;
    for (const c of state.cards) if (!c.revealed) c.kind === 'A' ? A++ : c.kind === 'B' ? B++ : null;
    return { A, B };
  }, [state.cards]);
  const totals = useMemo(() => {
    const t = { A: 0, B: 0 };
    for (const c of state.cards) if (c.kind === 'A' || c.kind === 'B') t[c.kind]++;
    return t;
  }, [state.cards]);

  // Information boundary in the UI: the board is rendered from the human's role view.
  const cards: BoardCard[] = useMemo(() => {
    const keyVisible = over || humanSeat?.role === 'spymaster' || (config.spectator && showKey);
    if (keyVisible) {
      const v = buildSpymasterView(state, humanSeat?.team ?? 'A');
      return v.cards.map((c) => ({ id: c.id, coord: c.coord, imageId: c.imageId, revealed: c.revealed, revealedKind: c.revealedKind, secret: c.kind }));
    }
    const v = buildOperativeView(state, humanSeat?.team ?? 'A');
    return v.cards.map((c) => ({ id: c.id, coord: c.coord, imageId: c.imageId, revealed: c.revealed, revealedKind: c.revealedKind }));
  }, [state, humanSeat, over, config.spectator, showKey]);

  const request = m.humanRequest;
  const guessing = request?.type === 'guess';
  const statusSeat = m.status ? config.seats.find((s) => s.id === m.status!.seatId) : undefined;
  const humanGaveClue = !!clue && humanSeat?.role === 'spymaster' && clue.team === humanSeat.team;
  const statusText = statusSeat && m.status ? describeActivity(statusSeat, m.status.activity, config, humanGaveClue) : '';
  const pointingSeat = m.pointing ? config.seats.find((s) => s.id === m.pointing!.seatId) : undefined;
  const teammate = humanSeat ? config.seats.find((s) => s.team === humanSeat.team && s.id !== humanSeat.id) : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !m.error) setPaused((p) => !p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [m.error]);

  const quit = () => {
    m.quit();
    navigate({ name: 'menu' });
  };

  const chooseClueSize = (size: ClueSizeMode) => {
    setClueSize(size);
    m.clueSizeAsk?.choose(size);
    void updateSettings({ gameplay: { clueSize: size } });
  };

  const guessesLeft = state.turn.maxGuesses - state.turn.guessesMade;
  const result = over && state.winner && state.winReason ? winLine(state.winner, state.winReason, config.humanTeam) : null;
  const playAgain = () => navigate({ name: 'loading', config: swappedRoles(config) });

  return (
    <div className={`game${config.spectator ? ' spectator' : ''}`} data-testid="game">
      <div className="game-main">
        <div className="status-bar" data-testid="clue-banner">
          {state.phase === 'guess' && clue && !over && (
            <span className={`clue-plate ${teamClass(clue.team)}`} title={`${TEAM_NAMES[clue.team]} clue`}>
              <span data-testid="current-clue">{clue.word.toUpperCase()}</span>
              <span className="clue-plate-num">{clue.number}</span>
            </span>
          )}
          {over && result ? (
            <>
              <span className="status-text">
                <strong>End of game: {result.title}.</strong> {result.sub}
              </span>
              <span className="action-buttons">
                {m.record && (
                  <button className="btn btn-sm" onClick={() => navigate({ name: 'debrief', record: m.record!, config })} data-testid="see-debrief">
                    Debrief
                  </button>
                )}
                <button className="btn btn-sm btn-primary" onClick={playAgain}>
                  {config.humanTeam ? 'Play again (swap roles)' : 'Play again'}
                </button>
              </span>
            </>
          ) : m.clueSizeAsk ? (
            <>
              <span className="status-text">Clue size for {teammate?.name ?? 'your teammate'}:</span>
              <ClueSizeButtons value={clueSize} onChoose={chooseClueSize} />
            </>
          ) : request?.type === 'clue' && humanSeat ? (
            <>
              <span className="status-text">You must give a clue:</span>
              <ClueInput
                teamRemaining={humanSeat.team === 'A' ? remaining.A : remaining.B}
                onSubmit={(w, n) => {
                  play('click');
                  m.human?.submitClue(w, n);
                }}
              />
            </>
          ) : guessing ? (
            <>
              <span className="status-text">
                You must pick a picture <span className="muted">({guessesLeft} left)</span>
              </span>
              <span className="action-buttons">
                <button
                  className="btn btn-sm"
                  disabled={state.turn.guessesMade === 0}
                  onClick={() => {
                    play('click');
                    setSelected(null);
                    m.human?.pass();
                  }}
                  data-testid="end-turn"
                >
                  End turn
                </button>
              </span>
            </>
          ) : (
            <span className="status-text">
              {statusText || 'Dealing the board'}
              {statusSeat?.kind !== 'human' && <Dots />}
            </span>
          )}
        </div>

        <Board
          cards={cards}
          rows={state.layout.rows}
          cols={state.layout.cols}
          selectable={guessing}
          selected={selected}
          onSelect={setSelected}
          onConfirm={(id) => {
            setSelected(null);
            m.human?.submitGuess(id);
          }}
          pointing={m.pointing && pointingSeat ? { cardId: m.pointing.cardId, name: pointingSeat.name, team: pointingSeat.team } : null}
        />
      </div>

      <aside className="game-right">
        <div className="game-tools">
          {config.spectator && (
            <label className="row small">
              <Toggle checked={showKey} onChange={setShowKey} label="Show key" /> Show key
            </label>
          )}
          <div className="spacer" />
          <button className="btn btn-sm" onClick={() => setPaused(true)} data-testid="pause">
            <Icon name="menu" size={14} /> Menu
          </button>
        </div>
        {(['A', 'B'] as const).map((team) => (
          <TeamBoard
            key={team}
            team={team}
            config={config}
            remaining={remaining[team]}
            total={totals[team]}
            active={!over && activeTeam === team}
            activeSeatId={m.status?.seatId}
            slots={board.slots}
          />
        ))}
        <GameLog entries={m.feed} />
      </aside>

      {over && result && !dismissedOver && (
        <Modal onClose={() => setDismissedOver(true)}>
          <div className="game-over" data-testid="game-over">
            <h2 className={`h2 ${config.spectator ? `t-${teamClass(state.winner!)}` : state.winner === config.humanTeam ? 'win' : 'lose'}`}>{result.title}</h2>
            <p>{result.sub}</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setDismissedOver(true)}>
                View board
              </button>
              {m.record && (
                <button className="btn" onClick={() => navigate({ name: 'debrief', record: m.record!, config })}>
                  Debrief
                </button>
              )}
              <button className="btn" onClick={() => navigate({ name: 'menu' })}>
                Menu
              </button>
              <button className="btn btn-primary" onClick={playAgain}>
                Play again
              </button>
            </div>
          </div>
        </Modal>
      )}

      {m.error && (
        <Modal>
          <h2 className="h2">
            {m.error.seatName} ({TEAM_NAMES[m.error.team as TeamId]} {m.error.action === 'clue' ? 'spymaster' : 'operative'}) couldn’t continue
          </h2>
          <p>{m.error.message}</p>
          <TechDetails detail={m.error.detail} />
          <div className="modal-actions">
            <button
              className="btn"
              onClick={() => {
                m.error!.choose('quit');
                navigate({ name: 'menu' });
              }}
            >
              Quit to menu
            </button>
            <button className="btn" onClick={() => m.error!.choose('skip')}>
              Skip this turn
            </button>
            <button className="btn btn-primary" onClick={() => m.error!.choose('retry')} data-testid="error-retry">
              Retry
            </button>
          </div>
        </Modal>
      )}

      {m.fatal && (
        <Modal>
          <h2 className="h2">The game stopped</h2>
          <p>{m.fatal}</p>
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => navigate({ name: 'menu' })}>
              Main menu
            </button>
          </div>
        </Modal>
      )}

      {paused && (
        <Modal onClose={() => setPaused(false)}>
          <h2 className="h2">Game menu</h2>
          <div className="modal-actions">
            <button className="btn btn-danger" onClick={quit} data-testid="quit-game">
              Quit game
            </button>
            <button className="btn btn-primary" onClick={() => setPaused(false)}>
              Resume
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
