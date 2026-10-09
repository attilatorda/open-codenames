import { useEffect, useMemo, useState } from 'react';
import { LAYOUTS, getLayout, layoutSize } from '@core/board/layouts';
import { CONCEPT_SETS } from '@core/board/conceptBank';
import { ART_STYLES, MIXED_STYLE_ID } from '@core/images/promptBuilder';
import { getMode, type SeatSpec } from '@core/modes/gameModes';
import { TEAM_NAMES } from '@core/teams';
import type { Role } from '@core/types';
import type { LibraryStats, SlotInfo } from '@shared/ipc';
import type { DeckInfo } from '@shared/deck';
import { imageProviderInfo } from '@shared/providers';
import { useApp } from '../state/AppContext';
import { Icon } from '../components/Icon';
import { Avatar, Segmented } from '../components/ui';
import { buildMatchConfig, imageSourceFor, nextHumanRole, readySlots } from '../game/matchConfig';
import { teamClass } from '../game/text';
import { play } from '../audio/sfx';

type SeatChoice = 'spectate' | `${'A' | 'B'}-${Role}`;

export function MatchSetupScreen({ modeId }: { modeId: string }) {
  const { settings, updateSettings, navigate, replaceSettings } = useApp();
  const mode = getMode(modeId);
  const g = settings.gameplay;
  const [slots, setSlots] = useState<SlotInfo[] | null>(null);
  const [library, setLibrary] = useState<LibraryStats | null>(null);
  const [decks, setDecks] = useState<DeckInfo[] | null>(null);
  const [deckId, setDeckId] = useState(settings.image.deckId || 'grandville');
  const deckSize = decks ? (decks.find((d) => d.id === deckId) ?? decks[0])?.cards.length ?? 0 : null;
  const deckName = decks?.find((d) => d.id === deckId)?.name ?? 'Standard deck';
  const [roleChoice, setRoleChoice] = useState<Role>(nextHumanRole(settings));
  const [layoutId, setLayoutId] = useState(g.layoutId);
  const [styleId, setStyleId] = useState(g.styleId);
  const [conceptSet, setConceptSet] = useState(g.conceptSet ?? 'surreal');
  const [seats, setSeats] = useState<SeatSpec[] | null>(null);

  useEffect(() => {
    void window.oc.images.decks().then(setDecks);
    void Promise.all([window.oc.llm.slots(), window.oc.images.library(), window.oc.settings.get()]).then(([s, l, fresh]) => {
      replaceSettings(fresh);
      setLayoutId(fresh.gameplay.layoutId);
      setStyleId(fresh.gameplay.styleId);
      setDeckId(fresh.image.deckId || 'grandville');
      setConceptSet(fresh.gameplay.conceptSet ?? 'surreal');
      setSlots(s);
      setLibrary(l);
      if (mode.id !== 'quick') setSeats(mode.defaultSeats!({ humanRole: roleChoice, slots: readySlots(s) }));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = slots?.filter((s) => s.ready) ?? [];
  const source = imageSourceFor(settings);
  const need = layoutSize(getLayout(layoutId));
  const libraryShort =
    (source === 'library' && (library?.total ?? 0) < need) || (source === 'deck' && deckSize !== null && deckSize < need);
  const modelOf = (slot?: number) => slots?.find((x) => x.slot === slot)?.modelLabel ?? '—';

  const quickSeats = useMemo(
    () => (slots ? getMode('quick').defaultSeats!({ humanRole: roleChoice, slots: readySlots(slots) }) : []),
    [slots, roleChoice],
  );

  const start = async () => {
    if (!slots) return;
    play('click');
    const config = buildMatchConfig(mode.id, settings, slots, {
      humanRole: roleChoice,
      seats: mode.id === 'quick' ? quickSeats : seats ?? undefined,
      layoutId,
      styleId,
      conceptSet,
      deckId,
    });
    await updateSettings({
      gameplay: {
        layoutId,
        styleId,
        conceptSet,
        ...(config.humanRole ? { lastHumanRole: config.humanRole } : {}),
      },
    });
    navigate({ name: 'loading', config });
  };

  const imageLine =
    source === 'deck'
      ? `${deckName} · ${need} of ${deckSize ?? '…'} pictures`
      : source === 'library'
        ? `Your library · ${need} of ${library?.total ?? '…'} pictures`
        : `New pictures from ${imageProviderInfo(settings.image.provider)?.name ?? 'your image generator'}`;

  return (
    <div className="page">

      {slots && ready.length === 0 && (
        <div className="notice notice-bad">
          <Icon name="info" />
          <span>
            No language model is ready.{' '}
            <button className="link-btn" onClick={() => navigate({ name: 'config', first: false })}>
              Open AI configuration
            </button>
          </span>
        </div>
      )}

      <div className="setup-grid">
        <section className="section">
          <h2 className="section-title">Players</h2>
          {mode.id === 'quick' ? (
            <>
              <div className="field">
                <label>Your role</label>
                <Segmented
                  value={roleChoice}
                  onChange={setRoleChoice}
                  options={[
                    { value: 'spymaster', label: 'Spymaster — give clues' },
                    { value: 'operative', label: 'Operative — guess' },
                  ]}
                />
              </div>
              <SeatList seats={quickSeats} modelOf={modelOf} />
            </>
          ) : (
            seats && slots && <SeatEditor seats={seats} onChange={setSeats} slots={ready} allowHuman={!mode.spectator} />
          )}
        </section>

        <section className="section">
          <h2 className="section-title">Board</h2>
          <div className="field">
            <label>Size</label>
            <Segmented
              value={layoutId}
              onChange={setLayoutId}
              options={LAYOUTS.map((l) => ({ value: l.id, label: l.short, title: l.label }))}
            />
          </div>
          {source === 'deck' && decks && decks.length > 1 && (
            <div className="field">
              <label>Collection</label>
              <select className="select" value={deckId} onChange={(e) => setDeckId(e.target.value)} data-testid="setup-collection">
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.cards.length})
                  </option>
                ))}
              </select>
            </div>
          )}
          {source === 'generate' && (
            <>
              <div className="field">
                <label>Subjects</label>
                <select className="select" value={conceptSet} onChange={(e) => setConceptSet(e.target.value as 'surreal' | 'scenes')}>
                  {CONCEPT_SETS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Art style</label>
                <select className="select" value={styleId} onChange={(e) => setStyleId(e.target.value)}>
                  {ART_STYLES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                  <option value={MIXED_STYLE_ID}>Mixed</option>
                </select>
              </div>
            </>
          )}
          <div className="field">
            <label>Pictures</label>
            <div className={`small${libraryShort ? ' t-bad' : ''}`}>{imageLine}</div>
          </div>
        </section>
      </div>

      <div className="page-actions">
        <button
          className="btn btn-primary btn-lg"
          disabled={!slots || ready.length === 0 || libraryShort}
          onClick={() => void start()}
          data-testid="setup-start"
        >
          Start game
        </button>
      </div>
    </div>
  );
}

function SeatList({ seats, modelOf }: { seats: SeatSpec[]; modelOf: (slot?: number) => string }) {
  return (
    <table className="table seat-table">
      <tbody>
        {seats.map((s) => (
          <tr key={`${s.team}-${s.role}`}>
            <td>
              <span className={`t-${teamClass(s.team)} strong`}>{TEAM_NAMES[s.team]}</span>
            </td>
            <td className="cap">{s.role}</td>
            <td>
              <span className="row">
                <Avatar team={s.team} human={s.kind === 'human'} name="AI" size="sm" />
                {s.kind === 'human' ? 'You' : `AI · ${modelOf(s.slot)}`}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SeatEditor({
  seats,
  onChange,
  slots,
  allowHuman,
}: {
  seats: SeatSpec[];
  onChange: (s: SeatSpec[]) => void;
  slots: SlotInfo[];
  allowHuman: boolean;
}) {
  const humanSeat: SeatChoice = (() => {
    const h = seats.find((s) => s.kind === 'human');
    return h ? (`${h.team}-${h.role}` as SeatChoice) : 'spectate';
  })();
  const setHuman = (choice: SeatChoice) => {
    onChange(
      seats.map((s) => {
        const isHuman = `${s.team}-${s.role}` === choice;
        return isHuman
          ? { team: s.team, role: s.role, kind: 'human' as const }
          : { ...s, kind: 'ai' as const, slot: s.slot ?? slots[0]?.slot ?? 0 };
      }),
    );
  };
  const update = (i: number, patch: Partial<SeatSpec>) => onChange(seats.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <>
      {allowHuman && (
        <div className="field">
          <label>Your seat</label>
          <Segmented
            value={humanSeat}
            onChange={setHuman}
            options={[
              { value: 'A-spymaster', label: `${TEAM_NAMES.A} spymaster` },
              { value: 'A-operative', label: `${TEAM_NAMES.A} operative` },
              { value: 'B-spymaster', label: `${TEAM_NAMES.B} spymaster` },
              { value: 'B-operative', label: `${TEAM_NAMES.B} operative` },
              { value: 'spectate', label: 'Just watch' },
            ]}
          />
        </div>
      )}
      <table className="table seat-table">
        <tbody>
          {seats.map((s, i) => (
            <tr key={`${s.team}-${s.role}`}>
              <td>
                <span className={`t-${teamClass(s.team)} strong`}>{TEAM_NAMES[s.team]}</span>
              </td>
              <td className="cap">{s.role}</td>
              <td>
                {s.kind === 'human' ? (
                  <span className="row">
                    <Avatar human size="sm" team={s.team} /> You
                  </span>
                ) : (
                  <select className="select" value={s.slot} onChange={(e) => update(i, { slot: Number(e.target.value) })}>
                    {slots.map((sl) => (
                      <option key={sl.slot} value={sl.slot}>
                        LLM{sl.slot + 1} · {sl.modelLabel}
                      </option>
                    ))}
                  </select>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
