import type { AspectId } from '../types';
import { ASPECTS } from '../model';

export function FormatPicker({ value, onPick }: { value?: AspectId; onPick: (a: AspectId) => void }) {
  return (
    <div className="format-grid">
      {(Object.keys(ASPECTS) as AspectId[]).map((id) => {
        const a = ASPECTS[id];
        const scale = 56 / Math.max(a.w, a.h);
        return (
          <button key={id} className={`format-card ${value === id ? 'active' : ''}`} onClick={() => onPick(id)}>
            <span className="format-shape" style={{ width: a.w * scale, height: a.h * scale }} />
            <strong>{a.label}</strong>
            <small>{a.hint}</small>
            <em>{id}</em>
          </button>
        );
      })}
    </div>
  );
}
