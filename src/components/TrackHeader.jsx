import React, { memo } from 'react';
import { Megaphone, Magnet, Trash2, Volume2, VolumeX, Headphones, Circle, GripVertical } from 'lucide-react';

function Toggle({ active, onClick, title, children, activeCls }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`h-6 min-w-6 px-1.5 rounded-md text-[11px] font-bold inline-flex items-center justify-center transition-colors ${
        active ? activeCls : 'bg-ink-700/70 text-ink-400 hover:text-white hover:bg-ink-600'
      }`}
    >
      {children}
    </button>
  );
}

export const TrackHeader = memo(function TrackHeader({
  track,
  selected,
  recording,
  width,
  height,
  onChange,
  onSelect,
  onDelete,
  onCloseGaps,
  onBeginEdit,
  onReorderStart,
  onEndEdit,
}) {
  return (
    <div
      className={`sticky left-0 z-30 shrink-0 flex border-r border-b border-ink-700 ${selected ? 'bg-ink-800' : 'bg-ink-850'}`}
      style={{ width, height }}
      onPointerDown={() => onSelect(track.id)}
    >
      <div className="w-1.5 shrink-0" style={{ background: track.color }} />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5 px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="Spur verschieben (ziehen)"
            onPointerDown={(e) => onReorderStart(e, track.id)}
            className="-ml-1.5 -mr-1 text-ink-500 hover:text-white cursor-grab active:cursor-grabbing touch-none"
          >
            <GripVertical size={15} />
          </button>
          {recording && <Circle size={10} className="text-red-500 fill-red-500 rec-pulse shrink-0" />}
          <input
            value={track.name}
            onChange={(e) => onChange(track.id, { name: e.target.value }, false)}
            onFocus={onBeginEdit}
            onBlur={onEndEdit}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-white rounded px-1 -mx-1 hover:bg-ink-700/60 focus:bg-ink-900 focus:outline-none"
          />
          <button
            type="button"
            title="Lücken schließen (Clips aneinanderheften)"
            onClick={() => onCloseGaps(track.id)}
            className="text-ink-500 hover:text-white p-0.5"
          >
            <Magnet size={14} />
          </button>
          <button type="button" title="Spur löschen" onClick={() => onDelete(track.id)} className="text-ink-500 hover:text-red-400 p-0.5">
            <Trash2 size={14} />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <Toggle
            active={track.muted}
            onClick={() => onChange(track.id, { muted: !track.muted })}
            title="Stumm"
            activeCls="bg-amber-500 text-ink-950"
          >
            M
          </Toggle>
          <Toggle
            active={track.solo}
            onClick={() => onChange(track.id, { solo: !track.solo })}
            title="Solo"
            activeCls="bg-emerald-500 text-ink-950"
          >
            S
          </Toggle>
          <Toggle
            active={track.duck}
            onClick={() => onChange(track.id, { duck: !track.duck })}
            title="Sprachspur: Musik automatisch leiser, wenn hier etwas läuft (Ducking)"
            activeCls="bg-sky-500 text-ink-950"
          >
            <Megaphone size={12} className="mr-1" />
            Sprache
          </Toggle>
          {selected && (
            <span className="ml-auto text-[10px] text-tape-400 flex items-center gap-1" title="Aufnahmen und Importe landen in dieser Spur">
              <Headphones size={11} /> Ziel
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 mt-auto">
          <button
            type="button"
            className="text-ink-400 hover:text-white"
            onClick={() => onChange(track.id, { muted: !track.muted })}
            title="Stumm schalten"
          >
            {track.muted || track.volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={track.volume}
            onPointerDown={onBeginEdit}
            onChange={(e) => onChange(track.id, { volume: parseFloat(e.target.value) }, false)}
            onPointerUp={onEndEdit}
            onDoubleClick={() => onChange(track.id, { volume: 1 })}
            className="flex-1 min-w-0"
            title="Spur-Lautstärke (Doppelklick = 100 %)"
          />
          <span className="w-9 text-right text-[11px] tabular-nums text-ink-400">{Math.round(track.volume * 100)}%</span>
        </div>
      </div>
    </div>
  );
});
