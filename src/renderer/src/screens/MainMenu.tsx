import { useEffect, useState } from 'react';
import type { LibraryImage, ReplaySummary, SlotInfo } from '@shared/ipc';
import { TEAM_NAMES } from '@core/teams';
import { getMode } from '@core/modes/gameModes';
import { randomSeed } from '@core/util/rng';
import { useApp } from '../state/AppContext';
import { play } from '../audio/sfx';
import { imageSrc } from '../imageSrc';

const ART_COUNT = 8;

export function MainMenu() {
  const { navigate, settings, replaceSettings, info } = useApp();
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [pics, setPics] = useState<LibraryImage[]>([]);
  const [recent, setRecent] = useState<ReplaySummary[] | null>(null);

  useEffect(() => {
    // The main process also changes settings (test results, folder choice); re-sync here.
    void window.oc.settings.get().then(replaceSettings);
    void window.oc.llm.slots().then(setSlots);
    void window.oc.replays.list().then((l) => setRecent(l.slice(0, 5)));
    void (async () => {
      const decks = await window.oc.images.decks();
      const deck = decks.find((d) => d.id === settings.image.deckId) ?? decks[0];
      if (deck && deck.cards.length >= ART_COUNT) {
        const res = await window.oc.images.pickFromDeck(ART_COUNT, randomSeed(), deck.id);
        if (res.ok) return setPics(res.data);
      }
      const lib = await window.oc.images.library();
      if (lib.total >= ART_COUNT) {
        const res = await window.oc.images.pickFromLibrary(ART_COUNT, randomSeed());
        if (res.ok) setPics(res.data);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (fn: () => void) => () => {
    play('click');
    fn();
  };
  const ready = slots.filter((s) => s.ready);
  const pictureSource =
    settings.image.source === 'library'
      ? 'Your picture library'
      : settings.image.source === 'generate' && settings.image.provider !== 'none'
        ? 'Generated pictures'
        : 'Standard deck';

  return (
    <div className="page page-wide">
      <div className="lobby">
        <section className="section game-box">
          <div className="game-box-art" aria-hidden="true">
            {Array.from({ length: ART_COUNT }, (_, i) => (
              <div key={i} className="game-box-card">
                {pics[i] && <img src={imageSrc(pics[i].imageId)} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />}
              </div>
            ))}
          </div>
          <div className="game-box-body">
            <h1 className="game-box-title">Open Codenames</h1>
            <div className="game-box-facts">
              <span>2 teams</span>
              <span>Picture clues</span>
              <span>You + 3 AI players</span>
            </div>
            <div className="game-box-actions">
              <button className="btn btn-primary btn-xl" onClick={go(() => navigate({ name: 'setup', modeId: 'quick' }))} data-testid="menu-quick">
                Play now
              </button>
              <button className="btn btn-lg" onClick={go(() => navigate({ name: 'play' }))} data-testid="menu-play">
                Other modes
              </button>
            </div>
          </div>
        </section>

        <aside className="lobby-side">
          <section className="section">
            <h2 className="section-title">AI players</h2>
            {ready.length === 0 ? (
              <button className="btn btn-sm btn-primary" onClick={go(() => navigate({ name: 'config', first: false }))}>
                Set up a language model
              </button>
            ) : (
              <ul className="plain-list">
                {ready.map((s) => (
                  <li key={s.slot}>
                    <span className="mono muted">LLM{s.slot + 1}</span> {s.modelLabel}
                    <span className="muted"> · {s.providerName.replace(/\s*\(.*\)/, '')}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="small muted section-foot">Pictures: {pictureSource}</div>
          </section>

          <section className="section">
            <h2 className="section-title">Recent games</h2>
            {recent && recent.length === 0 && <div className="small muted">No games yet.</div>}
            <ul className="plain-list recent-list">
              {recent?.map((r) => {
                const outcome = r.aborted ? 'Unfinished' : r.winner ? (r.humanTeam ? (r.winner === r.humanTeam ? 'Won' : 'Lost') : `${TEAM_NAMES[r.winner as 'A' | 'B']} won`) : '—';
                return (
                  <li key={r.id}>
                    <button
                      className="link-btn"
                      onClick={async () => {
                        const rec = await window.oc.replays.load(r.id);
                        if (rec) navigate({ name: 'debrief', record: rec });
                      }}
                    >
                      {getMode(r.modeId).name}
                    </button>
                    <span className={`result-tag ${outcome === 'Won' ? 'good' : outcome === 'Lost' ? 'bad' : ''}`}>{outcome}</span>
                    <span className="tiny muted">{new Date(r.createdAt).toLocaleDateString()}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          {info.platform !== 'web' && (
            <div className="row">
              <div className="spacer" />
              <button className="btn btn-sm" onClick={() => void window.oc.app.quit()}>
                Quit
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
