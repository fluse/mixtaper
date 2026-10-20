import React, { useEffect, useRef, useState } from 'react';
import { Repeat2, Waves, Play, Square, SlidersHorizontal } from 'lucide-react';
import { Modal, Button, Field, Slider } from './ui';
import { ECHO_PRESETS, REVERB_PRESETS, buildGraph, fxTail } from '../lib/engine';
import { getAudioContext } from '../lib/audio';

const pick = ({ label, ...values }) => values;

function Switch({ on, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative w-9 h-5 rounded-full transition-colors ${on ? 'bg-tape-500' : 'bg-ink-600'}`}
    >
      <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

function Section({ icon: Icon, title, on, onToggle, presets, activePreset, onPreset, children }) {
  return (
    <div className={`rounded-xl border p-4 transition-colors ${on ? 'border-ink-600 bg-ink-800/50' : 'border-ink-700'}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={16} className={on ? 'text-tape-400' : 'text-ink-500'} />
        <span className="font-medium text-white">{title}</span>
        <div className="flex-1" />
        <Switch on={on} onChange={onToggle} />
      </div>
      <div className={on ? '' : 'opacity-40 pointer-events-none'}>
        <div className="flex gap-1.5 mb-3">
          {Object.entries(presets).map(([k, p]) => (
            <button
              key={k}
              type="button"
              onClick={() => onPreset(k)}
              className={`flex-1 h-7 rounded-lg text-xs ${
                activePreset === k ? 'bg-tape-500/20 text-tape-400 ring-1 ring-tape-500/40' : 'bg-ink-700 hover:bg-ink-600 text-ink-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">{children}</div>
      </div>
    </div>
  );
}

const pct = (v) => `${Math.round(v * 100)}%`;

/** Echo und Hall eines Clips einstellen – mit Vorhören des Clips allein (inkl. Ausklang). */
export function FxDialog({ clip, sources, onApply, onClose }) {
  const [echoOn, setEchoOn] = useState(!!clip.echo);
  const [echo, setEcho] = useState(() => ({ ...(clip.echo ?? pick(ECHO_PRESETS.echo)) }));
  const [echoPreset, setEchoPreset] = useState(clip.echo ? null : 'echo');
  const [revOn, setRevOn] = useState(!!clip.reverb || !clip.echo);
  const [reverb, setReverb] = useState(() => ({ ...(clip.reverb ?? pick(REVERB_PRESETS.studio)) }));
  const [revPreset, setRevPreset] = useState(clip.reverb ? null : 'studio');
  const [playing, setPlaying] = useState(false);
  const previewRef = useRef(null);

  const current = () => ({ echo: echoOn ? echo : undefined, reverb: revOn ? reverb : undefined });
  const currentRef = useRef(current());
  currentRef.current = current();

  const stop = () => {
    const p = previewRef.current;
    if (p) {
      clearTimeout(p.timer);
      p.graph.stop();
      p.out.disconnect();
    }
    previewRef.current = null;
    setPlaying(false);
  };
  useEffect(() => stop, []);

  const start = async () => {
    stop();
    const actx = getAudioContext();
    await actx.resume();
    const fx = currentRef.current;
    const previewClip = { ...clip, start: 0, trackId: 'preview', ...fx };
    const doc = { tracks: [{ id: 'preview', volume: 1, muted: false, solo: false, duck: false }], clips: [previewClip], duckDepth: 1 };
    const out = actx.createGain();
    out.connect(actx.destination);
    const graph = buildGraph(actx, out, doc, sources, 0, { when: actx.currentTime + 0.03 });
    const timer = setTimeout(stop, (clip.duration + fxTail(previewClip) + 0.3) * 1000);
    previewRef.current = { graph, out, timer };
    setPlaying(true);
  };

  // Änderungen während des Vorhörens → neu starten (entprellt)
  useEffect(() => {
    if (!previewRef.current) return;
    const t = setTimeout(start, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [echo, reverb, echoOn, revOn]);

  const setE = (patch) => {
    setEchoPreset(null);
    setEcho((e) => ({ ...e, ...patch }));
  };
  const setR = (patch) => {
    setRevPreset(null);
    setReverb((r) => ({ ...r, ...patch }));
  };

  const tail = fxTail({ ...clip, ...current() });

  return (
    <Modal title={`Effekte – ${clip.name}`} icon={SlidersHorizontal} onClose={onClose} width="max-w-2xl">
      <div className="flex flex-col gap-3">
        <Section
          icon={Repeat2}
          title="Echo"
          on={echoOn}
          onToggle={setEchoOn}
          presets={ECHO_PRESETS}
          activePreset={echoPreset}
          onPreset={(k) => {
            setEchoPreset(k);
            setEcho(pick(ECHO_PRESETS[k]));
          }}
        >
          <Field label="Verzögerung">
            <Slider value={echo.time} min={0.03} max={1.5} step={0.01} onChange={(v) => setE({ time: v })} format={(v) => `${Math.round(v * 1000)} ms`} />
          </Field>
          <Field label="Wiederholungen">
            <Slider value={echo.feedback} min={0} max={0.9} step={0.01} onChange={(v) => setE({ feedback: v })} format={pct} />
          </Field>
          <Field label="Echo-Lautstärke">
            <Slider value={echo.mix} min={0} max={1} step={0.01} onChange={(v) => setE({ mix: v })} format={pct} />
          </Field>
          <Field label="Dämpfung">
            <Slider value={echo.damp} min={0} max={1} step={0.01} onChange={(v) => setE({ damp: v })} format={pct} />
          </Field>
        </Section>

        <Section
          icon={Waves}
          title="Hall"
          on={revOn}
          onToggle={setRevOn}
          presets={REVERB_PRESETS}
          activePreset={revPreset}
          onPreset={(k) => {
            setRevPreset(k);
            setReverb(pick(REVERB_PRESETS[k]));
          }}
        >
          <Field label="Nachhallzeit (Raumgröße)">
            <Slider value={reverb.decay} min={0.2} max={8} step={0.05} onChange={(v) => setR({ decay: v })} format={(v) => `${v.toFixed(1)} s`} />
          </Field>
          <Field label="Hall-Lautstärke">
            <Slider value={reverb.mix} min={0} max={1} step={0.01} onChange={(v) => setR({ mix: v })} format={pct} />
          </Field>
          <Field label="Vorverzögerung">
            <Slider value={reverb.predelay} min={0} max={0.12} step={0.001} onChange={(v) => setR({ predelay: v })} format={(v) => `${Math.round(v * 1000)} ms`} />
          </Field>
          <Field label="Dämpfung (wärmer)">
            <Slider value={reverb.damp} min={0} max={1} step={0.01} onChange={(v) => setR({ damp: v })} format={pct} />
          </Field>
        </Section>

        <p className="text-xs text-ink-500">
          {tail > 0 ? `Klingt ca. ${tail.toFixed(1)} s nach dem Clip-Ende nach. ` : ''}Die Effekte werden live berechnet – du kannst sie jederzeit ändern
          oder abschalten.
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => (playing ? stop() : start())}
            className={`h-9 px-3.5 rounded-lg text-sm flex items-center gap-2 ${
              playing ? 'bg-tape-500 text-white' : 'bg-ink-700 hover:bg-ink-600 text-ink-200'
            }`}
          >
            {playing ? <Square size={12} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
            {playing ? 'Stopp' : 'Vorhören'}
          </button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              stop();
              const fx = current();
              onApply({
                echo: fx.echo && fx.echo.mix > 0 ? fx.echo : undefined,
                reverb: fx.reverb && fx.reverb.mix > 0 ? fx.reverb : undefined,
              });
              onClose();
            }}
          >
            Übernehmen
          </Button>
        </div>
      </div>
    </Modal>
  );
}
