import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Upload, Mic, Youtube, StickyNote, Flag, X, FolderOpen, FileAudio } from 'lucide-react';
import { Clip, CLIP_HEAD, GAIN_MIN_DB, GAIN_MAX_DB } from './Clip';
import { TrackHeader } from './TrackHeader';
import { usePlayhead, playhead } from '../lib/playhead';
import { clamp, clipEnd, dbToGain, fmtTime, gainToDb, projectDuration } from '../lib/utils';

export const HEADER_W = 248;
const RULER_H = 26;
const MARKER_H = 34;
export const TRACK_H = 108;
/** Drag-Typ für Einträge aus der Sound-Liste. */
export const SOUND_MIME = 'application/x-mixtape-sound';

/* ------------------------------------------------------------------ */
/* Lineal                                                              */
/* ------------------------------------------------------------------ */

function pickStep(zoom) {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((s) => s * zoom >= 80) ?? 600;
}

const Ruler = memo(function Ruler({ width, zoom, onScrub }) {
  const step = pickStep(zoom);
  const labels = [];
  for (let t = 0; t * zoom < width; t += step) {
    labels.push(
      <div key={t} className="absolute top-0 h-full border-l border-ink-500/70" style={{ left: t * zoom }}>
        <span className="absolute left-1 top-0.5 text-[10px] tabular-nums text-ink-400">{fmtTime(t, step < 1)}</span>
      </div>,
    );
  }
  const minor = (step / 5) * zoom;
  return (
    <div
      className="relative cursor-pointer border-b border-ink-700 bg-ink-900"
      style={{
        height: RULER_H,
        width,
        backgroundImage: 'linear-gradient(to right, rgb(139 128 168 / 0.35) 1px, transparent 1px)',
        backgroundSize: `${minor}px 6px`,
        backgroundRepeat: 'repeat-x',
        backgroundPosition: 'bottom left',
      }}
      onPointerDown={onScrub}
      title="Klicken oder ziehen, um die Abspielposition zu setzen"
    >
      {labels}
      <RulerHead zoom={zoom} />
    </div>
  );
});

function RulerHead({ zoom }) {
  const t = usePlayhead();
  return (
    <div className="absolute top-0 pointer-events-none" style={{ left: t * zoom - 6 }}>
      <div className="w-0 h-0 border-x-[6px] border-x-transparent border-t-[9px] border-t-tape-400 mt-[15px]" />
    </div>
  );
}

function PlayheadLine({ zoom }) {
  const t = usePlayhead();
  return (
    <div
      className="absolute top-0 bottom-0 w-px bg-tape-400 z-20 pointer-events-none shadow-[0_0_8px_rgba(255,93,143,0.8)]"
      style={{ left: HEADER_W + t * zoom }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Marker / Notizen                                                    */
/* ------------------------------------------------------------------ */

const MarkerLane = memo(function MarkerLane({ markers, width, zoom, selectedId, onMarkerDown, onAdd }) {
  return (
    <div
      className="relative border-b border-ink-700 bg-ink-900/90"
      style={{ height: MARKER_H, width }}
      onDoubleClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onAdd((e.clientX - r.left) / zoom);
      }}
      title="Doppelklick: Notiz / Marker hinzufügen"
    >
      {markers.map((m) => {
        const sel = m.id === selectedId;
        return (
          <div
            key={m.id}
            className="absolute top-1 flex items-start cursor-grab active:cursor-grabbing"
            style={{ left: m.time * zoom }}
            onPointerDown={(e) => onMarkerDown(e, m)}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <div className="w-0.5 h-7 rounded-full" style={{ background: m.color }} />
            <div
              className={`ml-0.5 max-w-56 truncate rounded-md rounded-tl-none px-1.5 py-0.5 text-[11px] font-medium text-ink-950 flex items-center gap-1 ${
                sel ? 'ring-2 ring-white' : ''
              }`}
              style={{ background: m.color }}
              title={m.note || m.text}
            >
              {m.chapter ? <Flag size={10} className="shrink-0" /> : <StickyNote size={10} className="shrink-0" />}
              <span className="truncate">{m.text || 'Notiz'}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
});

/** Dünne Linien der Marker durch alle Spuren. */
const MarkerGuides = memo(function MarkerGuides({ markers, zoom }) {
  return markers.map((m) => (
    <div
      key={m.id}
      className="absolute top-0 bottom-0 w-px pointer-events-none z-[5] opacity-40"
      style={{ left: HEADER_W + m.time * zoom, background: m.color }}
    />
  ));
});

/* ------------------------------------------------------------------ */
/* Spur-Inhalt                                                         */
/* ------------------------------------------------------------------ */

const Lane = memo(function Lane({ track, clips, sources, zoom, width, selectedClipId, onLaneDown, onClipDown, onGainReset, dropHover }) {
  const sorted = useMemo(() => [...clips].sort((a, b) => a.start - b.start), [clips]);
  const gaps = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const end = clipEnd(sorted[i]);
    const gap = sorted[i + 1].start - end;
    if (gap > 0.1 && gap * zoom > 50) {
      gaps.push(
        <div
          key={sorted[i].id}
          className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none"
          style={{ left: end * zoom, width: gap * zoom }}
        >
          <span className="rounded-full bg-ink-800/90 border border-ink-600 px-1.5 text-[10px] text-ink-400 tabular-nums">
            ↔ {gap.toFixed(1)} s
          </span>
        </div>,
      );
    }
  }
  return (
    <div
      className={`relative border-b border-ink-700/80 lane-bg ${dropHover ? 'bg-tape-500/10' : ''}`}
      style={{ width, height: TRACK_H, backgroundSize: `${pickStep(zoom) * zoom}px 100%` }}
      onPointerDown={(e) => onLaneDown(e, track.id)}
    >
      {gaps}
      {sorted.map((c) => (
        <Clip
          key={c.id}
          clip={c}
          source={sources.get(c.sourceId)}
          zoom={zoom}
          height={TRACK_H - 8}
          selected={c.id === selectedClipId}
          color={track.color}
          onHandleDown={onClipDown}
          onGainReset={onGainReset}
        />
      ))}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export function Timeline({
  doc,
  docRef,
  sources,
  srcVersion,
  zoom,
  setZoom,
  selection,
  selectedTrackId,
  recordingTrackId,
  magnet,
  playing,
  scrollRef,
  set,
  commitFrom,
  onSelect,
  onSelectTrack,
  onSeek,
  onAddMarker,
  onDropFiles,
  onDropSound,
  onTrackChange,
  onDeleteTrack,
  onCloseGaps,
  onAddTrack,
  onBeginEdit,
  onEndEdit,
  onImport,
  onRecord,
  onYoutube,
  onOpenProject,
  recentProjects = [],
  showStart,
  onDismissStart,
}) {
  const tracksRef = useRef(null);
  const [viewW, setViewW] = useState(1200);
  const [dropTrack, setDropTrack] = useState(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth - HEADER_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

  const duration = projectDuration(doc);
  const width = Math.ceil(Math.max(duration + 90, viewW / zoom) * zoom);

  const clipsByTrack = useMemo(() => {
    const m = new Map(doc.tracks.map((t) => [t.id, []]));
    for (const c of doc.clips) m.get(c.trackId)?.push(c);
    return m;
  }, [doc.clips, doc.tracks]);

  const timeAt = useCallback(
    (clientX) => {
      const el = scrollRef.current;
      const r = el.getBoundingClientRect();
      return Math.max(0, (clientX - r.left - HEADER_W + el.scrollLeft) / zoom);
    },
    [zoom, scrollRef],
  );

  const trackIndexAt = useCallback((clientY) => {
    const r = tracksRef.current.getBoundingClientRect();
    return Math.floor((clientY - r.top) / TRACK_H);
  }, []);

  /* ---------- Ziehen von Clips ---------- */
  const onClipDown = useCallback(
    (e, clip, mode) => {
      e.stopPropagation();
      e.preventDefault();
      onSelect({ type: 'clip', id: clip.id });
      onSelectTrack(clip.trackId);

      const snapshot = docRef.current;
      const orig = { ...clip, fadeIn: clip.fadeIn || 0, fadeOut: clip.fadeOut || 0 };
      const x0 = e.clientX;
      const y0 = e.clientY;
      const src = sources.get(clip.sourceId);
      const maxLen = src?.buffer?.duration ?? clip.offset + clip.duration;
      const tol = 10 / zoom;
      const snapPts = magnet
        ? [
            0,
            playhead.get(),
            ...snapshot.markers.map((m) => m.time),
            ...snapshot.clips.filter((c) => c.id !== clip.id).flatMap((c) => [c.start, clipEnd(c)]),
          ]
        : [];
      const snap = (t) => {
        let best = null;
        let bd = tol;
        for (const p of snapPts) {
          const d = Math.abs(p - t);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        return best;
      };
      let moved = false;

      const move = (ev) => {
        const dx = ev.clientX - x0;
        if (!moved && Math.abs(dx) < 3 && Math.abs(ev.clientY - y0) < 3) return;
        moved = true;
        const dt = dx / zoom;
        let patch;
        if (mode === 'move') {
          let start = Math.max(0, orig.start + dt);
          const s1 = snap(start);
          const s2 = snap(start + orig.duration);
          if (s1 != null && (s2 == null || Math.abs(s1 - start) <= Math.abs(s2 - start - orig.duration))) start = s1;
          else if (s2 != null) start = Math.max(0, s2 - orig.duration);
          const tracks = docRef.current.tracks;
          const idx = clamp(trackIndexAt(ev.clientY), 0, tracks.length - 1);
          patch = { start, trackId: tracks[idx].id };
        } else if (mode === 'trim-l') {
          let ns = orig.start + clamp(dt, -Math.min(orig.offset, orig.start), orig.duration - 0.1);
          const s = snap(ns);
          if (s != null) ns = s;
          const d = clamp(ns - orig.start, -Math.min(orig.offset, orig.start), orig.duration - 0.1);
          const dur = orig.duration - d;
          patch = { start: orig.start + d, offset: orig.offset + d, duration: dur, fadeIn: Math.min(orig.fadeIn, dur - orig.fadeOut) };
        } else if (mode === 'trim-r') {
          let end = orig.start + clamp(orig.duration + dt, 0.1, maxLen - orig.offset);
          const s = snap(end);
          if (s != null) end = s;
          const dur = clamp(end - orig.start, 0.1, maxLen - orig.offset);
          patch = { duration: dur, fadeOut: Math.min(orig.fadeOut, Math.max(0, dur - orig.fadeIn)) };
        } else if (mode === 'fade-in') {
          patch = { fadeIn: clamp(orig.fadeIn + dt, 0, orig.duration - orig.fadeOut) };
        } else if (mode === 'gain') {
          // Linear in dB: ganze Clip-Höhe = gesamter Regelbereich
          const bodyH = TRACK_H - 8 - CLIP_HEAD;
          const db0 = clamp(gainToDb(orig.gain ?? 1), GAIN_MIN_DB, GAIN_MAX_DB);
          let db = clamp(db0 - ((ev.clientY - y0) * (GAIN_MAX_DB - GAIN_MIN_DB)) / bodyH, GAIN_MIN_DB, GAIN_MAX_DB);
          if (Math.abs(db) < 0.4) db = 0; // rastet bei 0 dB ein
          patch = { gain: db <= GAIN_MIN_DB ? 0 : dbToGain(Math.round(db * 10) / 10) };
        } else if (mode === 'fade-out') {
          patch = { fadeOut: clamp(orig.fadeOut - dt, 0, orig.duration - orig.fadeIn) };
        }
        set((d) => ({ ...d, clips: d.clips.map((c) => (c.id === clip.id ? { ...c, ...patch } : c)) }), false);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        commitFrom(snapshot);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [zoom, magnet, sources, set, commitFrom, onSelect, onSelectTrack, trackIndexAt, docRef],
  );

  const onGainReset = useCallback(
    (clip) => set((d) => ({ ...d, clips: d.clips.map((c) => (c.id === clip.id ? { ...c, gain: 1 } : c)) })),
    [set],
  );

  /* ---------- Marker ziehen ---------- */
  const onMarkerDown = useCallback(
    (e, marker) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      onSelect({ type: 'marker', id: marker.id });
      const snapshot = docRef.current;
      const x0 = e.clientX;
      const move = (ev) => {
        const time = Math.max(0, marker.time + (ev.clientX - x0) / zoom);
        set((d) => ({ ...d, markers: d.markers.map((m) => (m.id === marker.id ? { ...m, time } : m)) }), false);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        commitFrom(snapshot);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [zoom, set, commitFrom, onSelect, docRef],
  );

  /* ---------- Klick in Spur / Lineal ---------- */
  const onLaneDown = useCallback(
    (e, trackId) => {
      if (e.button !== 0) return;
      onSelect(null);
      onSelectTrack(trackId);
      onSeek(timeAt(e.clientX));
    },
    [onSelect, onSelectTrack, onSeek, timeAt],
  );

  const onScrub = useCallback(
    (e) => {
      if (e.button !== 0) return;
      onSeek(timeAt(e.clientX));
      const move = (ev) => onSeek(timeAt(ev.clientX));
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [onSeek, timeAt],
  );

  /* ---------- Zoom mit Strg + Mausrad ---------- */
  useEffect(() => {
    const el = scrollRef.current;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mouseX = e.clientX - r.left - HEADER_W;
      const tAtMouse = (mouseX + el.scrollLeft) / zoom;
      const next = clamp(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 2, 400);
      setZoom(next);
      requestAnimationFrame(() => (el.scrollLeft = tAtMouse * next - mouseX));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, setZoom, scrollRef]);

  /* ---------- Auto-Scroll beim Abspielen ---------- */
  // Die Ansicht folgt dem Abspielpunkt nur, solange er sichtbar ist. Scrollt man selbst weg,
  // pausiert das Mitlaufen, bis der Abspielpunkt wieder im Bild ist oder man springt (Pos1, Klick …).
  useEffect(() => {
    if (!playing) return;
    const el = scrollRef.current;
    if (!el) return;
    let follow = true;
    let expected = null;
    let last = playhead.get();

    const onScroll = () => {
      if (expected != null && Math.abs(el.scrollLeft - expected) < 2) return;
      expected = null;
      follow = false;
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    const unsubscribe = playhead.subscribe(() => {
      const t = playhead.get();
      const jumped = Math.abs(t - last) > 1;
      last = t;
      const x = t * zoom;
      const visible = el.clientWidth - HEADER_W;
      const inView = x >= el.scrollLeft && x <= el.scrollLeft + visible;
      if (inView || jumped) follow = true;
      if (!follow) return;
      if (x > el.scrollLeft + visible - 40 || x < el.scrollLeft) {
        expected = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, x - 80));
        el.scrollLeft = expected;
      }
    });

    return () => {
      unsubscribe();
      el.removeEventListener('scroll', onScroll);
    };
  }, [playing, zoom, scrollRef]);

  /* ---------- Drag & Drop von Dateien ---------- */
  const dropTarget = (e) => {
    const idx = trackIndexAt(e.clientY);
    return idx >= 0 && idx < doc.tracks.length ? doc.tracks[idx].id : null;
  };
  const onDragOver = (e) => {
    const types = e.dataTransfer.types;
    if (!types.includes('Files') && !types.includes(SOUND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropTrack(dropTarget(e) ?? 'new');
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDropTrack(null);
    const soundId = e.dataTransfer.getData(SOUND_MIME);
    if (soundId) {
      onDropSound(soundId, dropTarget(e), timeAt(e.clientX));
      return;
    }
    const files = [...e.dataTransfer.files];
    if (files.length) onDropFiles(files, dropTarget(e), timeAt(e.clientX));
  };

  const selectedClipId = selection?.type === 'clip' ? selection.id : null;
  const selectedMarkerId = selection?.type === 'marker' ? selection.id : null;
  const empty = doc.clips.length === 0;

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto relative bg-ink-950"
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setDropTrack(null)}
      onDrop={onDrop}
    >
      <div className="relative min-h-full" style={{ width: HEADER_W + width }}>
        {/* Kopfzeile: Lineal + Marker */}
        <div className="sticky top-0 z-40 flex">
          <div
            className="sticky left-0 z-50 shrink-0 bg-ink-900 border-r border-b border-ink-700 flex flex-col justify-center px-3"
            style={{ width: HEADER_W, height: RULER_H + MARKER_H }}
          >
            <div className="text-[11px] uppercase tracking-wider text-ink-500">Gesamtlänge</div>
            <div className="text-sm font-semibold tabular-nums text-ink-200">
              {fmtTime(duration)} min · {doc.clips.length} Clips
            </div>
          </div>
          <div>
            <Ruler width={width} zoom={zoom} onScrub={onScrub} />
            <MarkerLane
              markers={doc.markers}
              width={width}
              zoom={zoom}
              selectedId={selectedMarkerId}
              onMarkerDown={onMarkerDown}
              onAdd={(t) => onAddMarker(t)}
            />
          </div>
        </div>

        {/* Spuren */}
        <div ref={tracksRef}>
          {doc.tracks.map((t) => (
            <div key={t.id} className="flex">
              <TrackHeader
                track={t}
                selected={t.id === selectedTrackId}
                recording={t.id === recordingTrackId}
                width={HEADER_W}
                height={TRACK_H}
                onChange={onTrackChange}
                onSelect={onSelectTrack}
                onDelete={onDeleteTrack}
                onCloseGaps={onCloseGaps}
                onBeginEdit={onBeginEdit}
                onEndEdit={onEndEdit}
              />
              <Lane
                track={t}
                clips={clipsByTrack.get(t.id)}
                sources={sources}
                srcVersion={srcVersion}
                zoom={zoom}
                width={width}
                selectedClipId={selectedClipId}
                onLaneDown={onLaneDown}
                onClipDown={onClipDown}
                onGainReset={onGainReset}
                dropHover={dropTrack === t.id}
              />
            </div>
          ))}
        </div>

        {/* Neue Spur */}
        <div className="flex">
          <div className="sticky left-0 z-30 shrink-0 p-2 bg-ink-950" style={{ width: HEADER_W }}>
            <button
              type="button"
              onClick={onAddTrack}
              className="w-full h-10 rounded-lg border border-dashed border-ink-600 text-sm text-ink-400 hover:text-white hover:border-ink-400 flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Spur hinzufügen
            </button>
          </div>
          <div
            className={`flex-1 m-2 rounded-lg border border-dashed flex items-center px-4 text-xs ${
              dropTrack === 'new' ? 'border-tape-400 text-tape-400 bg-tape-500/10' : 'border-ink-800 text-ink-600'
            }`}
            style={{ height: 40 }}
          >
            Dateien hier ablegen, um eine neue Spur zu erstellen
          </div>
        </div>

        <MarkerGuides markers={doc.markers} zoom={zoom} />
        <PlayheadLine zoom={zoom} />

        {/* Startdialog (leeres Projekt) */}
        {empty && showStart && (
          <div
            className="absolute z-20 pointer-events-none flex justify-center"
            style={{ left: HEADER_W, top: RULER_H + MARKER_H + 40, width: Math.min(width, viewW) }}
          >
            <div className="relative pointer-events-auto rounded-2xl border border-ink-700 bg-ink-850/95 backdrop-blur px-8 py-7 text-center shadow-2xl max-w-xl w-full">
              <button
                type="button"
                onClick={onDismissStart}
                title="Schließen"
                className="absolute top-3 right-3 size-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-white hover:bg-ink-700"
              >
                <X size={18} />
              </button>
              <div className="text-lg font-semibold text-white">Los geht’s mit deinem Mixtape 🎶</div>
              <p className="mt-1.5 text-sm text-ink-400">
                Zieh MP3s (oder andere Audiodateien) einfach in eine Spur, nimm etwas mit dem Mikrofon auf oder hol dir einen Song von YouTube.
              </p>
              <div className="mt-5 flex justify-center gap-2">
                <button type="button" onClick={onImport} className="h-9 px-3.5 rounded-lg bg-ink-700 hover:bg-ink-600 text-sm flex items-center gap-2">
                  <Upload size={16} /> Dateien wählen
                </button>
                <button type="button" onClick={onYoutube} className="h-9 px-3.5 rounded-lg bg-ink-700 hover:bg-ink-600 text-sm flex items-center gap-2">
                  <Youtube size={16} /> YouTube
                </button>
                <button type="button" onClick={onRecord} className="h-9 px-3.5 rounded-lg bg-tape-500 hover:bg-tape-400 text-white text-sm flex items-center gap-2">
                  <Mic size={16} /> Aufnehmen
                </button>
              </div>

              <div className="mt-6 pt-5 border-t border-ink-700 text-left">
                <div className="flex items-center mb-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-ink-400">Zuletzt geöffnet</span>
                  <button
                    type="button"
                    onClick={() => onOpenProject()}
                    className="ml-auto text-xs text-ink-400 hover:text-white flex items-center gap-1.5"
                  >
                    <FolderOpen size={14} /> Anderes Projekt öffnen …
                  </button>
                </div>
                {recentProjects.length ? (
                  <div className="flex flex-col gap-1">
                    {recentProjects.map((r) => (
                      <button
                        key={r.path}
                        type="button"
                        onClick={() => onOpenProject(r.path)}
                        title={r.path}
                        className="w-full rounded-lg px-3 py-2 flex items-center gap-3 text-left hover:bg-ink-700/70 group"
                      >
                        <FileAudio size={18} className="shrink-0 text-tape-400" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-ink-200 group-hover:text-white truncate">{r.title}</span>
                          <span className="block text-[11px] text-ink-500 truncate">{r.path}</span>
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-500">
                          {new Date(r.openedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-ink-500 px-1">Noch keine Projekte gespeichert.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
