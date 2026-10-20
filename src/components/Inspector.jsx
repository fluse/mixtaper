import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Scissors, Trash2, Copy, WandSparkles, Blend, FolderSearch, Keyboard, Mic, Megaphone, AudioLines, StickyNote, Settings2, RefreshCw, BookmarkPlus, Sparkles,
} from 'lucide-react';
import { Button, Field, Slider, Checkbox, inputCls } from './ui';
import { fmtTime, gainToDb, dbToGain } from '../lib/utils';

const MARKER_COLORS = ['#fbbf24', '#f472b6', '#60a5fa', '#34d399', '#a78bfa', '#fb923c'];

/** Textfeld, das den verfügbaren Platz füllt und bei langem Text mitwächst (nie innerer Scrollbalken). */
function AutoTextarea({ value, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.minHeight = '0px';
    el.style.height = '0px';
    const h = el.scrollHeight;
    el.style.height = '';
    el.style.minHeight = `${Math.max(64, h + 2)}px`;
  }, [value]);
  return <textarea ref={ref} value={value} {...props} />;
}

function Panel({ children }) {
  return <div className="h-full">{children}</div>;
}

function ClipInspector({ clip, source, track, onChange, onBeginEdit, onEndEdit, actions }) {
  const sel = (fn) => (v) => onChange(fn(v), false);
  return (
    <Panel>
      <div className="flex gap-6 h-full">
        <div className="w-72 shrink-0 flex flex-col gap-3">
          <Field label="Titel">
            <input
              className={inputCls}
              value={clip.name}
              onFocus={onBeginEdit}
              onBlur={onEndEdit}
              onChange={(e) => onChange({ name: e.target.value }, false)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </Field>
          <div className="text-xs text-ink-400 leading-relaxed">
            <span className="inline-block size-2 rounded-full mr-1.5" style={{ background: track?.color }} />
            {track?.name} · Start {fmtTime(clip.start, true)} · Länge {fmtTime(clip.duration, true)}
            {source?.path && (
              <button
                type="button"
                className="ml-2 inline-flex items-center gap-1 text-ink-500 hover:text-white"
                onClick={() => window.api.showItem(source.path)}
                title={source.path}
              >
                <FolderSearch size={12} /> Datei
              </button>
            )}
          </div>
        </div>

        <div className="w-64 shrink-0 flex flex-col gap-2.5" onPointerDown={onBeginEdit} onPointerUp={onEndEdit}>
          <Field label="Lautstärke">
            <Slider
              value={gainToDb(clip.gain ?? 1)}
              min={-30}
              max={12}
              step={0.5}
              onChange={sel((db) => ({ gain: db <= -30 ? 0 : dbToGain(db) }))}
              format={(v) => (v <= -30 ? '−∞' : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`)}
            />
          </Field>
          <Field label="Fade-In">
            <Slider
              value={clip.fadeIn || 0}
              min={0}
              max={Math.min(15, clip.duration - (clip.fadeOut || 0))}
              step={0.1}
              onChange={sel((v) => ({ fadeIn: v }))}
              format={(v) => `${v.toFixed(1)} s`}
            />
          </Field>
          <Field label="Fade-Out">
            <Slider
              value={clip.fadeOut || 0}
              min={0}
              max={Math.min(15, clip.duration - (clip.fadeIn || 0))}
              step={0.1}
              onChange={sel((v) => ({ fadeOut: v }))}
              format={(v) => `${v.toFixed(1)} s`}
            />
          </Field>
        </div>

        <div className="flex-1 flex flex-wrap content-start gap-2">
          <Button icon={Scissors} onClick={actions.split}>Teilen</Button>
          <Button icon={Sparkles} onClick={actions.optimize}>Stimme optimieren</Button>
          <Button icon={WandSparkles} onClick={actions.trimSilence}>Stille entfernen</Button>
          <Button icon={Blend} onClick={actions.crossfade}>Crossfade mit Vorgänger</Button>
          <Button icon={Copy} onClick={actions.duplicate}>Duplizieren</Button>
          <Button icon={BookmarkPlus} onClick={actions.toLibrary}>In Sound-Liste</Button>
          <Button icon={Trash2} variant="danger" onClick={actions.remove}>Löschen</Button>
        </div>
      </div>
    </Panel>
  );
}

function MarkerInspector({ marker, onChange, onBeginEdit, onEndEdit, onRemove }) {
  return (
    <Panel>
      <div className="flex gap-6 min-h-full">
        <div className="w-64 shrink-0 flex flex-col gap-3">
          <Field label={`Notiz bei ${fmtTime(marker.time, true)}`}>
            <input
              autoFocus
              className={inputCls}
              value={marker.text}
              placeholder="z. B. „Hallo Lea!“, Übergang, Geschichte …"
              onFocus={onBeginEdit}
              onBlur={onEndEdit}
              onChange={(e) => onChange({ text: e.target.value }, false)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </Field>
          <div className="flex items-center gap-1.5">
            {MARKER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange({ color: c })}
                className={`size-5 rounded-full ${marker.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-900' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>
          <Checkbox
            checked={!!marker.chapter}
            onChange={(v) => onChange({ chapter: v })}
            label="Als Kapitelmarke exportieren"
            hint="Kapitel im MP3, CUE-Sheet und Tracklist."
          />
          <Button icon={Trash2} variant="danger" onClick={onRemove} className="self-start">
            Marker löschen
          </Button>
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <Field label="Regieanweisung / Text zum Vorlesen" className="flex-1">
            <AutoTextarea
              className={`${inputCls} flex-1 h-auto py-2 resize-none leading-relaxed`}
              value={marker.note || ''}
              placeholder="Was möchtest du hier sagen? Notizen für die Moderation …"
              onFocus={onBeginEdit}
              onBlur={onEndEdit}
              onChange={(e) => onChange({ note: e.target.value }, false)}
            />
          </Field>
        </div>
      </div>
    </Panel>
  );
}

function ProjectSettings({ doc, onDocChange, onBeginEdit, onEndEdit }) {
  return (
    <Panel>
      <div className="flex gap-8 h-full">
        <div className="w-64 shrink-0 flex flex-col gap-3">
          <Field label="Name des Mixtapes">
            <input
              className={inputCls}
              value={doc.title}
              onFocus={onBeginEdit}
              onBlur={onEndEdit}
              onChange={(e) => onDocChange({ title: e.target.value }, false)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </Field>
          <div onPointerDown={onBeginEdit} onPointerUp={onEndEdit}>
            <Field label="Ducking-Stärke" hint="So leise wird die Musik, während auf einer Sprachspur gesprochen wird.">
              <Slider
                value={doc.duckDepth ?? 0.3}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => onDocChange({ duckDepth: v }, false)}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </Field>
          </div>
        </div>

        <div className="flex-1 min-w-0 text-xs text-ink-400">
          <div className="font-medium uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Keyboard size={13} /> Tastenkürzel
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-1">
            {[
              ['Leertaste', 'Abspielen / Pause'],
              ['R', 'Aufnahme starten/stoppen'],
              ['S', 'Clip an Abspielposition teilen'],
              ['M', 'Notiz/Marker setzen'],
              ['Entf', 'Auswahl löschen'],
              ['Esc', 'Auswahl aufheben'],
              ['Strg+D', 'Clip duplizieren'],
              ['Strg+Z / Strg+Y', 'Rückgängig / Wiederholen'],
              ['Strg+Mausrad', 'Zoomen'],
              ['Strg+S / Strg+O', 'Speichern / Öffnen'],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <kbd className="px-1.5 rounded bg-ink-700 text-ink-200 font-sans text-[11px] whitespace-nowrap">{k}</kbd>
                <span className="truncate">{v}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-ink-500">
            <Megaphone size={13} className="shrink-0 mt-px" /> Spuren mit „Sprache“ senken die Musik automatisch ab. Doppelklick in die Marker-Leiste setzt eine Notiz.
          </p>
        </div>
      </div>
    </Panel>
  );
}

/** Liste der Audio-Eingänge. Gerätenamen gibt der Browser erst nach einer Mikrofon-Freigabe heraus. */
function useAudioInputs() {
  const [devices, setDevices] = useState(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    const list = async () =>
      (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications',
      );
    const load = async () => {
      let inputs = await list();
      if (inputs.length && inputs.every((d) => !d.label)) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          s.getTracks().forEach((t) => t.stop());
          inputs = await list();
        } catch {
          /* ohne Freigabe nur unbenannte Geräte */
        }
      }
      if (alive) setDevices(inputs);
    };
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => {
      alive = false;
      navigator.mediaDevices.removeEventListener('devicechange', load);
    };
  }, [reload]);
  return [devices, () => setReload((r) => r + 1)];
}

function RecordingSettings({ recSettings, setRecSettings }) {
  const [devices, reload] = useAudioInputs();
  const selected = recSettings.deviceId || '';
  const missing = selected && devices && !devices.some((d) => d.deviceId === selected);
  return (
    <Panel>
      <div className="flex gap-8 h-full">
        <div className="w-80 shrink-0 flex flex-col gap-2">
          <Field label="Eingabegerät (Mikrofon)">
            <div className="flex gap-1.5">
              <select
                className={`${inputCls} flex-1 min-w-0`}
                value={missing ? '' : selected}
                onChange={(e) => setRecSettings((s) => ({ ...s, deviceId: e.target.value }))}
              >
                <option value="">Windows-Standardgerät</option>
                {(devices || []).map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Mikrofon ${i + 1}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                title="Geräteliste aktualisieren"
                onClick={reload}
                className="size-9 shrink-0 rounded-lg bg-ink-700 hover:bg-ink-600 flex items-center justify-center text-ink-300"
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </Field>
          {devices === null && <span className="text-[11px] text-ink-500">Suche Geräte …</span>}
          {devices?.length === 0 && <span className="text-[11px] text-amber-400">Kein Mikrofon gefunden.</span>}
          {missing && (
            <span className="text-[11px] text-amber-400">Das gewählte Gerät ist nicht verbunden – es wird das Standardgerät verwendet.</span>
          )}
        </div>

        <div className="w-80 shrink-0 flex flex-col gap-3">
          <Checkbox
            checked={recSettings.lowerMusic}
            onChange={(v) => setRecSettings((s) => ({ ...s, lowerMusic: v }))}
            label="Musik während der Aufnahme leiser abspielen"
            hint="Hilft, wenn ohne Kopfhörer aufgenommen wird."
          />
          {recSettings.lowerMusic && (
            <Slider
              value={recSettings.cueLevel}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setRecSettings((s) => ({ ...s, cueLevel: v }))}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          )}
          <Checkbox
            checked={recSettings.trimSilence}
            onChange={(v) => setRecSettings((s) => ({ ...s, trimSilence: v }))}
            label="Stille am Anfang/Ende automatisch wegschneiden"
          />
        </div>
      </div>
    </Panel>
  );
}

export function Inspector(props) {
  const { doc, selection, sources } = props;
  const clip = selection?.type === 'clip' ? doc.clips.find((c) => c.id === selection.id) : null;
  const marker = selection?.type === 'marker' ? doc.markers.find((m) => m.id === selection.id) : null;
  const selKind = clip ? 'clip' : marker ? 'marker' : null;

  // Bei neuer Auswahl automatisch zum Auswahl-Reiter wechseln; Projekt/Aufnahme bleiben jederzeit erreichbar
  const [tab, setTab] = useState('project');
  const selKey = selection ? `${selection.type}:${selection.id}` : null;
  useEffect(() => {
    if (selKey) setTab('selection');
    else setTab((t) => (t === 'selection' ? 'project' : t));
  }, [selKey]);
  const active = tab === 'selection' && !selKind ? 'project' : tab;

  const tabs = [
    { id: 'selection', label: selKind === 'marker' ? 'Notiz' : 'Clip', icon: selKind === 'marker' ? StickyNote : AudioLines, disabled: !selKind },
    { id: 'project', label: 'Projekt', icon: Settings2 },
    { id: 'recording', label: 'Aufnahme', icon: Mic },
  ];

  let content;
  if (active === 'selection' && clip) {
    content = (
      <ClipInspector
        clip={clip}
        source={sources.get(clip.sourceId)}
        track={doc.tracks.find((t) => t.id === clip.trackId)}
        onChange={(patch, record) => props.onClipChange(clip.id, patch, record)}
        onBeginEdit={props.onBeginEdit}
        onEndEdit={props.onEndEdit}
        actions={props.clipActions}
      />
    );
  } else if (active === 'selection' && marker) {
    content = (
      <MarkerInspector
        key={marker.id}
        marker={marker}
        onChange={(patch, record) => props.onMarkerChange(marker.id, patch, record)}
        onBeginEdit={props.onBeginEdit}
        onEndEdit={props.onEndEdit}
        onRemove={props.onDelete}
      />
    );
  } else if (active === 'recording') {
    content = <RecordingSettings recSettings={props.recSettings} setRecSettings={props.setRecSettings} />;
  } else {
    content = <ProjectSettings doc={doc} onDocChange={props.onDocChange} onBeginEdit={props.onBeginEdit} onEndEdit={props.onEndEdit} />;
  }

  return (
    <div className="flex-1 min-w-0 h-full bg-ink-900 flex">
      <nav className="w-32 shrink-0 border-r border-ink-700 p-2 flex flex-col gap-1">
        {tabs.map(({ id, label, icon: Icon, disabled }) => (
          <button
            key={id}
            type="button"
            disabled={disabled}
            onClick={() => setTab(id)}
            title={disabled ? 'Erst einen Clip oder eine Notiz anklicken' : undefined}
            className={`h-9 px-2.5 rounded-lg flex items-center gap-2 text-sm text-left transition-colors disabled:opacity-35 disabled:pointer-events-none ${
              active === id ? 'bg-tape-500/15 text-tape-400' : 'text-ink-300 hover:bg-ink-700 hover:text-white'
            }`}
          >
            <Icon size={15} className="shrink-0" />
            {label}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-w-0 px-5 py-4 overflow-auto">{content}</div>
    </div>
  );
}
