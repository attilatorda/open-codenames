import type { ClueSizeMode } from '@core/ai/strategy/clueSize';
import { play } from '../audio/sfx';

const SIZES: ClueSizeMode[] = ['auto', 1, 2, 3, 4];

/** Status-bar buttons for the AI teammate's clue size. */
export function ClueSizeButtons({ value, onChoose }: { value: ClueSizeMode; onChoose: (v: ClueSizeMode) => void }) {
  return (
    <span className="action-buttons" role="group" aria-label="Clue size">
      {SIZES.map((s) => (
        <button
          key={String(s)}
          type="button"
          className={`btn btn-sm ${s === value ? 'btn-primary' : ''}`}
          onClick={() => {
            play('click');
            onChoose(s);
          }}
          data-testid={`clue-size-${s}`}
        >
          {s === 'auto' ? 'Auto' : s}
        </button>
      ))}
    </span>
  );
}
