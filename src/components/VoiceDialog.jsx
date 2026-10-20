import React, { useEffect, useRef, useState } from 'react';
import { Drama, Play, Square, LoaderCircle, Trash2 } from 'lucide-react';
import { Modal, Button, Field, Slider, Checkbox } from './ui';
import { VOICE_CHARACTERS, VOICE_DEFAULTS } from '../lib/voiceshift';
import { transformVoiceAsync, regionMono, monoToBuffer } from '../lib/voiceclient';
import { getAudioContext } from '../lib/audio';

const PREVIEW_MAX = 20; // Sekunden – Vorschau nur über den Anfang, damit sie schnell bleibt
const semis = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} HT`;
const pct = (v) => `${Math.round(v * 100)}%`;

/**
 * Stimme verwandeln – für einen Clip (mode "clip") oder als Figur einer Sprecher-Spur (mode "track").
 * sample: { buffer, offset, duration, gain } zum Vorhören (bei Spuren der erste Clip, falls vorhanden)
 */
export function VoiceDialog({ mode, title, initial, sample, trackClipCount = 0, onApply, onRemove, onClose }) {
  const startKey = initial?.key ?? (initial ? null : 'kind');
  const [key, setKey] = useState(startKey);
  const [v, setV] = useState(() => ({ ...VOICE_DEFAULTS, ...(initial ?? VOICE_CHARACTERS.kind) }));
  const [applyExisting, setApplyExisting] = useState(true);
  const [processed, setProcessed] = useState(null);
  const [working, setWorking] = useState(false);
  const [playing, setPlaying] = useState(null);
  const [busy, setBusy] = useState(false);
  const nodeRef = useRef(null);
  const reqRef = useRef(0);

  const set = (patch) => {
    setKey(null);
    setV((x) => ({ ...x, ...patch }));
  };

  // Vorschau neu berechnen (entprellt, ältere Ergebnisse verwerfen)
  useEffect(() => {
    if (!sample?.buffer) return;
    const req = ++reqRef.current;
    setWorking(true);
    const t = setTimeout(async () => {
      try {
        const sr = sample.buffer.sampleRate;
        const mono = regionMono(sample.buffer, sample.offset, Math.min(sample.duration, PREVIEW_MAX));
        const out = await transformVoiceAsync(mono, sr, v);
        if (req === reqRef.current) setProcessed(monoToBuffer(out, sr));
      } finally {
        if (req === reqRef.current) setWorking(false);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, sample?.buffer, sample?.offset, sample?.duration]);

  const stop = () => {
    if (nodeRef.current) {
      try {
        nodeRef.current.stop();
      } catch {
        /* bereits beendet */
      }
      nodeRef.current = null;
    }
    setPlaying(null);
  };
  useEffect(() => stop, []);
  useEffect(() => {
    if (playing === 'fx') stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processed]);

  const play = async (which) => {
    const was = playing;
    stop();
    if (was === which) return;
    const actx = getAudioContext();
    await actx.resume();
    const node = actx.createBufferSource();
    const g = actx.createGain();
    g.gain.value = sample.gain ?? 1;
    if (which === 'orig') {
      node.buffer = sample.buffer;
      node.connect(g);
      node.start(0, sample.offset, Math.min(sample.duration, PREVIEW_MAX));
    } else {
      if (!processed) return;
      node.buffer = processed;
      node.connect(g);
      node.start();
    }
    g.connect(actx.destination);
    node.onended = () => {
      if (nodeRef.current === node) {
        nodeRef.current = null;
        setPlaying(null);
      }
    };
    nodeRef.current = node;
    setPlaying(which);
  };

  const label = key ? VOICE_CHARACTERS[key].label : 'Eigene Stimme';

  const apply = async () => {
    stop();
    setBusy(true);
    try {
      await onApply({ ...v, key, label }, applyExisting);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const PlayBtn = ({ which, text }) => (
    <button
      type="button"
      onClick={() => play(which)}
      disabled={!sample?.buffer || (which === 'fx' && !processed)}
      className={`h-9 px-3.5 rounded-lg text-sm flex items-center gap-2 disabled:opacity-40 ${
        playing === which ? 'bg-tape-500 text-white' : 'bg-ink-700 hover:bg-ink-600 text-ink-200'
      }`}
    >
      {playing === which ? <Square size={11} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
      {text}
    </button>
  );

  return (
    <Modal title={title} icon={Drama} onClose={onClose} closable={!busy} width="max-w-2xl">
      <div className="flex flex-col gap-4">
        <Field label="Figur">
          <div className="grid grid-cols-4 gap-1.5">
            {Object.entries(VOICE_CHARACTERS).map(([k, c]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKey(k);
                  setV({ ...VOICE_DEFAULTS, ...c });
                }}
                className={`h-9 rounded-lg text-sm ${
                  key === k ? 'bg-tape-500/20 text-tape-400 ring-1 ring-tape-500/40' : 'bg-ink-700 hover:bg-ink-600 text-ink-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Field label="Tonhöhe">
            <Slider value={v.pitch} min={-12} max={12} step={0.5} onChange={(x) => set({ pitch: x })} format={semis} />
          </Field>
          <Field label="Klangfarbe (klein ↔ groß)">
            <Slider value={v.formant} min={-8} max={8} step={0.5} onChange={(x) => set({ formant: x })} format={semis} />
          </Field>
          <Field label="Helligkeit">
            <Slider value={v.bright} min={-1} max={1} step={0.05} onChange={(x) => set({ bright: x })} format={pct} />
          </Field>
          <Field label="Wärme">
            <Slider value={v.warm} min={0} max={1} step={0.05} onChange={(x) => set({ warm: x })} format={pct} />
          </Field>
          <Field label="Zittern (Vibrato)">
            <Slider value={v.vibrato} min={0} max={1} step={0.05} onChange={(x) => set({ vibrato: x })} format={pct} />
          </Field>
          <Field label="Roboter">
            <Slider value={v.robot} min={0} max={1} step={0.05} onChange={(x) => set({ robot: x })} format={pct} />
          </Field>
          <Field label="Alien">
            <Slider value={v.alien} min={0} max={1} step={0.05} onChange={(x) => set({ alien: x })} format={pct} />
          </Field>
        </div>

        <div className="flex items-center gap-2">
          <PlayBtn which="orig" text="Original" />
          <PlayBtn which="fx" text={label} />
          {working && <LoaderCircle size={15} className="animate-spin text-ink-400" />}
          {!sample?.buffer && <span className="text-xs text-ink-500">Zum Vorhören zuerst eine Aufnahme auf die Spur legen.</span>}
        </div>

        {mode === 'track' && (
          <div className="rounded-lg bg-ink-900 border border-ink-700 p-3 flex flex-col gap-2">
            <p className="text-xs text-ink-400">
              Neue Aufnahmen auf dieser Spur werden automatisch als <b className="text-ink-200">{label}</b> verwandelt.
            </p>
            {trackClipCount > 0 && (
              <Checkbox
                checked={applyExisting}
                onChange={setApplyExisting}
                label={`Auch die ${trackClipCount} vorhandenen Clips dieser Spur verwandeln`}
              />
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          {onRemove && (
            <Button
              variant="danger"
              icon={Trash2}
              disabled={busy}
              onClick={async () => {
                stop();
                setBusy(true);
                try {
                  await onRemove();
                  onClose();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {mode === 'track' ? 'Figur entfernen' : 'Original-Stimme'}
            </Button>
          )}
          <span className="text-xs text-ink-500 ml-1">{mode === 'clip' ? 'Das Original bleibt erhalten.' : ''}</span>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="primary" icon={busy ? LoaderCircle : Drama} onClick={apply} disabled={busy}>
            {busy ? 'Verwandle …' : 'Anwenden'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
