import { GAME_MODES } from '@core/modes/gameModes';
import { useApp } from '../state/AppContext';
import { play } from '../audio/sfx';

export function PlayMenu() {
  const { navigate } = useApp();
  const available = GAME_MODES.filter((m) => m.available);
  const soon = GAME_MODES.filter((m) => !m.available);
  return (
    <div className="page">
      <section className="section">
        <div className="mode-list">
          {available.map((m) => (
            <div key={m.id} className="mode-row">
              <div className="mode-text">
                <div className="mode-name">{m.name}</div>
                <div className="small muted">{m.tagline}</div>
              </div>
              <button
                className="btn btn-primary"
                data-testid={`mode-${m.id}`}
                onClick={() => {
                  play('click');
                  navigate({ name: 'setup', modeId: m.id });
                }}
              >
                Play
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="section">
        <h2 className="section-title">Coming later</h2>
        <div className="mode-list">
          {soon.map((m) => (
            <div key={m.id} className="mode-row locked" aria-disabled="true">
              <div className="mode-text">
                <div className="mode-name">{m.name}</div>
                <div className="small muted">{m.tagline}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
