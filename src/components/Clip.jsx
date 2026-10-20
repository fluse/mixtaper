import React, { memo } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Waveform } from './Waveform';
import { fmtTime, gainToDb } from '../lib/utils';

export const CLIP_HEAD = 18;
const HEAD = CLIP_HEAD;

/** Bereich der Lautstärke-Linie (gleich wie im Regler). */
export const GAIN_MIN_DB = -30;
export const GAIN_MAX_DB = 12;

/** Vertikale Position der Lautstärke-Linie im Clip-Körper. */
export function gainToY(gain, bodyH) {
  const db = Math.max(GAIN_MIN_DB, Math.min(GAIN_MAX_DB, gainToDb(gain)));
  return bodyH * (1 - (db - GAIN_MIN_DB) / (GAIN_MAX_DB - GAIN_MIN_DB));
}

export const Clip = memo(function Clip({ clip, source, zoom, height, selected, color, onHandleDown, onGainReset }) {
  const left = clip.start * zoom;
  const width = Math.max(4, clip.duration * zoom);
  const fi = (clip.fadeIn || 0) * zoom;
  const fo = (clip.fadeOut || 0) * zoom;
  const bodyH = height - HEAD;
  const missing = !source || source.missing;
  const down = (mode) => (e) => {
    if (e.button !== 0) return;
    onHandleDown(e, clip, mode);
  };
  const db = gainToDb(clip.gain ?? 1);
  const gy = gainToY(clip.gain ?? 1, bodyH);
  const dbLabel = db <= GAIN_MIN_DB ? '−∞ dB' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;

  return (
    <div
      className={`group absolute top-1 rounded-lg overflow-hidden cursor-grab active:cursor-grabbing ${
        selected ? 'ring-2 ring-white z-10 shadow-xl shadow-black/40' : 'ring-1 ring-black/30 hover:ring-white/40'
      }`}
      style={{ left, width, height, background: missing ? '#3a1d24' : `${color}26` }}
      onPointerDown={down('move')}
      data-clip={clip.id}
    >
      {/* Titelzeile */}
      <div
        className="flex items-center gap-1 px-1.5 text-[11px] font-medium text-white/95 truncate"
        style={{ height: HEAD, background: missing ? '#7f1d1d' : `${color}b3` }}
      >
        {missing && <TriangleAlert size={11} className="shrink-0" />}
        <span className="truncate">{clip.name}</span>
        {clip.echo && width > 90 && (
          <span className="shrink-0 rounded bg-black/30 px-1 text-[9px] font-semibold uppercase tracking-wide" title="Echo aktiv">
            Echo
          </span>
        )}
        {clip.reverb && width > 90 && (
          <span className="shrink-0 rounded bg-black/30 px-1 text-[9px] font-semibold uppercase tracking-wide" title="Hall aktiv">
            Hall
          </span>
        )}
        {width > 140 && (
          <span className="ml-auto pl-2 shrink-0 text-white/70 tabular-nums">
            {Math.abs(db) > 0.05 && `${db > 0 ? '+' : ''}${db.toFixed(1)} dB · `}
            {fmtTime(clip.duration)}
          </span>
        )}
      </div>

      {/* Wellenform */}
      <div className="absolute left-0 right-0" style={{ top: HEAD, height: bodyH }}>
        {missing ? (
          <div className="p-2 text-[11px] text-red-300/80">Datei nicht gefunden</div>
        ) : (
          <Waveform
            peaks={source.peaks}
            offset={clip.offset}
            duration={clip.duration}
            zoom={zoom}
            height={bodyH}
            gain={clip.gain ?? 1}
            color={selected ? '#ffffffd9' : `${color}e6`}
          />
        )}

        {/* Fade-Kurven */}
        {(fi > 0 || fo > 0) && (
          <svg className="absolute inset-0 pointer-events-none" width={width} height={bodyH}>
            {fi > 0 && <path d={`M0,0 L${fi},0 L${fi},${gy} L0,${bodyH} Z`} fill="rgb(0 0 0 / 0.45)" />}
            {fi > 0 && <line x1={0} y1={bodyH} x2={fi} y2={gy} stroke="white" strokeOpacity="0.75" strokeWidth="1.2" />}
            {fo > 0 && <path d={`M${width - fo},0 L${width},0 L${width},${bodyH} L${width - fo},${gy} Z`} fill="rgb(0 0 0 / 0.45)" />}
            {fo > 0 && <line x1={width - fo} y1={gy} x2={width} y2={bodyH} stroke="white" strokeOpacity="0.75" strokeWidth="1.2" />}
          </svg>
        )}

        {/* Lautstärke-Linie: hoch/runter ziehen, Doppelklick = 0 dB */}
        {!missing && (
          <div
            className="group/gain absolute h-3 -mt-1.5 cursor-ns-resize"
            style={{ top: gy, left: fi, right: fo }}
            onPointerDown={down('gain')}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onGainReset(clip);
            }}
            title="Lautstärke ziehen (Doppelklick = 0 dB)"
          >
            <div
              className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-amber-300 transition-opacity group-hover/gain:h-0.5 group-hover/gain:opacity-100 ${
                selected ? 'opacity-90' : 'opacity-0 group-hover:opacity-50'
              }`}
            />
            {width > 70 && (
              <span
                className="absolute left-1.5 -top-4 rounded bg-amber-300 px-1 text-[10px] font-semibold leading-4 text-ink-950 tabular-nums pointer-events-none opacity-0 group-hover/gain:opacity-100"
              >
                {dbLabel}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Trim-Griffe */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/25"
        onPointerDown={down('trim-l')}
        title="Anfang kürzen"
      />
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/25"
        onPointerDown={down('trim-r')}
        title="Ende kürzen"
      />

      {/* Fade-Griffe */}
      {width > 30 && (
        <>
          <div
            className="absolute size-3 rounded-full bg-white border-2 border-ink-900 cursor-ew-resize opacity-0 group-hover:opacity-100 data-[sel=true]:opacity-100"
            data-sel={selected}
            style={{ top: HEAD - 6, left: Math.min(width - 12, Math.max(2, fi - 6)) }}
            onPointerDown={down('fade-in')}
            title="Fade-In ziehen"
          />
          <div
            className="absolute size-3 rounded-full bg-white border-2 border-ink-900 cursor-ew-resize opacity-0 group-hover:opacity-100 data-[sel=true]:opacity-100"
            data-sel={selected}
            style={{ top: HEAD - 6, left: Math.max(2, Math.min(width - 14, width - fo - 6)) }}
            onPointerDown={down('fade-out')}
            title="Fade-Out ziehen"
          />
        </>
      )}
    </div>
  );
});
