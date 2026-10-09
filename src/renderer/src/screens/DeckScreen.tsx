import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_COLLECTION_ID, type DeckCardInfo, type DeckInfo, type FolderScan } from '@shared/deck';
import { useApp } from '../state/AppContext';
import { Modal, TechDetails } from '../components/ui';
import { Icon } from '../components/Icon';
import { play } from '../audio/sfx';
import { imageSrc } from '../imageSrc';

export function DeckScreen() {
  const { navigate, settings, updateSettings, toast, info } = useApp();
  const [decks, setDecks] = useState<DeckInfo[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>(settings.image.deckId || DEFAULT_COLLECTION_ID);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<DeckCardInfo | null>(null);
  const [importing, setImporting] = useState<FolderScan | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = async () => setDecks(await window.oc.images.decks());
  useEffect(() => void load(), []);

  const standardId = settings.image.deckId || DEFAULT_COLLECTION_ID;
  const deck = decks?.find((d) => d.id === selectedId) ?? decks?.[0];

  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!deck) return [];
    if (!q) return deck.cards;
    return deck.cards.filter((c) => [c.title, c.artist, c.year, c.caption, c.work ?? ''].some((f) => f.toLowerCase().includes(q)));
  }, [deck, query]);

  const artists = useMemo(() => [...new Set(deck?.cards.map((c) => c.artist) ?? [])], [deck]);

  const makeStandard = async () => {
    if (!deck) return;
    play('click');
    await updateSettings({ image: { deckId: deck.id, source: 'deck' } });
    toast(`“${deck.name}” is now the standard collection.`);
  };

  const startImport = async () => {
    play('click');
    const scan = await window.oc.images.chooseCollectionFolder();
    if (scan) setImporting(scan);
  };

  return (
    <div className="page page-wide">
      <div className="deck-screen">
        <div className="collection-tabs" role="tablist">
          {decks?.map((d) => (
            <button
              key={d.id}
              role="tab"
              aria-selected={d.id === deck?.id}
              className={`collection-tab${d.id === deck?.id ? ' active' : ''}`}
              onClick={() => setSelectedId(d.id)}
              data-testid={`collection-${d.id}`}
            >
              <span className="collection-tab-name">{d.name}</span>
              <span className="collection-tab-meta">
                {d.cards.length} pictures{d.builtIn ? ' · built-in' : ' · imported'}
              </span>
              {d.id === standardId && <span className="result-tag good">Standard</span>}
            </button>
          ))}
          <div className="spacer" />
          {info.platform !== 'web' && (
            <button className="btn" onClick={() => void startImport()} data-testid="import-collection">
              <Icon name="folder" size={16} /> Import collection…
            </button>
          )}
        </div>

        {deck && (
          <div className="collection-head">
            <p className="muted deck-intro">
              {deck.description}
              {artists.length > 0 && <> Artists: {artists.slice(0, 6).join(', ')}{artists.length > 6 ? '…' : ''}.</>}
            </p>
            <div className="row wrap">
              {deck.id === standardId ? (
                <span className="result-tag good">
                  <Icon name="check" size={12} /> Standard collection — Quick Play deals from it
                </span>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={() => void makeStandard()} data-testid="make-standard">
                  Make standard
                </button>
              )}
              {!deck.builtIn && (
                <button className="btn btn-danger btn-sm" onClick={() => setConfirmRemove(true)}>
                  <Icon name="trash" size={14} /> Remove
                </button>
              )}
              <input
                className="input deck-search"
                placeholder="Search title, artist, year…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="deck-search"
              />
            </div>
          </div>
        )}

        {decks && decks.length === 0 && (
          <div className="notice notice-warn">
            <Icon name="info" />
            <span>No picture collections were found in this installation.</span>
          </div>
        )}
        <div className="deck-grid" data-testid="deck-grid">
          {cards.map((c) => (
            <button key={c.imageId} className="deck-card" onClick={() => setOpen(c)} title={c.caption || c.title}>
              <span className="deck-card-img">
                <img src={imageSrc(c.imageId)} alt={c.caption || c.title} loading="lazy" />
              </span>
              <span className="deck-card-title">{c.title}</span>
              <span className="deck-card-meta">
                {c.artist}
                {c.year ? ` · ${c.year}` : ''}
              </span>
            </button>
          ))}
        </div>
      </div>

      {open && (
        <Modal onClose={() => setOpen(null)} width={760}>
          <div className="deck-detail">
            <img src={imageSrc(open.imageId)} alt={open.caption || open.title} />
            <div className="col" style={{ gap: 6 }}>
              <div className="eyebrow">{deck?.name}</div>
              <h2 className="h2">{open.title}</h2>
              <dl className="deck-facts">
                <dt>Artist</dt>
                <dd>{open.artist}</dd>
                <dt>Year</dt>
                <dd>{open.year || '—'}</dd>
                {open.work && (
                  <>
                    <dt>From</dt>
                    <dd>{open.work}</dd>
                  </>
                )}
                {open.caption && (
                  <>
                    <dt>Shows</dt>
                    <dd>{open.caption}</dd>
                  </>
                )}
                <dt>Source</dt>
                <dd>
                  {open.sourceURL ? (
                    <button className="link-btn" onClick={() => void window.oc.app.openExternal(open.sourceURL)}>
                      {open.source} <Icon name="external" size={11} />
                    </button>
                  ) : (
                    open.source
                  )}
                </dd>
                <dt>License</dt>
                <dd>{open.license}</dd>
              </dl>
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn btn-sm" onClick={() => setOpen(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {importing && (
        <ImportDialog
          scan={importing}
          onClose={() => setImporting(null)}
          onImported={async (info) => {
            setImporting(null);
            await load();
            setSelectedId(info.id);
            toast(`Imported “${info.name}” — ${info.cards.length} pictures.`);
          }}
        />
      )}

      {confirmRemove && deck && (
        <Modal onClose={() => setConfirmRemove(false)}>
          <h2 className="h2">Remove “{deck.name}”?</h2>
          <p className="muted">The imported copies of its pictures are deleted from the game’s data folder. Your original folder is not touched.</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmRemove(false)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                await window.oc.images.removeCollection(deck.id);
                setConfirmRemove(false);
                setSelectedId(DEFAULT_COLLECTION_ID);
                await load();
                await updateSettings({});
              }}
            >
              Remove
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ImportDialog({ scan, onClose, onImported }: { scan: FolderScan; onClose: () => void; onImported: (d: DeckInfo) => void }) {
  const [form, setForm] = useState({ name: scan.suggestedName, artist: '', year: '', source: '', sourceURL: '', license: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await window.oc.images.importCollection({ folder: scan.folder, ...form });
    setBusy(false);
    if (res.ok) onImported(res.data);
    else setError({ message: res.error.message, detail: res.error.detail });
  };

  return (
    <Modal onClose={busy ? undefined : onClose} width={620}>
      <h2 className="h2">
        Import collection · {scan.images} picture{scan.images === 1 ? '' : 's'}
      </h2>
      <p className="small muted mono" style={{ wordBreak: 'break-all', marginTop: 0 }}>
        {scan.folder}
        {scan.metadata ? ` · credits from ${scan.metadata}` : ''}
      </p>
      <div className="import-grid">
        <div className="field">
          <label>Collection name</label>
          <input className="input" value={form.name} onChange={set('name')} data-testid="import-name" />
        </div>
        <div className="field">
          <label>Artist</label>
          <input className="input" value={form.artist} onChange={set('artist')} placeholder="e.g. the painter’s name" data-testid="import-artist" />
        </div>
        <div className="field">
          <label>Year(s)</label>
          <input className="input" value={form.year} onChange={set('year')} placeholder="e.g. 1998–2015" />
        </div>
        <div className="field">
          <label>Source</label>
          <input className="input" value={form.source} onChange={set('source')} placeholder="e.g. licensed from the artist’s studio" />
        </div>
        <div className="field">
          <label>Source URL</label>
          <input className="input" value={form.sourceURL} onChange={set('sourceURL')} placeholder="https://…" />
        </div>
        <div className="field">
          <label>License / permission</label>
          <input className="input" value={form.license} onChange={set('license')} placeholder="e.g. Licensed for use in this game" data-testid="import-license" />
        </div>
      </div>
      <div className="notice notice-warn" style={{ marginTop: 14 }}>
        <Icon name="info" />
        <span>Only import pictures you have the right to use.</span>
      </div>
      {error && (
        <div className="notice notice-bad" style={{ marginTop: 12 }}>
          <Icon name="info" />
          <div>
            {error.message}
            <TechDetails detail={error.detail} />
          </div>
        </div>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !form.name.trim() || scan.images === 0} data-testid="import-submit">
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
    </Modal>
  );
}
