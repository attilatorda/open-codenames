import { useMemo, useState } from 'react';
import type { GameRecord, TurnRecord } from '@core/replay/GameRecord';
import { TEAM_NAMES } from '@core/teams';
import { useApp } from '../state/AppContext';
import type { MatchConfig } from '../game/matchConfig';
import { swappedRoles } from '../game/matchConfig';
import { kindClass, kindName, teamClass, winLine } from '../game/text';
import { Avatar } from '../components/ui';
import { imageSrc } from '../imageSrc';

export function DebriefScreen({ record, config }: { record: GameRecord; config?: MatchConfig }) {
  const { navigate } = useApp();
  const cardByCoord = useMemo(() => new Map(record.cards.map((c) => [c.coord, c])), [record]);
  const result = record.winner && record.winReason ? winLine(record.winner, record.winReason, record.humanTeam) : null;
  const playerOf = (team: string, role: string) => record.players.find((p) => p.team === team && p.role === role);
  const stats = useMemo(() => computeStats(record), [record]);

  return (
    <div className="page page-wide debrief">
      <div className="status-bar debrief-bar" data-testid="debrief">
        <span className="status-text">
          <strong>{record.aborted ? 'Unfinished game' : result?.title ?? 'Game over'}.</strong>
          {result && !record.aborted && <> {result.sub}</>}
          <span className="muted small"> · {new Date(record.createdAt).toLocaleString()}</span>
        </span>
        {config && (
          <span className="action-buttons">
            <button className="btn btn-sm btn-primary" onClick={() => navigate({ name: 'loading', config: swappedRoles(config) })}>
              {config.humanTeam ? 'Play again (swap roles)' : 'Play again'}
            </button>
          </span>
        )}
      </div>

      <div className="debrief-grid">
        <aside className="debrief-side">
          <section className="section">
            <h2 className="section-title">The key</h2>
            <div className="mini-board" style={{ gridTemplateColumns: `repeat(${record.cols}, 1fr)` }}>
              {record.cards.map((c) => (
                <div key={c.id} className={`mini-card kind-${kindClass(c.kind)}`} title={`${c.coord} · ${kindName(c.kind)}${c.concept ? ` · ${c.concept}` : ''}`}>
                  <img src={imageSrc(c.imageId)} alt="" />
                  <span className="mono">{c.coord}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="section">
            <h2 className="section-title">Players</h2>
            {record.players.map((p) => {
              const s = stats.get(p.seatId);
              return (
                <div key={p.seatId} className="debrief-player">
                  <Avatar human={p.kind === 'human'} name={p.name} team={p.team} size="sm" />
                  <div style={{ flex: 1 }}>
                    <div className="small">
                      <strong className={`t-${teamClass(p.team)}`}>{p.name}</strong> <span className="muted">{TEAM_NAMES[p.team]} {p.role}</span>
                    </div>
                    <div className="tiny muted">
                      {p.kind === 'human' ? 'Human' : `${(p.provider ?? '').replace(/\s*\(.*\)/, '')} ${p.model ?? ''}`}
                    </div>
                  </div>
                  {s && <div className="tiny mono muted">{s}</div>}
                </div>
              );
            })}
          </section>
        </aside>

        <section className="debrief-timeline">
          {record.turns.length === 0 && <div className="muted">No turns were played.</div>}
          {record.turns.map((t) => (
            <TurnCard key={t.turn} turn={t} spymaster={playerOf(t.team, 'spymaster')?.name} operative={playerOf(t.team, 'operative')?.name} cardByCoord={cardByCoord} />
          ))}
        </section>
      </div>
    </div>
  );
}

function TurnCard({
  turn,
  spymaster,
  operative,
  cardByCoord,
}: {
  turn: TurnRecord;
  spymaster?: string;
  operative?: string;
  cardByCoord: Map<string, GameRecord['cards'][number]>;
}) {
  const [open, setOpen] = useState(false);
  const intended = new Set(turn.clue?.intendedTargets ?? []);
  const found = turn.guesses.filter((g) => intended.has(g.coord)).length;
  const meta = turn.clue?.meta;
  return (
    <article className={`turn-card section ${teamClass(turn.team)}`}>
      <header className="turn-card-head">
        <span className={`strong t-${teamClass(turn.team)}`}>{TEAM_NAMES[turn.team]}</span>
        <span className="muted small">Turn {turn.turn}</span>
        {turn.clue ? (
          <span className="turn-clue">
            {turn.clue.word.toUpperCase()} <span className="mono">{turn.clue.number}</span>
          </span>
        ) : (
          <span className="muted small">No clue (skipped)</span>
        )}
        <span className="small muted">by {spymaster}</span>
        <div className="spacer" />
        {turn.endReason && <span className="pill tiny">ended: {endLabel(turn.endReason)}</span>}
      </header>

      {turn.clue?.intendedTargets && (
        <div className="turn-row">
          <span className="turn-label">Meant</span>
          <div className="thumbs">
            {turn.clue.intendedTargets.map((coord) => {
              const c = cardByCoord.get(coord);
              const hit = turn.guesses.some((g) => g.coord === coord);
              return c ? (
                <div key={coord} className={`thumb ${hit ? 'hit' : 'miss'}`} title={c.concept}>
                  <img src={imageSrc(c.imageId)} alt="" />
                  <span className="mono">{coord}</span>
                </div>
              ) : null;
            })}
          </div>
          <span className="small muted">
            {found}/{turn.clue.intendedTargets.length} found
          </span>
        </div>
      )}

      <div className="turn-row">
        <span className="turn-label">Picked</span>
        <div className="col" style={{ gap: 6, flex: 1 }}>
          {turn.guesses.length === 0 && <span className="small muted">Nothing</span>}
          {turn.guesses.map((g) => {
            const c = cardByCoord.get(g.coord);
            return (
              <div key={g.coord} className="pick-line">
                {c && <img className="pick-thumb" src={imageSrc(c.imageId)} alt="" />}
                <span className="mono small">{g.coord}</span>
                <span className={`kind-tag kind-${kindClass(g.kind)}`}>{kindName(g.kind)}</span>
                {intended.has(g.coord) && <span className="result-tag good">as intended</span>}
                {g.confidence !== undefined && <span className="tiny muted mono">{Math.round(g.confidence * 100)}% sure</span>}
                {g.reason && <span className="small feed-quote">“{g.reason}”</span>}
              </div>
            );
          })}
          {turn.pass && (
            <div className="small muted">
              {operative} stopped{turn.pass.reason ? `: “${turn.pass.reason}”` : ''}
              {turn.pass.notes ? <span className="tiny dim"> ({turn.pass.notes})</span> : null}
            </div>
          )}
        </div>
      </div>

      {(turn.clue?.rationale || meta) && (
        <div className="turn-row">
          <span className="turn-label">Why</span>
          <div className="col" style={{ gap: 6, flex: 1 }}>
            {turn.clue?.rationale && <span className="small">“{turn.clue.rationale}”</span>}
            {meta?.sizeReason && (
              <span className="tiny muted">
                Strategy: aimed for {meta.desiredSize} — {meta.sizeReason}
                {meta.sizeDistribution && (
                  <> · odds {Object.entries(meta.sizeDistribution).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${Math.round(v * 100)}%`).join(', ')}</>
                )}
              </span>
            )}
            {meta?.candidates && meta.candidates.length > 0 && (
              <>
                <button className="link-btn tiny" onClick={() => setOpen((o) => !o)}>
                  {open ? 'Hide' : 'Show'} the {meta.candidates.length} clues it considered
                </button>
                {open && (
                  <table className="cand-table">
                    <thead>
                      <tr>
                        <th>Clue</th>
                        <th>Targets</th>
                        <th>Score</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {meta.candidates.map((c, i) => (
                        <tr key={i} className={c.clue === turn.clue?.word ? 'chosen' : ''}>
                          <td className="mono">{c.clue}</td>
                          <td className="mono">{c.targets.join(' ')}</td>
                          <td className="mono">{c.rejected ? '—' : c.score.toFixed(2)}</td>
                          <td className="tiny">{c.rejected ? `rejected: ${c.rejected}` : c.why}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
            {meta?.notes && <span className="tiny dim">{meta.notes}</span>}
          </div>
        </div>
      )}

      {turn.speech.length > 0 && (
        <div className="turn-row">
          <span className="turn-label">Said</span>
          <div className="col" style={{ gap: 2, flex: 1 }}>
            {turn.speech.map((s, i) => (
              <span key={i} className="small feed-quote">
                “{s.text}”
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function endLabel(r: string): string {
  return { pass: 'stopped', neutral: 'neutral picture', opponent: 'opponent picture', limit: 'out of guesses', skipped: 'skipped' }[r] ?? r;
}

/** Per-player one-liners: clue efficiency for spymasters, accuracy for operatives. */
function computeStats(record: GameRecord): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of record.players) {
    const turns = record.turns.filter((t) => t.team === p.team);
    if (p.role === 'spymaster') {
      const clues = turns.filter((t) => t.clue);
      if (!clues.length) continue;
      const meant = clues.reduce((s, t) => s + t.clue!.number, 0);
      // Human spymasters have no recorded intent, so count their team's correct picks instead.
      const hit = clues.reduce(
        (s, t) => s + t.guesses.filter((g) => (t.clue!.intendedTargets ? t.clue!.intendedTargets.includes(g.coord) : g.correct)).length,
        0,
      );
      out.set(p.seatId, `${clues.length} clues · ${hit}/${meant} landed`);
    } else {
      const guesses = turns.flatMap((t) => t.guesses);
      const right = guesses.filter((g) => g.correct).length;
      out.set(p.seatId, guesses.length ? `${right}/${guesses.length} correct` : '');
    }
  }
  return out;
}
