import { useEffect, useState } from 'react';
import { LAYOUTS } from '@core/board/layouts';
import { CONCEPT_SETS } from '@core/board/conceptBank';
import { ART_STYLES, MIXED_STYLE_ID } from '@core/images/promptBuilder';
import type { CredentialStatus, DiagnosticEntry, LibraryStats, SlotInfo, UsageCounters } from '@shared/ipc';
import type { DeckInfo } from '@shared/deck';
import { imageProviderInfo } from '@shared/providers';
import { useApp } from '../state/AppContext';
import { Modal, Segmented, Toggle } from '../components/ui';
import { Icon } from '../components/Icon';
import { configureSfx, play } from '../audio/sfx';

const TABS = [
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'ai', label: 'AI players' },
  { id: 'images', label: 'Pictures' },
  { id: 'audio', label: 'Audio & display' },
  { id: 'privacy', label: 'Keys & privacy' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

export function SettingsScreen({ tab: initial }: { tab?: string }) {
  const { navigate } = useApp();
  const [tab, setTab] = useState(initial ?? 'gameplay');
  return (
    <div className="page">
      <div>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'gameplay' && <GameplayTab />}
        {tab === 'ai' && <AiTab />}
        {tab === 'images' && <ImagesTab />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'privacy' && <PrivacyTab />}
        {tab === 'diagnostics' && <DiagnosticsTab />}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-label">{label}</div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function GameplayTab() {
  const { settings, updateSettings } = useApp();
  const g = settings.gameplay;
  const set = (patch: Partial<typeof g>) => void updateSettings({ gameplay: patch });
  return (
    <div className="section settings-panel">
      <Row label="Your role">
        <Segmented
          value={g.humanRole}
          onChange={(v) => set({ humanRole: v })}
          options={[
            { value: 'alternate', label: 'Alternate' },
            { value: 'spymaster', label: 'Spymaster' },
            { value: 'operative', label: 'Operative' },
          ]}
        />
      </Row>
      <Row label="Board size">
        <Segmented value={g.layoutId} onChange={(v) => set({ layoutId: v })} options={LAYOUTS.map((l) => ({ value: l.id, label: l.short, title: l.label }))} />
      </Row>
      <Row label="Picture subjects">
        <Segmented
          value={g.conceptSet ?? 'surreal'}
          onChange={(v) => set({ conceptSet: v })}
          options={CONCEPT_SETS.map((c) => ({ value: c.id, label: c.label, title: c.description }))}
        />
      </Row>
      <Row label="Art style">
        <select className="select" value={g.styleId} onChange={(e) => set({ styleId: e.target.value })}>
          {ART_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
          <option value={MIXED_STYLE_ID}>Mixed</option>
        </select>
      </Row>
      <Row label="AI daring">
        <div className="row">
          <span className="tiny muted">Cautious</span>
          <input
            className="range"
            type="range"
            min={-0.5}
            max={0.5}
            step={0.1}
            value={g.riskBias}
            onChange={(e) => set({ riskBias: Number(e.target.value) })}
          />
          <span className="tiny muted">Bold</span>
        </div>
      </Row>
      <Row label="AI pace">
        <Segmented
          value={g.pace}
          onChange={(v) => set({ pace: v })}
          options={[
            { value: 'relaxed', label: 'Relaxed' },
            { value: 'normal', label: 'Normal' },
            { value: 'fast', label: 'Fast' },
          ]}
        />
      </Row>
    </div>
  );
}

function AiTab() {
  const { navigate } = useApp();
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  useEffect(() => void window.oc.llm.slots().then(setSlots), []);
  return (
    <div className="section">
      <div className="row section-title-row">
        <h2 className="section-title">Language models</h2>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={() => navigate({ name: 'config', first: false })} data-testid="open-config">
          <Icon name="key" size={14} /> API configuration
        </button>
      </div>
      <table className="table">
        <tbody>
          {slots.map((s) => (
            <tr key={s.slot}>
              <td className="mono">LLM{s.slot + 1}</td>
              <td>{s.provider ? `${s.providerName} · ${s.modelLabel}` : <span className="muted">Not configured</span>}</td>
              <td className="right">
                {s.ready ? <span className="result-tag good">Ready</span> : s.provider && !s.vision ? <span className="result-tag bad">Cannot see pictures</span> : s.provider ? <span className="result-tag">Not ready</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImagesTab() {
  const { settings, updateSettings, toast, navigate, info: app } = useApp();
  const [lib, setLib] = useState<LibraryStats | null>(null);
  const [decks, setDecks] = useState<DeckInfo[]>([]);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    void window.oc.images.library().then(setLib);
    void window.oc.images.decks().then(setDecks);
  }, []);
  const im = settings.image;
  const info = imageProviderInfo(im.provider);
  if (app.platform === 'web') {
    // The browser version always deals from a built-in collection.
    return (
      <div className="section settings-panel">
        <Row label="Standard collection">
          <div className="row">
            <select className="select" value={im.deckId} onChange={(e) => void updateSettings({ image: { deckId: e.target.value } })}>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.cards.length})
                </option>
              ))}
            </select>
            <button className="btn btn-sm" onClick={() => navigate({ name: 'deck' })}>
              Browse…
            </button>
          </div>
        </Row>
      </div>
    );
  }
  return (
    <div className="section settings-panel">
      <Row label="Image generator">
        <span className="small">{info ? `${info.name} · ${info.models.find((m) => m.id === im.model)?.label ?? im.model}` : 'None (picture folder only)'}</span>
      </Row>
      <Row label="Where boards come from">
        <Segmented
          value={im.source}
          onChange={(v) => void updateSettings({ image: { source: v } })}
          options={[
            { value: 'deck', label: 'Standard deck (free)' },
            { value: 'generate', label: 'Generate new pictures' },
            { value: 'library', label: 'My library (free)' },
          ]}
        />
      </Row>
      <Row label="Standard collection">
        <div className="row">
          <select className="select" value={im.deckId} onChange={(e) => void updateSettings({ image: { deckId: e.target.value } })}>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.cards.length})
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={() => navigate({ name: 'deck' })}>
            Browse & import…
          </button>
        </div>
      </Row>
      {info && (
        <>
          <Row label="Image quality">
            <Segmented
              value={im.quality}
              onChange={(v) => void updateSettings({ image: { quality: v } })}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
            />
          </Row>
          <Row label="Reuse cached pictures">
            <Toggle checked={im.reuseCache} onChange={(v) => void updateSettings({ image: { reuseCache: v } })} label="Reuse cached pictures" />
          </Row>
        </>
      )}
      <Row label="Picture folder">
        <div className="row">
          <span className="small mono folder-path">{im.folder ?? 'None'}</span>
          <button
            className="btn btn-sm"
            onClick={async () => {
              const l = await window.oc.images.chooseFolder();
              if (l) {
                setLib(l);
                await updateSettings({});
              }
            }}
          >
            <Icon name="folder" size={14} /> Choose…
          </button>
          {im.folder && (
            <button className="btn btn-sm btn-ghost" onClick={async () => setLib(await window.oc.images.rescanFolder())}>
              Rescan
            </button>
          )}
        </div>
      </Row>
      <Row label="Library">
        <span className="small">
          {lib ? `${lib.total} pictures (${lib.folder} from your folder, ${lib.generated} generated)` : '…'}
        </span>
      </Row>
      <Row label="Generated picture cache">
        <button className="btn btn-sm btn-danger" onClick={() => setConfirm(true)}>
          <Icon name="trash" size={14} /> Clear generated pictures
        </button>
      </Row>
      {confirm && (
        <Modal onClose={() => setConfirm(false)}>
          <h2 className="h2">Clear generated pictures?</h2>
          <p className="muted">Every picture generated so far will be deleted from this computer. Saved game debriefs will show missing images. Your own folder is not touched.</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                setLib(await window.oc.images.clearGenerated());
                setConfirm(false);
                toast('Generated pictures cleared.');
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AudioTab() {
  const { settings, updateSettings } = useApp();
  return (
    <div className="section settings-panel">
      <Row label="Volume">
        <div className="row">
          <Icon name={settings.audio.muted ? 'mute' : 'volume'} />
          <input
            className="range"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.audio.volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              configureSfx(v, settings.audio.muted);
              void updateSettings({ audio: { volume: v } });
            }}
            onMouseUp={() => play('correct')}
          />
        </div>
      </Row>
      <Row label="Mute">
        <Toggle checked={settings.audio.muted} onChange={(v) => void updateSettings({ audio: { muted: v } })} label="Mute" />
      </Row>
      <Row label="Fullscreen">
        <Toggle checked={settings.display.fullscreen} onChange={(v) => void window.oc.app.setFullscreen(v).then(() => updateSettings({}))} label="Fullscreen" />
      </Row>
      <Row label="Reduce motion">
        <Toggle checked={settings.display.reduceMotion} onChange={(v) => void updateSettings({ display: { reduceMotion: v } })} label="Reduce motion" />
      </Row>
    </div>
  );
}

function PrivacyTab() {
  const { navigate, toast, replaceSettings } = useApp();
  const [cred, setCred] = useState<CredentialStatus | null>(null);
  const [confirm, setConfirm] = useState<'keys' | 'settings' | null>(null);
  useEffect(() => void window.oc.credentials.status().then(setCred), []);
  const keyCount = cred ? cred.llm.filter((k) => k.hasKey).length + (cred.image.hasKey ? 1 : 0) : 0;
  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="section settings-panel">
        <Row label="Key storage">
          <span className="small">
            {cred?.backend === 'browser'
              ? 'In this browser’s local storage for this site (not encrypted)'
              : cred?.persistent
                ? `Encrypted with ${cred.backend === 'dpapi' ? 'Windows DPAPI' : cred.backend} on this computer`
                : 'Session only (no secure storage available)'}
          </span>
        </Row>
        <Row label="Saved keys">
          <span className="small">{keyCount} saved</span>
        </Row>
        <Row label="Delete all saved API credentials">
          <button className="btn btn-danger" onClick={() => setConfirm('keys')} disabled={keyCount === 0} data-testid="delete-keys">
            <Icon name="trash" size={16} /> Delete all keys
          </button>
        </Row>
        <Row label="Reset settings">
          <button className="btn" onClick={() => setConfirm('settings')}>
            Reset settings
          </button>
        </Row>
        <Row label="Disclaimer">
          <button className="btn btn-sm" onClick={() => navigate({ name: 'disclaimer', review: true })}>
            Read it again
          </button>
        </Row>
      </div>
      {confirm && (
        <Modal onClose={() => setConfirm(null)}>
          <h2 className="h2">{confirm === 'keys' ? 'Delete all saved API credentials?' : 'Reset settings?'}</h2>
          <p className="muted">
            {confirm === 'keys'
              ? 'All API keys will be removed from this computer. You will need to enter them again before playing.'
              : 'Your gameplay, audio and display preferences will be reset.'}
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              data-testid="confirm-delete"
              onClick={async () => {
                if (confirm === 'keys') {
                  setCred(await window.oc.credentials.deleteAll());
                  toast('All saved API credentials were deleted.');
                } else {
                  replaceSettings(await window.oc.settings.reset());
                  toast('Settings reset.');
                }
                setConfirm(null);
              }}
            >
              {confirm === 'keys' ? 'Delete keys' : 'Reset'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DiagnosticsTab() {
  const { toast, info } = useApp();
  const [entries, setEntries] = useState<DiagnosticEntry[]>([]);
  const [counters, setCounters] = useState<UsageCounters | null>(null);
  const load = async () => {
    setEntries(await window.oc.diagnostics.list());
    setCounters(await window.oc.diagnostics.counters());
  };
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, []);
  const copy = async () => {
    const text = entries.map((e) => `${e.at} ${e.level.toUpperCase()} [${e.source}${e.provider ? `/${e.provider}` : ''}] ${e.purpose ?? ''} ${e.message}${e.detail ? `\n    ${e.detail}` : ''}`).join('\n');
    await navigator.clipboard.writeText(`Open Codenames ${info.version} (${info.platform})\n${text}`);
    toast('Diagnostics copied to the clipboard (keys are redacted).');
  };
  return (
    <div className="col" style={{ gap: 18 }}>
      {counters && (
        <div className="counter-grid">
          <Counter label="LLM calls" value={counters.llmCalls} />
          <Counter label="LLM errors" value={counters.llmErrors} />
          <Counter label="Input tokens" value={counters.inputTokens} sub={counters.cachedInputTokens ? `${counters.cachedInputTokens.toLocaleString()} cached` : undefined} />
          <Counter label="Output tokens" value={counters.outputTokens} />
          <Counter label="Pictures generated" value={counters.imagesGenerated} />
          <Counter label="From cache (free)" value={counters.imagesFromCache} />
        </div>
      )}
      <div className="section">
        <div className="row section-title-row">
          <h2 className="section-title">Log</h2>
          <div className="spacer" />
          <button className="btn btn-sm" onClick={() => void copy()}>
            Copy
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              await window.oc.diagnostics.clear();
              void load();
            }}
          >
            Clear
          </button>
        </div>
        <div className="diag-list">
          {entries.length === 0 && <div className="muted small">Nothing logged yet.</div>}
          {entries.map((e) => (
            <details key={e.id} className={`diag-entry ${e.level}`}>
              <summary>
                <span className="mono tiny dim">{new Date(e.at).toLocaleTimeString()}</span>
                <span className={`diag-level ${e.level}`}>{e.level}</span>
                <span className="tiny muted">
                  {e.source}
                  {e.provider ? `/${e.provider}` : ''}
                  {e.slot !== undefined ? ` · LLM${e.slot + 1}` : ''}
                  {e.purpose ? ` · ${e.purpose}` : ''}
                </span>
                <span className="small diag-msg">{e.message}</span>
                {e.latencyMs !== undefined && <span className="tiny mono dim">{(e.latencyMs / 1000).toFixed(1)}s</span>}
              </summary>
              {e.detail && <pre>{e.detail}</pre>}
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

function Counter({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="counter section">
      <div className="counter-value">{value.toLocaleString()}</div>
      <div className="tiny muted">{label}</div>
      {sub && <div className="tiny dim">{sub}</div>}
    </div>
  );
}
