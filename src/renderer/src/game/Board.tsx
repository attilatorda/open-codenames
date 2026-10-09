import { useEffect, useRef, useState } from 'react';
import type { CardKind } from '@core/types';
import { Icon } from '../components/Icon';
import { Modal } from '../components/ui';
import { kindClass, kindName } from './text';
import { play } from '../audio/sfx';
import { imageSrc } from '../imageSrc';

/** What the board is allowed to show for a card. `secret` is only set for viewers entitled to the key. */
export interface BoardCard {
  id: number;
  coord: string;
  imageId: string;
  revealed: boolean;
  revealedKind?: CardKind;
  secret?: CardKind;
}

export interface BoardProps {
  cards: BoardCard[];
  rows: number;
  cols: number;
  selectable: boolean;
  selected: number | null;
  onSelect: (id: number | null) => void;
  onConfirm: (id: number) => void;
  pointing?: { cardId: number; name: string; team: 'A' | 'B' } | null;
}

const MIN_SCALE = 1;
const MAX_SCALE = 3;
const clampScale = (v: number) => Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, v)) * 100) / 100;

/** Board zoom: Ctrl+wheel toward the cursor, +/−/0 keys and buttons; drag or scroll to pan when zoomed. */
function useBoardZoom() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScaleState] = useState(1);
  const scaleRef = useRef(1);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const setScale = (next: number, anchor?: { x: number; y: number }) => {
    const wrap = wrapRef.current;
    const prev = scaleRef.current;
    const s = clampScale(next);
    if (s === prev) return;
    scaleRef.current = s;
    setScaleState(s);
    if (!wrap) return;
    // Keep the point under the cursor (or the centre) where it is.
    const ax = anchor ? anchor.x : wrap.clientWidth / 2;
    const ay = anchor ? anchor.y : wrap.clientHeight / 2;
    const cx = (wrap.scrollLeft + ax) / prev;
    const cy = (wrap.scrollTop + ay) / prev;
    requestAnimationFrame(() => {
      wrap.scrollLeft = cx * s - ax;
      wrap.scrollTop = cy * s - ay;
    });
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      setScale(scaleRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === '+' || e.key === '=') setScale(scaleRef.current + 0.25);
      else if (e.key === '-' || e.key === '_') setScale(scaleRef.current - 0.25);
      else if (e.key === '0') setScale(1);
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      wrap.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const panHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (scaleRef.current <= 1 || e.button !== 0 || !wrapRef.current) return;
      drag.current = { x: e.clientX, y: e.clientY, left: wrapRef.current.scrollLeft, top: wrapRef.current.scrollTop, moved: false };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      const wrap = wrapRef.current;
      if (!d || !wrap) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 5) return;
      d.moved = true;
      wrap.scrollLeft = d.left - dx;
      wrap.scrollTop = d.top - dy;
    },
    onPointerUp: () => {
      suppressClick.current = !!drag.current?.moved;
      drag.current = null;
    },
    onClickCapture: (e: React.MouseEvent) => {
      // A drag that pans the board must not also select a picture.
      if (suppressClick.current) {
        e.stopPropagation();
        e.preventDefault();
        suppressClick.current = false;
      }
    },
  };

  return { wrapRef, scale, setScale, panHandlers };
}

export function Board({ cards, rows, cols, selectable, selected, onSelect, onConfirm, pointing }: BoardProps) {
  const [zoom, setZoom] = useState<BoardCard | null>(null);
  const { wrapRef, scale, setScale, panHandlers } = useBoardZoom();

  useEffect(() => {
    if (!selectable) onSelect(null);
  }, [selectable]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="board-area">
    <div className={`board-wrap${scale > 1 ? ' zoomed' : ''}`} ref={wrapRef} {...panHandlers}>
      <div className="board" style={{ '--cols': cols, '--rows': rows, '--zoom': scale } as React.CSSProperties} data-testid="board">
        {cards.map((c) => (
          <CardTile
            key={c.id}
            card={c}
            selectable={selectable && !c.revealed}
            selected={selected === c.id}
            pointing={pointing?.cardId === c.id ? pointing : null}
            onClick={() => {
              if (!selectable || c.revealed) return;
              if (selected === c.id) onConfirm(c.id);
              else {
                play('click');
                onSelect(c.id);
              }
            }}
            onConfirm={() => onConfirm(c.id)}
            onZoom={() => setZoom(c)}
          />
        ))}
      </div>
      {zoom && (
        <Modal onClose={() => setZoom(null)} width={760}>
          <div className="zoom">
            <img src={imageSrc(zoom.imageId)} alt={`Picture ${zoom.coord}`} />
            <div className="row zoom-foot">
              <span className="coord-tag mono">{zoom.coord}</span>
              {zoom.revealed && zoom.revealedKind && <span className={`pill kind-${kindClass(zoom.revealedKind)}`}>{kindName(zoom.revealedKind)}</span>}
              {!zoom.revealed && zoom.secret && <span className={`pill kind-${kindClass(zoom.secret)}`}>Secret: {kindName(zoom.secret)}</span>}
              <div className="spacer" />
              <button className="btn btn-sm" onClick={() => setZoom(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
      <div className="zoom-controls" aria-label="Board zoom">
        <button type="button" onClick={() => setScale(scale - 0.25)} disabled={scale <= MIN_SCALE} title="Zoom out (−)" data-testid="zoom-out">
          −
        </button>
        <button type="button" className="zoom-level" onClick={() => setScale(1)} title="Fit the board (0) · Ctrl+wheel to zoom">
          {Math.round(scale * 100)}%
        </button>
        <button type="button" onClick={() => setScale(scale + 0.25)} disabled={scale >= MAX_SCALE} title="Zoom in (+)" data-testid="zoom-in">
          +
        </button>
      </div>
    </div>
  );
}

function CardTile({
  card,
  selectable,
  selected,
  pointing,
  onClick,
  onConfirm,
  onZoom,
}: {
  card: BoardCard;
  selectable: boolean;
  selected: boolean;
  pointing: BoardProps['pointing'];
  onClick: () => void;
  onConfirm: () => void;
  onZoom: () => void;
}) {
  const kind = card.revealedKind;
  const classes = [
    'card',
    card.revealed ? `revealed kind-${kindClass(kind!)}` : '',
    !card.revealed && card.secret ? `secret secret-${kindClass(card.secret)}` : '',
    selectable ? 'selectable' : '',
    selected ? 'selected' : '',
    pointing ? `pointing point-${pointing.team === 'A' ? 'green' : 'red'}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={classes}
      onClick={onClick}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-label={`Picture ${card.coord}${card.revealed && kind ? `, ${kindName(kind)}` : ''}`}
      data-coord={card.coord}
      onKeyDown={(e) => {
        if (selectable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="card-inner">
        <div className="card-face front">
          <img src={imageSrc(card.imageId)} alt="" draggable={false} />
          {card.secret && !card.revealed && (
            <span className={`secret-badge secret-${kindClass(card.secret)}`} title={`Secret: ${kindName(card.secret)}`}>
              {card.secret === 'ASSASSIN' ? <Icon name="skull" size={14} /> : card.secret === 'NEUTRAL' ? '–' : card.secret === 'A' ? 'G' : 'R'}
            </span>
          )}
        </div>
        <div className="card-face back">
          <img src={imageSrc(card.imageId)} alt="" draggable={false} />
          {kind && <span className={`stamp kind-${kindClass(kind)}`}>{kind === 'ASSASSIN' ? '☠ Assassin' : kindName(kind)}</span>}
        </div>
      </div>
      <span className="coord-tag mono">{card.coord}</span>
      <button
        type="button"
        className="zoom-btn"
        title="Enlarge picture"
        onClick={(e) => {
          e.stopPropagation();
          onZoom();
        }}
      >
        <Icon name="eye" size={14} />
      </button>
      {selected && (
        <button
          type="button"
          className="reveal-btn"
          onClick={(e) => {
            e.stopPropagation();
            onConfirm();
          }}
          data-testid="reveal"
        >
          Reveal
        </button>
      )}
      {pointing && (
        <span className="pointer-badge" title={pointing.name}>
          {pointing.name}
        </span>
      )}
    </div>
  );
}
