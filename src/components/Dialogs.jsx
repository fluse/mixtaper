import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Youtube, Download, Printer, FileDown, LoaderCircle, TriangleAlert, Check, FolderSearch, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { Modal, Button, Field, Checkbox, ProgressBar, IconButton, inputCls } from './ui';
import { exportMix } from '../lib/exporter';
import { buildChapters, buildChapterText, buildCueSheet, buildTracklist } from '../lib/chapters';
import { buildJCardHtml, JCARD_THEMES } from '../lib/jcard';
import { fmtTime, projectDuration, basename, stripExt } from '../lib/utils';

/* ------------------------------------------------------------------ */
/* YouTube                                                             */
/* ------------------------------------------------------------------ */

export function YouTubeDialog({ tracks, defaultTrackId, onClose, onImported }) {
  const [url, setUrl] = useState('');
  const [trackId, setTrackId] = useState(defaultTrackId);
  const [where, setWhere] = useState('end');
  const [state, setState] = useState({ phase: 'idle' });

  useEffect(() => window.api.onYoutubeProgress((p) => setState((s) => (s.phase === 'loading' ? { ...s, ...p } : s))), []);

  const valid = /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(url.trim());

  const start = async (e) => {
    e?.preventDefault();
    if (!valid) return;
    setState({ phase: 'loading', status: 'Starte …', percent: null });
    try {
      const res = await window.api.youtubeDownload(url.trim());
      setState({ phase: 'decoding', status: 'Füge in die Timeline ein …' });
      await onImported(res, trackId, where);
      onClose();
    } catch (err) {
      const msg = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      setState({ phase: 'error', error: msg });
    }
  };

  const busy = state.phase === 'loading' || state.phase === 'decoding';

  return (
    <Modal title="Von YouTube importieren" icon={Youtube} onClose={onClose} closable={!busy}>
      <form onSubmit={start} className="flex flex-col gap-4">
        <Field label="YouTube-Link">
          <input
            autoFocus
            className={inputCls}
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Spur">
            <select
              className={inputCls}
              value={trackId}
              onChange={(e) => setTrackId(e.target.value)}
              disabled={busy || where === 'library'}
            >
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ziel">
            <select className={inputCls} value={where} onChange={(e) => setWhere(e.target.value)} disabled={busy}>
              <option value="end">Am Ende der Spur anhängen</option>
              <option value="playhead">An der Abspielposition</option>
              <option value="library">Nur in die Sound-Liste</option>
            </select>
          </Field>
        </div>

        {busy && (
          <div className="flex flex-col gap-2">
            <div className="text-sm text-ink-300 flex items-center gap-2">
              <LoaderCircle size={14} className="animate-spin" /> {state.status}
            </div>
            <ProgressBar value={state.percent != null ? state.percent / 100 : null} />
          </div>
        )}
        {state.phase === 'error' && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300 flex gap-2">
            <TriangleAlert size={16} className="shrink-0 mt-0.5" />
            <div className="whitespace-pre-wrap break-words max-h-40 overflow-auto">{state.error}</div>
          </div>
        )}

        <p className="text-xs text-ink-500">
          Der Download läuft über <b>yt-dlp</b> (wird beim ersten Mal automatisch geladen). Bitte nur Inhalte verwenden, die du privat nutzen darfst.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" icon={Download} disabled={!valid || busy}>
            {where === 'library' ? 'Herunterladen & in Sound-Liste' : 'Herunterladen & einfügen'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export function ExportDialog({ doc, sources, onClose }) {
  const [format, setFormat] = useState('mp3');
  const [kbps, setKbps] = useState(192);
  const [normalize, setNormalize] = useState(true);
  const [chapters, setChapters] = useState(true);
  const [state, setState] = useState({ phase: 'idle' });
  const abortRef = useRef(null);

  const total = projectDuration(doc);
  const chapterList = useMemo(() => buildChapters(doc), [doc]);
  const missing = doc.clips.filter((c) => !sources.get(c.sourceId)?.buffer).length;

  const run = async () => {
    const path = await window.api.chooseExport(doc.title || 'Mixtape', format);
    if (!path) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({ phase: 'running', progress: 0, text: 'Starte …' });
    try {
      await exportMix(doc, sources, {
        path,
        format,
        kbps,
        normalize,
        chapters,
        signal: ctrl.signal,
        onProgress: (p, text) => setState({ phase: 'running', progress: p, text }),
      });
      if (chapters) {
        const base = path.replace(/\.[^.\\/]+$/, '');
        await window.api.writeText(`${base}.cue`, buildCueSheet(doc, basename(path), format === 'mp3' ? 'MP3' : 'WAVE'));
        await window.api.writeText(`${base} - Kapitel.txt`, buildChapterText(doc));
      }
      setState({ phase: 'done', path });
    } catch (err) {
      if (err?.name === 'AbortError') setState({ phase: 'idle' });
      else setState({ phase: 'error', error: String(err?.message || err) });
    }
  };

  const busy = state.phase === 'running';

  return (
    <Modal title="Mixtape exportieren" icon={FileDown} onClose={onClose} closable={!busy} width="max-w-2xl">
      <div className="flex gap-6">
        <div className="flex-1 flex flex-col gap-4">
          <Field label="Format">
            <div className="flex gap-2">
              {[
                ['mp3', 'MP3', 'klein, läuft überall'],
                ['wav', 'WAV', 'verlustfrei, groß'],
              ].map(([v, l, h]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFormat(v)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-left ${
                    format === v ? 'border-tape-500 bg-tape-500/10' : 'border-ink-700 hover:border-ink-500'
                  }`}
                >
                  <div className="text-sm font-semibold text-white">{l}</div>
                  <div className="text-[11px] text-ink-400 normal-case tracking-normal">{h}</div>
                </button>
              ))}
            </div>
          </Field>
          {format === 'mp3' && (
            <Field label="Qualität">
              <select className={inputCls} value={kbps} onChange={(e) => setKbps(+e.target.value)}>
                <option value={128}>128 kbit/s – kompakt</option>
                <option value={192}>192 kbit/s – empfohlen</option>
                <option value={256}>256 kbit/s – sehr gut</option>
                <option value={320}>320 kbit/s – maximal</option>
              </select>
            </Field>
          )}
          <Checkbox
            checked={normalize}
            onChange={setNormalize}
            label="Auspegeln (Normalisieren)"
            hint="Hebt den Gesamtpegel an bzw. verhindert Übersteuerung (Spitze bei −1 dB)."
          />
          <Checkbox
            checked={chapters}
            onChange={setChapters}
            label="Kapitelmarken mitschreiben"
            hint="Kapitel im MP3 (ID3), dazu CUE-Sheet und Kapitelliste (.txt) neben der Datei."
          />
        </div>

        <div className="w-60 shrink-0 rounded-xl bg-ink-900 border border-ink-700 p-3 text-xs">
          <div className="text-ink-400">Länge</div>
          <div className="text-lg font-semibold text-white tabular-nums">{fmtTime(total)} min</div>
          <div className="mt-3 text-ink-400 mb-1">Kapitel ({chapterList.length})</div>
          <ol className="max-h-44 overflow-auto space-y-0.5">
            {chapterList.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="tabular-nums text-ink-500">{fmtTime(c.time)}</span>
                <span className="truncate text-ink-200">{c.title}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {missing > 0 && (
        <div className="mt-4 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-300 flex gap-2">
          <TriangleAlert size={16} className="shrink-0 mt-0.5" /> {missing} Clip(s) ohne Audiodatei werden beim Export übersprungen.
        </div>
      )}

      {busy && (
        <div className="mt-5 flex flex-col gap-2">
          <div className="text-sm text-ink-300 flex items-center gap-2">
            <LoaderCircle size={14} className="animate-spin" /> {state.text} {Math.round(state.progress * 100)} %
          </div>
          <ProgressBar value={state.progress} />
        </div>
      )}
      {state.phase === 'done' && (
        <div className="mt-5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-300 flex items-center gap-2">
          <Check size={16} /> Fertig! <span className="truncate text-emerald-200/70">{basename(state.path)}</span>
          <Button variant="ghost" icon={FolderSearch} className="ml-auto" onClick={() => window.api.showItem(state.path)}>
            Im Ordner zeigen
          </Button>
        </div>
      )}
      {state.phase === 'error' && (
        <div className="mt-5 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300">{state.error}</div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        {busy ? (
          <Button variant="danger" onClick={() => abortRef.current?.abort()}>
            Abbrechen
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Schließen
            </Button>
            <Button
              variant="primary"
              icon={Download}
              disabled={total <= 0}
              onClick={run}
            >
              {format.toUpperCase()} exportieren
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* J-Card / Tracklist                                                  */
/* ------------------------------------------------------------------ */

export function JCardDialog({ doc, onClose }) {
  const [opts, setOpts] = useState(() => ({
    title: doc.title,
    to: '',
    from: '',
    date: new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }),
    message: '',
    theme: 'sunset',
    voice: true,
    markers: true,
    sides: true,
  }));
  const [saving, setSaving] = useState(false);
  const frameRef = useRef(null);
  const set = (patch) => setOpts((o) => ({ ...o, ...patch }));
  const [zoom, setZoom] = useState(0.72);

  const total = projectDuration(doc);
  const items = useMemo(
    () => buildTracklist(doc, { includeVoice: opts.voice, includeMarkers: opts.markers }).map((i) => ({ ...i, title: stripExt(i.title) })),
    [doc, opts.voice, opts.markers],
  );
  const html = useMemo(() => buildJCardHtml({ ...opts, items, total }), [opts, items, total]);

  const savePdf = async () => {
    setSaving(true);
    try {
      await window.api.jcardPdf(html, `${opts.title || 'Mixtape'} - J-Card`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Kassetten-Einleger (J-Card) & Tracklist" icon={Printer} onClose={onClose} width="max-w-6xl">
      <div className="flex gap-6">
        <div className="w-72 shrink-0 flex flex-col gap-3">
          <Field label="Titel">
            <input className={inputCls} value={opts.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Für">
              <input className={inputCls} value={opts.to} placeholder="Name" onChange={(e) => set({ to: e.target.value })} />
            </Field>
            <Field label="Von">
              <input className={inputCls} value={opts.from} placeholder="Name" onChange={(e) => set({ from: e.target.value })} />
            </Field>
          </div>
          <Field label="Datum">
            <input className={inputCls} value={opts.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
          <Field label="Kleine Widmung">
            <textarea
              className={`${inputCls} h-16 py-2 resize-none`}
              value={opts.message}
              placeholder="Für die lange Autofahrt …"
              onChange={(e) => set({ message: e.target.value })}
            />
          </Field>
          <Field label="Farbschema">
            <div className="flex gap-2">
              {Object.entries(JCARD_THEMES).map(([k, t]) => (
                <button
                  key={k}
                  type="button"
                  title={t.name}
                  onClick={() => set({ theme: k })}
                  className={`size-8 rounded-lg ${opts.theme === k ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-850' : ''}`}
                  style={{ background: `linear-gradient(135deg, ${t.a}, ${t.b}, ${t.c})` }}
                />
              ))}
            </div>
          </Field>
          <Checkbox checked={opts.voice} onChange={(v) => set({ voice: v })} label="Sprachaufnahmen auflisten" />
          <Checkbox checked={opts.markers} onChange={(v) => set({ markers: v })} label="Kapitelmarken auflisten" />
          <Checkbox checked={opts.sides} onChange={(v) => set({ sides: v })} label="In Seite A / B aufteilen" />
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <PreviewZoom html={html} frameRef={frameRef} zoom={zoom} setZoom={setZoom} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Schließen
            </Button>
            <Button icon={Printer} onClick={() => frameRef.current?.contentWindow?.print()}>
              Drucken
            </Button>
            <Button variant="primary" icon={FileDown} onClick={savePdf} disabled={saving}>
              {saving ? 'Speichere …' : 'Als PDF speichern'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Zoombare Druckvorschau                                              */
/* ------------------------------------------------------------------ */

const PAGE_W = 1122.5; // A4 quer in px (297 mm)
const PAGE_H = 793.7; // 210 mm
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;

function PreviewZoom({ html, frameRef, zoom, setZoom }) {
  const boxRef = useRef(null);
  const anchor = useRef(null);
  const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  /** Zoomen und dabei den Punkt unter dem Mauszeiger (bzw. die Mitte) festhalten. */
  const zoomTo = (next, cx, cy) => {
    const box = boxRef.current;
    next = clampZoom(next);
    if (!box) return setZoom(next);
    const r = box.getBoundingClientRect();
    const px = cx ?? r.width / 2;
    const py = cy ?? r.height / 2;
    const fx = (box.scrollLeft + px) / zoom;
    const fy = (box.scrollTop + py) / zoom;
    anchor.current = { fx, fy, px, py };
    setZoom(next);
  };

  // Scroll-Position direkt nach dem Neu-Layout anpassen, damit der Ankerpunkt stehen bleibt
  useLayoutEffect(() => {
    const a = anchor.current;
    const box = boxRef.current;
    if (!a || !box) return;
    anchor.current = null;
    box.scrollLeft = a.fx * zoom - a.px;
    box.scrollTop = a.fy * zoom - a.py;
  }, [zoom]);

  const fit = () => {
    const box = boxRef.current;
    if (box) setZoom(clampZoom((box.clientWidth - 2) / PAGE_W));
  };

  // Strg + Mausrad (nicht passiv, damit das Fenster nicht selbst zoomt)
  useEffect(() => {
    const box = boxRef.current;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = box.getBoundingClientRect();
      zoomTo(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top);
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  });

  // Mit gedrückter Maus verschieben
  const onPanDown = (e) => {
    if (e.button !== 0) return;
    const box = boxRef.current;
    const start = { x: e.clientX, y: e.clientY, l: box.scrollLeft, t: box.scrollTop };
    const move = (ev) => {
      box.scrollLeft = start.l - (ev.clientX - start.x);
      box.scrollTop = start.t - (ev.clientY - start.y);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="relative">
      <div ref={boxRef} className="rounded-xl overflow-auto border border-ink-700 bg-ink-950" style={{ height: 420 }}>
        <div className="relative bg-white" style={{ width: PAGE_W * zoom, height: PAGE_H * zoom }}>
          <iframe
            ref={frameRef}
            title="Vorschau"
            srcDoc={html}
            className="origin-top-left absolute left-0 top-0"
            style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${zoom})`, border: 0 }}
          />
          {/* Fängt Maus-Ereignisse ab (das iframe würde sie sonst schlucken) */}
          <div className="absolute inset-0 cursor-grab active:cursor-grabbing" onPointerDown={onPanDown} onDoubleClick={fit} />
        </div>
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg bg-ink-850/95 border border-ink-700 p-0.5 shadow-lg">
        <IconButton icon={ZoomOut} label="Verkleinern" size={16} onClick={() => zoomTo(zoom / 1.25)} />
        <button
          type="button"
          title="Auf 100 % setzen"
          onClick={() => zoomTo(1)}
          className="w-12 text-xs tabular-nums text-ink-300 hover:text-white"
        >
          {Math.round(zoom * 100)} %
        </button>
        <IconButton icon={ZoomIn} label="Vergrößern" size={16} onClick={() => zoomTo(zoom * 1.25)} />
        <IconButton icon={Maximize} label="Einpassen (Doppelklick)" size={16} onClick={fit} />
      </div>
    </div>
  );
}
