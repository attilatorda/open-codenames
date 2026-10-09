import { useEffect, useState } from 'react';
import { TEAM_NAMES } from '@core/teams';
import { getMode } from '@core/modes/gameModes';
import type { ReplaySummary } from '@shared/ipc';
import { useApp } from '../state/AppContext';
import { Icon } from '../components/Icon';

export function HistoryScreen() {
  const { navigate } = useApp();
  const [list, setList] = useState<ReplaySummary[] | null>(null);
  const load = () => void window.oc.replays.list().then(setList);
  useEffect(load, []);
  return (
    <div className="page">
      <section className="section">
        {list && list.length === 0 && <div className="small muted">No games yet.</div>}
        <div className="history-list">
          {list?.map((r) => {
            const you = r.humanTeam;
            const outcome = r.aborted ? 'Unfinished' : r.winner ? (you ? (r.winner === you ? 'Won' : 'Lost') : `${TEAM_NAMES[r.winner as 'A' | 'B']} won`) : '—';
            return (
              <div key={r.id} className="history-row">
                <span className={`result-tag ${outcome === 'Won' ? 'good' : outcome === 'Lost' ? 'bad' : ''}`}>{outcome}</span>
                <div style={{ flex: 1 }}>
                  <div className="small">
                    <strong>{getMode(r.modeId).name}</strong> · {new Date(r.createdAt).toLocaleString()}
                    {r.winReason === 'assassin' && <span className="muted"> · assassin</span>}
                  </div>
                  <div className="tiny muted">
                    {r.players
                      .filter((p) => p.kind === 'ai')
                      .map((p) => `${p.name}${p.model ? ` (${p.model})` : ''}`)
                      .join(' · ')}
                  </div>
                </div>
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    const rec = await window.oc.replays.load(r.id);
                    if (rec) navigate({ name: 'debrief', record: rec });
                  }}
                >
                  Debrief
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  title="Delete"
                  onClick={async () => {
                    await window.oc.replays.remove(r.id);
                    load();
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
