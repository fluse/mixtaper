import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Play, Square, LoaderCircle, Info } from 'lucide-react';
import { Modal, Button, Field, Slider, Checkbox } from './ui';
import { VOICE_PRESETS, processVoice } from '../lib/voicefx';
import { computeMiniWave, getAudioContext } from '../lib/audio';

function Wave({ buffer, offset, duration, color }) {
  const wave = useMemo(() => (buffer ? computeMiniWave(buffer, offset, duration, 220) : null), [buffer, offset, duration]);
  if (!wave) return <div className="h-14 rounded-lg bg-ink-800 animate-pulse" />;
  // auf den lautesten Punkt skaliert: zeigt die Form (Pausen, Ausklänge), nicht den absoluten Pegel
  let d = '';
  wave.forEach((v, i) => {
    const h = Math.max(1, v / 2);
    d += `M${i + 0.5} ${50 - h}V${50 + h}`;
  });
  return (
    <svg viewBox={`0 0 ${wave.length} 100`} preserveAspectRatio="none" className="w-full h-14 rounded-lg bg-ink-950" style={{ color }}>
      <path d={d} stroke="currentColor" strokeWidth="0.7" />
    </svg>
  );
}

export function VoiceFxDialog({ clip, source, onApply, onClose }) {
  const [opts, setOpts] = useState({ ...VOICE_PRESETS.standard });
  const [preset, setPreset] = useState('standard');
  const [processed, setProcessed] = useState(null);
  const [working, setWorking] = useState(false);
  const [playing, setPlaying] = useState(null); // 'orig' | 'fx'
  const [applying, setApplying] = useState(false);
  const nodeRef = useRef(null);

  const set = (patch) => {
    setPreset(null);
    setOpts((o) => ({ ...o, ...patch }));
  };

  // Verarbeitung neu berechnen, wenn sich Einstellungen ändern (kurz entprellt)
  useEffect(() => {
    let alive = true;
    setWorking(true);
    const t = setTimeout(async () => {
      try {
        const out = await processVoice(source.buffer, opts);
        if (alive) setProcessed(out);
      } finally {
        if (alive) setWorking(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [opts, source.buffer]);

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

  const play = async (which) => {
    const was = playing;
    stop();
    if (was === which) return;
    const buf = which === 'orig' ? source.buffer : processed;
    if (!buf) return;
    const actx = getAudioContext();
    await actx.resume();
    const node = actx.createBufferSource();
    node.buffer = buf;
    const g = actx.createGain();
    g.gain.value = clip.gain ?? 1;
    node.connect(g);
    g.connect(actx.destination);
    node.onended = () => {
      if (nodeRef.current === node) {
        nodeRef.current = null;
        setPlaying(null);
      }
    };
    node.start(0, clip.offset, clip.duration);
    nodeRef.current = node;
    setPlaying(which);
  };

  // Neue Verarbeitung → alte Wiedergabe der optimierten Version beenden
  useEffect(() => {
    if (nodeRef.current && playing === 'fx') stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processed]);

  const apply = async () => {
    stop();
    setApplying(true);
    try {
      await onApply(processed);
      onClose();
    } finally {
      setApplying(false);
    }
  };

  const PlayBtn = ({ which, label }) => (
    <button
      type="button"
      onClick={() => play(which)}
      disabled={which === 'fx' && !processed}
      className={`h-8 px-3 rounded-lg text-sm flex items-center gap-2 disabled:opacity-40 ${
        playing === which ? 'bg-tape-500 text-white' : 'bg-ink-700 hover:bg-ink-600 text-ink-200'
      }`}
    >
      {playing === which ? <Square size={11} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
      {label}
    </button>
  );

  return (
    <Modal title={`Stimme optimieren – ${clip.name}`} icon={Sparkles} onClose={onClose} closable={!applying} width="max-w-3xl">
      <div className="flex gap-6">
        <div className="w-72 shrink-0 flex flex-col gap-4">
          <Field label="Voreinstellung">
            <div className="flex gap-1.5">
              {Object.entries(VOICE_PRESETS).map(([k, p]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setPreset(k);
                    setOpts({ ...p });
                  }}
                  className={`flex-1 h-8 rounded-lg text-sm ${
                    preset === k ? 'bg-tape-500/20 text-tape-400 ring-1 ring-tape-500/40' : 'bg-ink-700 hover:bg-ink-600 text-ink-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
          <Checkbox checked={opts.highpass} onChange={(v) => set({ highpass: v })} label="Rumpeln entfernen" hint="Filtert Tiefen unter 85 Hz (Trittschall, Brummen)." />
          <Field label="Klarheit (EQ)">
            <Slider value={opts.clarity} min={0} max={1.5} step={0.05} onChange={(v) => set({ clarity: v })} format={(v) => `${Math.round(v * 100)}%`} />
          </Field>
          <Field label="Hall & Raumgeräusch reduzieren">
            <Slider value={opts.dereverb} min={0} max={1} step={0.05} onChange={(v) => set({ dereverb: v })} format={(v) => `${Math.round(v * 100)}%`} />
          </Field>
          <Field label="Kompressor (gleichmäßiger)">
            <Slider value={opts.compress} min={0} max={1} step={0.05} onChange={(v) => set({ compress: v })} format={(v) => `${Math.round(v * 100)}%`} />
          </Field>
          <Checkbox checked={opts.normalize} onChange={(v) => set({ normalize: v })} label="Lautstärke angleichen" hint="Sprache auf einheitlichen Pegel (−18 dB), Spitzen max. −1 dB." />
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-ink-400 w-20">Vorher</span>
            <PlayBtn which="orig" label="Original" />
          </div>
          <Wave buffer={source.buffer} offset={clip.offset} duration={clip.duration} color="#8a80a8" />
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs font-medium uppercase tracking-wider text-ink-400 w-20">Nachher</span>
            <PlayBtn which="fx" label="Optimiert" />
            {working && <LoaderCircle size={14} className="animate-spin text-ink-400" />}
          </div>
          <Wave buffer={processed} offset={clip.offset} duration={clip.duration} color="#ff7ea6" />
          <p className="mt-2 text-xs text-ink-500 flex gap-1.5">
            <Info size={13} className="shrink-0 mt-px" />
            Hall wird vor allem zwischen den Wörtern reduziert – im Wort selbst lässt er sich nachträglich kaum entfernen. Am meisten bringt: nah ans Mikro und
            ein Raum mit Teppich, Vorhängen oder Polstermöbeln.
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-ink-500">Es wird eine neue Datei angelegt – das Original bleibt erhalten (Strg+Z geht).</span>
        <Button variant="ghost" onClick={onClose} disabled={applying}>
          Abbrechen
        </Button>
        <Button variant="primary" icon={Sparkles} onClick={apply} disabled={!processed || working || applying}>
          {applying ? 'Speichere …' : 'Anwenden'}
        </Button>
      </div>
    </Modal>
  );
}
