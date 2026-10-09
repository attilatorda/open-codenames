import { useEffect, useMemo, useRef, useState } from 'react';
import { StandardRules } from '@core/rules/rules';
import { TEAM_NAMES } from '@core/teams';
import type { TeamId } from '@core/types';
import type { SlotInfo } from '@shared/ipc';
import { Avatar } from '../components/ui';
import type { MatchConfig } from './matchConfig';
import type { FeedEntry } from './useMatch';
import { kindClass, kindName, teamClass } from './text';
import { play } from '../audio/sfx';

const rules = new StandardRules();

/** One team's player board: name, pictures found, and its two players. */
export function TeamBoard({
  team,
  config,
  remaining,
  total,
  active,
  activeSeatId,
  slots,
}: {
  team: TeamId;
  config: MatchConfig;
  remaining: number;
  total: number;
  active: boolean;
  activeSeatId?: string;
  slots: SlotInfo[];
}) {
  const seats = config.seats.filter((s) => s.team === team).sort((a) => (a.role === 'spymaster' ? -1 : 1));
  const found = total - remaining;
  return (
    <section className={`player-board ${teamClass(team)}${active ? ' active' : ''}`} data-testid={`team-${team}`}>
      <header className="player-board-head">
        <span className="team-name">{TEAM_NAMES[team]}</span>
        {team === config.humanTeam && <span className="tiny muted">your team</span>}
        <div className="spacer" />
        <span className="team-score" title={`${found} of ${total} found · ${remaining} left`}>
          <span className="score-icon" aria-hidden="true" />
          <strong>{found}</strong>
          <span className="muted">/{total}</span>
        </span>
      </header>
      <div className="seat-list">
        {seats.map((s) => {
          const slot = slots.find((x) => x.slot === s.slot);
          const isActive = s.id === activeSeatId;
          return (
            <div key={s.id} className={`seat${isActive ? ' active' : ''}`}>
              <Avatar name={s.name} team={s.team} human={s.kind === 'human'} size="sm" />
              <div className="seat-text">
                <div className="seat-name">
                  <span className={`t-${teamClass(s.team)}`}>{s.kind === 'human' ? 'You' : s.name}</span>
                  <span className="seat-role">{s.role}</span>
                </div>
                <div className="seat-meta">{s.kind === 'human' ? 'Human' : slot?.modelLabel ?? '—'}</div>
              </div>
              {isActive && <span className="seat-turn" aria-label="Playing now" />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The game log, newest entry first. */
export function GameLog({ entries }: { entries: FeedEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [entries.length]);
  const name = (e: FeedEntry) => <span className={`log-name t-${teamClass(e.team)}`}>{e.name}</span>;
  /** "You give" / "Ada gives". */
  const verb = (e: FeedEntry, base: string, third: string) => (e.name === 'You' ? base : third);
  return (
    <section className="game-log">
      <div className="game-log-body" ref={ref} data-testid="feed">
        {[...entries].reverse().map((e) => {
          switch (e.kind) {
            case 'turn':
              return (
                <div key={e.id} className="log-turn">
                  Turn {e.turn} · <span className={`t-${teamClass(e.team)}`}>{TEAM_NAMES[e.team]}</span>
                </div>
              );
            case 'clue':
              return (
                <div key={e.id} className="log-entry">
                  {name(e)} {verb(e, 'give', 'gives')} the clue{' '}
                  <span className="log-clue">
                    {e.word?.toUpperCase()} {e.number}
                  </span>
                </div>
              );
            case 'guess':
              return (
                <div key={e.id} className="log-entry">
                  {name(e)} {verb(e, 'reveal', 'reveals')} <span className="mono">{e.coord}</span>:{' '}
                  <span className={`kind-tag kind-${kindClass(e.cardKind!)}`}>{kindName(e.cardKind!)}</span>
                  {e.text && <div className="log-quote">“{e.text}”</div>}
                </div>
              );
            case 'speech':
              return (
                <div key={e.id} className="log-entry">
                  {name(e)}: <span className="log-quote">“{e.text}”</span>
                </div>
              );
            case 'pass':
              return (
                <div key={e.id} className="log-entry">
                  {name(e)} {verb(e, 'end', 'ends')} the turn
                  {e.text && <div className="log-quote">“{e.text}”</div>}
                </div>
              );
            default:
              return (
                <div key={e.id} className="log-entry log-system">
                  {e.text}
                </div>
              );
          }
        })}
      </div>
    </section>
  );
}

/** The spymaster's clue form, shown inside the status bar. */
export function ClueInput({ teamRemaining, onSubmit }: { teamRemaining: number; onSubmit: (word: string, n: number) => void }) {
  const [word, setWord] = useState('');
  const [n, setN] = useState(Math.min(2, teamRemaining));
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const v = useMemo(() => rules.validateClue(word, n, teamRemaining), [word, n, teamRemaining]);
  useEffect(() => inputRef.current?.focus(), []);
  const submit = () => {
    setTouched(true);
    if (!v.ok) {
      play('error');
      return;
    }
    onSubmit(word.trim(), n);
  };
  return (
    <span className="clue-input" data-testid="clue-input">
      <input
        ref={inputRef}
        className="input clue-word"
        placeholder="Clue word"
        value={word}
        maxLength={32}
        onChange={(e) => setWord(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        aria-label="Clue word"
        data-testid="clue-word"
      />
      <span className="stepper" aria-label="Number of pictures">
        <button type="button" onClick={() => setN((x) => Math.max(1, x - 1))} aria-label="Fewer">
          −
        </button>
        <span className="mono" data-testid="clue-number">
          {n}
        </span>
        <button type="button" onClick={() => setN((x) => Math.min(Math.min(9, teamRemaining), x + 1))} aria-label="More">
          +
        </button>
      </span>
      <button className="btn btn-sm btn-primary" onClick={submit} data-testid="clue-submit">
        Give clue
      </button>
      {touched && !v.ok && <span className="input-error">{v.error}</span>}
    </span>
  );
}
