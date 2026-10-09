import { useEffect, useRef, useState } from 'react';
import { ConceptBoardGenerator, cardsFromPlan, planFromLibrary } from '@core/board/boardGenerator';
import { conceptBank } from '@core/board/conceptBank';
import type { Card } from '@core/types';
import type { FriendlyError } from '@shared/ipc';
import { useApp } from '../state/AppContext';
import { matchLayout, type MatchConfig } from '../game/matchConfig';
import { Icon } from '../components/Icon';
import { Dots, TechDetails } from '../components/ui';
import { play } from '../audio/sfx';
import { imageSrc } from '../imageSrc';

type CellState = { status: 'pending' | 'done' | 'retrying' | 'failed'; imageId?: string };

export function BoardLoadingScreen({ config }: { config: MatchConfig }) {
  const { navigate, settings } = useApp();
  const layout = matchLayout(config);
  const total = layout.rows * layout.cols;
  const [cells, setCells] = useState<CellState[]>(() => Array.from({ length: total }, () => ({ status: 'pending' })));
  const [done, setDone] = useState(0);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [canUseLibrary, setCanUseLibrary] = useState(false);
  const batchRef = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    // Unique per run, so a cancelled earlier run can never cancel or overwrite this one.
    const batchId = `${config.id}-${attempt}-${Math.random().toString(36).slice(2, 8)}`;
    batchRef.current = batchId;
    setError(null);
    setDone(0);
    setCells(Array.from({ length: total }, () => ({ status: 'pending' })));

    const off = window.oc.images.onProgress((p) => {
      if (p.batchId !== batchId) return;
      setDone(p.done);
      setCells((c) => {
        const next = c.slice();
        next[p.cardId] = { status: p.status === 'done' ? 'done' : p.status === 'failed' ? 'failed' : 'retrying', imageId: p.imageId };
        return next;
      });
      if (p.status === 'swapped' || p.status === 'retrying') setNote(p.message ?? null);
    });

    const build = async (): Promise<{ cards: Card[]; startingTeam: 'A' | 'B' } | null> => {
      if (config.imageSource === 'library' || config.imageSource === 'deck') {
        const res =
          config.imageSource === 'deck'
            ? await window.oc.images.pickFromDeck(total, config.seed, config.deckId)
            : await window.oc.images.pickFromLibrary(total, config.seed);
        if (!res.ok) {
          setError(res.error);
          return null;
        }
        const board = planFromLibrary(config.seed, layout, res.data);
        setCells(board.cards.map((c) => ({ status: 'done', imageId: c.image.imageId })));
        setDone(total);
        return board;
      }
      const plan = new ConceptBoardGenerator(conceptBank(config.conceptSet)).plan(config.seed, layout, config.styleId);
      const res = await window.oc.images.generate(
        batchId,
        plan.cards.map((c) => ({ cardId: c.id, concept: c.concept, prompt: c.prompt, styleId: c.styleId })),
      );
      if (!res.ok) {
        setError(res.error);
        return null;
      }
      const results = new Map(res.data.map((r) => [r.cardId, { imageId: r.imageId, concept: r.concept }]));
      const source = settings.image.provider === 'mock' ? 'mock' : 'generated';
      return { cards: cardsFromPlan(plan, results, source), startingTeam: plan.startingTeam };
    };

    void (async () => {
      const [slots, lib] = await Promise.all([window.oc.llm.slots(), window.oc.images.library()]);
      setCanUseLibrary(config.imageSource === 'generate' && lib.total >= total);
      const board = await build();
      if (cancelled || !board) {
        if (!cancelled) play('error');
        return;
      }
      // A short beat so the last print visibly lands before the table appears.
      await new Promise((r) => setTimeout(r, 450));
      if (!cancelled) navigate({ name: 'game', config, board: { ...board, slots } });
    })();

    return () => {
      cancelled = true;
      off();
      void window.oc.images.cancel(batchId);
    };
  }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = Math.round((done / total) * 100);

  return (
    <div className="page loading-screen">
      <div className="loading-wrap">
        <div className="page-head">
          <h1 className="h1">
            {error ? 'Could not build the board' : config.imageSource === 'generate' ? 'Generating pictures' : 'Dealing the board'}
            {!error && <Dots />}
          </h1>
        </div>
        <div className="loading-board" style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)` }}>
          {cells.map((c, i) => (
            <div key={i} className={`loading-cell ${c.status}`} style={{ animationDelay: `${(i % 7) * 0.12}s` }}>
              {c.imageId && <img src={imageSrc(c.imageId)} alt="" />}
            </div>
          ))}
        </div>
        {!error ? (
          <div className="loading-progress">
            <div className="progress-bar">
              <div style={{ width: `${pct}%` }} />
            </div>
            <div className="row small muted">
              <span>
                {done} / {total} pictures
              </span>
              {note && <span className="pill">{note}</span>}
              <div className="spacer" />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  void window.oc.images.cancel(batchRef.current);
                  navigate({ name: 'setup', modeId: config.modeId });
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="panel panel-pad loading-error" role="alert">
            <div className="row">
              <Icon name="info" />
              <strong>{error.message}</strong>
            </div>
            <TechDetails detail={error.detail} />
            <div className="modal-actions">
              <button className="btn" onClick={() => navigate({ name: 'menu' })}>
                Main menu
              </button>
              {(error.kind === 'auth' || error.kind === 'not_configured' || error.kind === 'quota') && (
                <button className="btn" onClick={() => navigate({ name: 'config', first: false })}>
                  AI configuration
                </button>
              )}
              {canUseLibrary && (
                <button
                  className="btn"
                  onClick={() => navigate({ name: 'loading', config: { ...config, id: `${config.id}-lib`, imageSource: 'library' } })}
                >
                  Use my picture library
                </button>
              )}
              {config.imageSource === 'generate' && (
                <button className="btn" onClick={() => navigate({ name: 'loading', config: { ...config, id: `${config.id}-deck`, imageSource: 'deck' } })}>
                  Use the standard deck
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setAttempt((a) => a + 1)}>
                <Icon name="refresh" size={16} /> Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
