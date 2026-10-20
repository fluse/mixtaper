import React, { useEffect, useRef, useState } from 'react';
import { Repeat2, Play, Square, Trash2 } from 'lucide-react';
import { Modal, Button, Field, Slider } from './ui';
import { ECHO_PRESETS, buildGraph, echoTail } from '../lib/engine';
import { getAudioContext } from '../lib/audio';

const DEFAULT = ECHO_PRESETS.echo;

/** Echo eines Clips einstellen – mit Vorhören des Clips allein (inkl. Ausklang). */
export function EchoDialog({ clip, sources, onApply, onClose }) {
  const [echo, setEcho] = useState(() => ({ ...(clip.echo ?? DEFAULT) }));
  const [preset, setPreset] = useState(() => (clip.echo ? null : 'echo'));
  const [playing, setPlaying] = useState(false);
  const previewRef = useRef(null);
  const echoRef = useRef(echo);
  echoRef.current = echo;

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
    // Mini-Projekt nur mit diesem Clip ab 0 s
    const doc = {
      tracks: [{ id: 'preview', volume: 1, muted: false, solo: false, duck: false }],
      clips: [{ ...clip, start: 0, trackId: 'preview', echo: echoRef.current }],
      duckDepth: 1,
    };
    const out = actx.createGain();
    out.connect(actx.destination);
    const graph = buildGraph(actx, out, doc, sources, 0, { when: actx.currentTime + 0.03 });
    const total = clip.duration + echoTail(echoRef.current) + 0.2;
    const timer = setTimeout(stop, total * 1000);
    previewRef.current = { graph, out, timer };
    setPlaying(true);
  };

  // Beim Ändern der Regler während des Vorhörens neu starten (entprellt)
  useEffect(() => {
    if (!previewRef.current) return;
    const t = setTimeout(start, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [echo]);

  const set = (patch) => {
    setPreset(null);
    setEcho((e) => ({ ...e, ...patch }));
  };

  const tail = echoTail(echo);

  return (
    <Modal title={`Echo – ${clip.name}`} icon={Repeat2} onClose={onClose} width="max-w-xl">
      <div className="flex flex-col gap-4">
        <Field label="Voreinstellung">
          <div className="flex gap-1.5">
            {Object.entries(ECHO_PRESETS).map(([k, p]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setPreset(k);
                  setEcho({ time: p.time, feedback: p.feedback, mix: p.mix, damp: p.damp });
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
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Field label="Verzögerung">
            <Slider value={echo.time} min={0.03} max={1.5} step={0.01} onChange={(v) => set({ time: v })} format={(v) => `${Math.round(v * 1000)} ms`} />
          </Field>
          <Field label="Wiederholungen (Feedback)">
            <Slider value={echo.feedback} min={0} max={0.9} step={0.01} onChange={(v) => set({ feedback: v })} format={(v) => `${Math.round(v * 100)}%`} />
          </Field>
          <Field label="Echo-Lautstärke">
            <Slider value={echo.mix} min={0} max={1} step={0.01} onChange={(v) => set({ mix: v })} format={(v) => `${Math.round(v * 100)}%`} />
          </Field>
          <Field label="Dämpfung (wärmer)">
            <Slider value={echo.damp} min={0} max={1} step={0.01} onChange={(v) => set({ damp: v })} format={(v) => `${Math.round(v * 100)}%`} />
          </Field>
        </div>
        <p className="text-xs text-ink-500">
          Klingt ca. {tail.toFixed(1)} s nach dem Clip-Ende nach. Der Effekt wird live berechnet – du kannst ihn jederzeit ändern oder entfernen.
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
          {clip.echo && (
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() => {
                stop();
                onApply(undefined);
                onClose();
              }}
            >
              Echo entfernen
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            icon={Repeat2}
            onClick={() => {
              stop();
              onApply(echo.mix > 0 ? echo : undefined);
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
