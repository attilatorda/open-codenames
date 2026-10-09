import { useEffect, useMemo, useState } from 'react';
import { LAYOUTS } from '@core/board/layouts';
import type { CredentialStatus, LibraryStats, SlotInfo } from '@shared/ipc';
import {
  IMAGE_PROVIDERS,
  LLM_PROVIDERS,
  imageProviderInfo,
  llmProviderInfo,
  type ImageProviderId,
  type LLMProviderId,
} from '@shared/providers';
import { emptySlot, type ImageSettings, type LLMSlotConfig } from '@shared/settings';
import { useApp } from '../state/AppContext';
import { Icon } from '../components/Icon';
import { Segmented, Toggle, Dots } from '../components/ui';
import { play } from '../audio/sfx';

const SMALLEST_BOARD = Math.min(...LAYOUTS.map((l) => l.rows * l.cols));
const ROLE_NAMES = ['your AI teammate', 'the opposing spymaster', 'the opposing operative'];

export function ApiConfigScreen({ first }: { first: boolean }) {
  const { settings, updateSettings, navigate, info, toast } = useApp();
  const web = info.platform === 'web';
  const [slots, setSlots] = useState<LLMSlotConfig[]>(settings.llmSlots);
  const [image, setImage] = useState<ImageSettings>(settings.image);
  const [cred, setCred] = useState<CredentialStatus | null>(null);
  const [slotInfo, setSlotInfo] = useState<SlotInfo[]>([]);
  const [library, setLibrary] = useState<LibraryStats | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const refresh = async () => {
    const [c, s, l] = await Promise.all([window.oc.credentials.status(), window.oc.llm.slots(), window.oc.images.library()]);
    setCred(c);
    setSlotInfo(s);
    setLibrary(l);
  };
  useEffect(() => {
    void refresh();
  }, []);

  const saveSlot = async (i: number, next: LLMSlotConfig) => {
    const all = slots.slice();
    all[i] = next;
    setSlots(all);
    const s = await updateSettings({ llmSlots: all });
    setSlots(s.llmSlots);
    setSlotInfo(await window.oc.llm.slots());
  };

  const saveImage = async (patch: Partial<ImageSettings>) => {
    const next = { ...image, ...patch };
    setImage(next);
    const s = await updateSettings({ image: next });
    setImage(s.image);
  };

  const ready = slotInfo.filter((s) => s.ready).map((s) => s.slot);
  const roleHints = useMemo(() => {
    const hints = new Map<number, string[]>();
    if (ready.length === 0) return hints;
    ROLE_NAMES.forEach((role, i) => {
      const slot = ready[i % ready.length];
      hints.set(slot, [...(hints.get(slot) ?? []), role]);
    });
    return hints;
  }, [ready.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const imageReady = image.provider !== 'none' && (!imageProviderInfo(image.provider)?.keyRequired || !!cred?.image.hasKey);
  const libraryEnough = (library?.total ?? 0) >= SMALLEST_BOARD;

  // Recomputed every render, so messages disappear as soon as the problem is fixed.
  const problems: string[] = [];
  if (ready.length === 0) problems.push('Set up at least one LLM: choose a company, enter its API key and make sure the slot is enabled.');
  if (image.source === 'generate' && !imageReady) {
    problems.push('Generating pictures needs an image generator with an API key — or switch boards to the standard deck (free).');
  }
  if (image.source === 'library' && !libraryEnough) {
    problems.push(`Your picture library needs at least ${SMALLEST_BOARD} pictures (you have ${library?.total ?? 0}) — or switch boards to the standard deck.`);
  }
  const errors = showErrors ? problems : [];

  const finish = async () => {
    setShowErrors(true);
    if (problems.length) {
      play('error');
      return;
    }
    play('click');
    await updateSettings({ setupComplete: true });
    if (first) navigate({ name: 'menu' });
    else {
      toast('AI configuration saved.');
      navigate({ name: 'settings', tab: 'ai' });
    }
  };

  const configureMock = async () => {
    const mockSlots = slots.slice();
    mockSlots[0] = { ...emptySlot(), enabled: true, provider: 'mock', model: 'mock-brain' };
    setSlots(mockSlots);
    await updateSettings({ llmSlots: mockSlots, image: { ...image, source: 'deck' } });
    setImage((im) => ({ ...im, source: 'deck' }));
    await refresh();
    toast('Offline mock AI configured — boards use the standard deck.');
  };

  return (
    <div className={`page config${first ? ' first-run' : ''}`}>
        {/* First run has no top bar, so it gets a heading; later the top bar is enough. */}
        {(first || info.devMock) && (
          <div className="page-head">
            {first && <h1 className="h1">Connect your AI</h1>}
            <div className="spacer" />
            {info.devMock && (
              <button className="btn btn-sm" onClick={() => void configureMock()} data-testid="use-mock">
                <Icon name="bolt" size={14} /> Use offline mock AI (dev)
              </button>
            )}
          </div>
        )}

        {cred && !cred.persistent && (
          <div className="notice notice-warn">
            <Icon name="info" />
            <span>Keys will be kept for this session only.</span>
          </div>
        )}

        <h2 className="section-title config-section">Language models</h2>
        <div className="slot-grid">
          {slots.map((slot, i) => (
            <LLMSlotCard
              key={i}
              index={i}
              slot={slot}
              keyHint={cred?.llm[i]}
              ready={!!slotInfo.find((s) => s.slot === i)?.ready}
              blind={slotInfo.find((s) => s.slot === i)?.vision === false}
              roles={roleHints.get(i)}
              devMock={info.devMock}
              web={web}
              onChange={(s) => void saveSlot(i, s)}
              onCredentials={(c) => {
                setCred(c);
                void window.oc.llm.slots().then(setSlotInfo);
              }}
              onTested={async () => {
                const s = await window.oc.settings.get();
                setSlots(s.llmSlots);
                setSlotInfo(await window.oc.llm.slots());
              }}
            />
          ))}
        </div>

        {!web && (
          <>
            <h2 className="section-title config-section">Pictures</h2>
            <ImageCard
              image={image}
              keyHint={cred?.image}
              library={library}
              devMock={info.devMock}
              onChange={(p) => void saveImage(p)}
              onCredentials={setCred}
              onLibrary={setLibrary}
              onTested={async () => setImage((await window.oc.settings.get()).image)}
            />
          </>
        )}

        {errors.length > 0 && (
          <div className="notice notice-bad config-errors" role="alert">
            <Icon name="info" />
            <div>
              {errors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          </div>
        )}

        <div className="config-footer">
          <span className="muted small">
            {ready.length} LLM slot{ready.length === 1 ? '' : 's'} ready ·{' '}
            {image.source === 'generate' ? (imageReady ? 'generating new pictures' : 'image generator not ready') : image.source === 'library' ? `${library?.total ?? 0} pictures in your library` : 'standard deck'}
          </span>
          <div className="spacer" />
          <button className="btn btn-primary btn-lg" onClick={() => void finish()} data-testid="config-continue">
            {first ? 'Continue' : 'Save'}
          </button>
        </div>
    </div>
  );
}

function KeyInput({
  placeholder,
  hint,
  onSave,
  disabled,
  testId,
}: {
  placeholder: string;
  hint?: { hasKey: boolean; hint?: string };
  onSave: (key: string) => Promise<void>;
  disabled?: boolean;
  testId?: string;
}) {
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const commit = async () => {
    if (!value.trim()) return;
    await onSave(value.trim());
    setValue('');
  };
  return (
    <div className="input-group">
      <input
        className="input mono"
        type={show ? 'text' : 'password'}
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        data-testid={testId}
        placeholder={hint?.hasKey ? `Saved key ${hint.hint} — type to replace` : placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => e.key === 'Enter' && void commit()}
      />
      <button type="button" className="btn btn-ghost btn-icon input-addon" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide key' : 'Show key'}>
        <Icon name={show ? 'eyeOff' : 'eye'} size={16} />
      </button>
    </div>
  );
}

function ModelPicker({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const known = options.some((o) => o.id === value);
  const [custom, setCustom] = useState(!known && !!value);
  if (custom || options.length === 0) {
    return (
      <div className="row">
        <input
          className="input mono"
          value={value}
          placeholder={placeholder ?? 'model id'}
          onChange={(e) => onChange(e.target.value.trim())}
        />
        {options.length > 0 && (
          <button className="btn btn-sm" onClick={() => setCustom(false)}>
            List
          </button>
        )}
      </div>
    );
  }
  return (
    <select
      className="select"
      value={value}
      onChange={(e) => {
        if (e.target.value === '__custom') setCustom(true);
        else onChange(e.target.value);
      }}
    >
      {!known && <option value={value}>{value || '— choose a model —'}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
      <option value="__custom">Other model id…</option>
    </select>
  );
}

function TestStatus({ test, busy }: { test?: { ok: boolean; message: string }; busy: boolean }) {
  if (busy)
    return (
      <span className="muted small">
        Testing<Dots />
      </span>
    );
  if (!test) return <span className="dim small">Not tested yet</span>;
  return (
    <span className={`small test-status ${test.ok ? 'ok' : 'bad'}`}>
      <Icon name={test.ok ? 'check' : 'close'} size={14} /> {test.message}
    </span>
  );
}

function LLMSlotCard({
  index,
  slot,
  keyHint,
  ready,
  blind,
  roles,
  devMock,
  web,
  onChange,
  onCredentials,
  onTested,
}: {
  index: number;
  slot: LLMSlotConfig;
  keyHint?: { hasKey: boolean; hint?: string };
  ready: boolean;
  blind: boolean;
  roles?: string[];
  devMock: boolean;
  /** The browser build cannot reach local servers. */
  web: boolean;
  onChange: (s: LLMSlotConfig) => void;
  onCredentials: (c: CredentialStatus) => void;
  onTested: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const info = llmProviderInfo(slot.provider);
  const providers = LLM_PROVIDERS.filter((p) => (!p.devOnly || devMock) && !(web && p.id === 'local'));
  const models = useMemo(() => {
    const list = [...(info?.models ?? [])];
    for (const m of slot.discoveredModels ?? []) if (!list.some((x) => x.id === m.id)) list.push(m);
    return list;
  }, [info, slot.discoveredModels]);

  const setProvider = (id: string) => {
    const p = llmProviderInfo(id);
    onChange({
      ...emptySlot(),
      enabled: !!p,
      provider: (p?.id ?? '') as LLMProviderId | '',
      model: p?.defaultModel ?? '',
      baseUrl: p?.baseUrlEditable ? p.defaultBaseUrl : undefined,
    });
  };

  const saveKey = async (key: string) => {
    const res = await window.oc.credentials.setLLMKey(index, key);
    if (res.ok) {
      setKeyError(null);
      onCredentials(res.data);
    } else setKeyError(res.error.message);
  };

  const test = async () => {
    setBusy(true);
    play('click');
    try {
      await window.oc.llm.test(index);
      await onTested();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`slot-card section${slot.enabled && info ? ' on' : ''}${ready ? ' ready' : ''}`} data-testid={`llm-slot-${index}`}>
      <div className="slot-head">
        <div className="slot-num">{index + 1}</div>
        <div>
          <div className="h3">LLM {index + 1}</div>
          <div className="tiny muted">
            {ready && roles?.length ? `Quick Play: plays ${roles.join(', ')}` : index === 0 ? 'Required' : 'Optional'}
          </div>
        </div>
        <div className="spacer" />
        {info && <Toggle checked={slot.enabled} onChange={(v) => onChange({ ...slot, enabled: v })} label={`Enable LLM ${index + 1}`} />}
      </div>
      <div className="field">
        <label>Company</label>
        <select className="select" value={slot.provider} onChange={(e) => setProvider(e.target.value)} data-testid={`llm-provider-${index}`}>
          <option value="">— not used —</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {info && (
        <>
          <div className="field">
            <label>Model</label>
            <ModelPicker
              key={`${slot.provider}-${(slot.discoveredModels ?? []).length}`}
              value={slot.model}
              options={models}
              placeholder={info.id === 'local' ? 'e.g. llama3.2-vision' : 'Test the connection to load models'}
              onChange={(m) => onChange({ ...slot, model: m })}
            />
          </div>
          {info.id !== 'mock' && (
            <div className="field">
              <label>API key{info.keyRequired ? '' : ' (optional)'}</label>
              <div className="row">
                <div style={{ flex: 1 }}>
                  <KeyInput placeholder={info.keyPlaceholder} hint={keyHint} onSave={saveKey} testId={`llm-key-${index}`} />
                </div>
                {keyHint?.hasKey && (
                  <button
                    className="btn btn-sm btn-ghost"
                    title="Remove this key"
                    onClick={async () => onCredentials(await window.oc.credentials.clearLLMKey(index))}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
              {keyError && <span className="small" style={{ color: 'var(--bad)' }}>{keyError}</span>}
              {info.keyUrl && (
                <button className="link-btn tiny" onClick={() => void window.oc.app.openExternal(info.keyUrl!)}>
                  Get a key <Icon name="external" size={11} />
                </button>
              )}
            </div>
          )}
          {info.baseUrlEditable && (
            <div className="field">
              <label>Server URL</label>
              <input
                className="input mono"
                value={slot.baseUrl ?? ''}
                placeholder={info.defaultBaseUrl}
                onChange={(e) => onChange({ ...slot, baseUrl: e.target.value })}
              />
            </div>
          )}
          <div className="field">
            <label>Sees pictures</label>
            <Segmented
              value={slot.vision === 'on' ? 'on' : 'auto'}
              onChange={(v) => onChange({ ...slot, vision: v })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'on', label: 'Yes' },
              ]}
            />
            {blind && <span className="input-error">This model cannot see pictures. Choose a vision model.</span>}
          </div>
          <div className="slot-actions">
            <button className="btn btn-sm" onClick={() => void test()} disabled={busy} data-testid={`llm-test-${index}`}>
              <Icon name="refresh" size={14} /> Test connection
            </button>
            <TestStatus test={slot.lastTest} busy={busy} />
          </div>
        </>
      )}
    </div>
  );
}

function ImageCard({
  image,
  keyHint,
  library,
  devMock,
  onChange,
  onCredentials,
  onLibrary,
  onTested,
}: {
  image: ImageSettings;
  keyHint?: { hasKey: boolean; hint?: string };
  library: LibraryStats | null;
  devMock: boolean;
  onChange: (p: Partial<ImageSettings>) => void;
  onCredentials: (c: CredentialStatus) => void;
  onLibrary: (l: LibraryStats) => void;
  onTested: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const info = imageProviderInfo(image.provider);
  const providers = IMAGE_PROVIDERS.filter((p) => !p.devOnly || devMock);

  const test = async () => {
    setBusy(true);
    play('click');
    try {
      await window.oc.images.test();
      await onTested();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="section image-card" data-testid="image-card">
      <div className="field image-source">
        <label>Boards come from</label>
        <Segmented
          value={image.source}
          onChange={(v) => onChange({ source: v })}
          options={[
            { value: 'deck', label: 'Standard deck (free)', title: 'Public-domain engravings that ship with the game' },
            { value: 'generate', label: 'Generate new pictures', title: 'Uses the image generator below (billed by its provider)' },
            { value: 'library', label: 'My folder & library (free)', title: 'Your own pictures plus pictures generated earlier' },
          ]}
        />
      </div>
      <div className="image-card-grid">
        <div className="col" style={{ gap: 14 }}>
          <div className="row">
            <Icon name="image" />
            <div className="h3">Image generator</div>
            <span className="pill">0 or 1 key</span>
          </div>
          <div className="field">
            <label>Company</label>
            <select
              className="select"
              value={image.provider}
              data-testid="image-provider"
              onChange={(e) => {
                const p = imageProviderInfo(e.target.value);
                onChange({
                  provider: (p?.id ?? 'none') as ImageProviderId | 'none',
                  model: p?.defaultModel ?? '',
                  baseUrl: p?.baseUrlEditable ? p.defaultBaseUrl : undefined,
                  source: p ? 'generate' : image.source === 'generate' ? 'deck' : image.source,
                  lastTest: undefined,
                });
              }}
            >
              <option value="none">None — I’ll use the standard deck</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {info && (
            <>
              <div className="field">
                <label>Model</label>
                <ModelPicker key={image.provider} value={image.model} options={info.models} onChange={(m) => onChange({ model: m })} />
              </div>
              {info.keyRequired && (
                <div className="field">
                  <label>API key</label>
                  <div className="row">
                    <div style={{ flex: 1 }}>
                      <KeyInput
                        placeholder={info.keyPlaceholder}
                        hint={keyHint}
                        testId="image-key"
                        onSave={async (k) => {
                          const res = await window.oc.credentials.setImageKey(k);
                          if (res.ok) onCredentials(res.data);
                        }}
                      />
                    </div>
                    {keyHint?.hasKey && (
                      <button className="btn btn-sm btn-ghost" title="Remove this key" onClick={async () => onCredentials(await window.oc.credentials.clearImageKey())}>
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </div>
                  {info.keyUrl && (
                    <button className="link-btn tiny" onClick={() => void window.oc.app.openExternal(info.keyUrl!)}>
                      Get a key <Icon name="external" size={11} />
                    </button>
                  )}
                </div>
              )}
              {info.baseUrlEditable && (
                <div className="field">
                  <label>Server URL</label>
                  <input className="input mono" value={image.baseUrl ?? ''} placeholder={info.defaultBaseUrl} onChange={(e) => onChange({ baseUrl: e.target.value })} />
                </div>
              )}
              <div className="field">
                <label>Quality</label>
                <Segmented
                  value={image.quality}
                  onChange={(q) => onChange({ quality: q })}
                  options={[
                    { value: 'low', label: 'Low (cheapest)' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'high', label: 'High' },
                  ]}
                />
              </div>
              <div className="slot-actions">
                <button className="btn btn-sm" onClick={() => void test()} disabled={busy} data-testid="image-test">
                  <Icon name="refresh" size={14} /> Test connection
                </button>
                <TestStatus test={image.lastTest} busy={busy} />
              </div>
            </>
          )}
        </div>
        <div className="col folder-col" style={{ gap: 12 }}>
          <div className="row">
            <Icon name="folder" />
            <div className="h3">Your picture folder</div>
            <span className="pill">optional</span>
          </div>
          <div className="folder-path mono small">{image.folder ?? 'No folder chosen'}</div>
          <div className="row wrap">
            <button
              className="btn btn-sm"
              onClick={async () => {
                const l = await window.oc.images.chooseFolder();
                if (l) {
                  onLibrary(l);
                  onChange({ folder: l.folderPath });
                }
              }}
            >
              <Icon name="folder" size={14} /> Choose folder…
            </button>
            {image.folder && (
              <button className="btn btn-sm btn-ghost" onClick={async () => onLibrary(await window.oc.images.rescanFolder())}>
                <Icon name="refresh" size={14} /> Rescan
              </button>
            )}
          </div>
          {library && (
            <div className="library-stats">
              <div>
                <strong>{library.folder}</strong>
                <span>from your folder</span>
              </div>
              <div>
                <strong>{library.generated}</strong>
                <span>generated earlier</span>
              </div>
              <div>
                <strong>{library.total}</strong>
                <span>usable in total</span>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
