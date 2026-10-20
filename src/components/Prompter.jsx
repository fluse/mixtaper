import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Pause, Play, RotateCcw, Minus, Plus, Mic } from 'lucide-react';

const LONG_PAUSE = /[.!?…]["“”»«)]*$/;
const SHORT_PAUSE = /[,;:—–]["“”»«)]*$/;

/** Text in Wörter mit Dauer in „Schlägen“ zerlegen (Satzzeichen = kleine Pausen). */
export function tokenize(text) {
  const words = [];
  const lines = (text || '').split(/\n/);
  lines.forEach((line, li) => {
    for (const w of line.split(/\s+/).filter(Boolean)) {
      const letters = w.replace(/[^\p{L}\p{N}]/gu, '').length;
      let beats = 1 + Math.max(0, Math.min(1, (letters - 6) * 0.1)); // lange Wörter etwas länger
      if (LONG_PAUSE.test(w)) beats += 1;
      else if (SHORT_PAUSE.test(w)) beats += 0.5;
      words.push({ word: w, beats, br: false });
    }
    if (li < lines.length - 1 && words.length) {
      const last = words[words.length - 1];
      if (!last.br) {
        last.br = true;
        last.beats += 0.5; // Zeilenwechsel = kurze Atempause
      }
    }
  });
  let t = 0;
  for (const w of words) {
    w.start = t;
    t += w.beats;
  }
  return { words, total: t };
}

/**
 * Karaoke-Vorlesehilfe: hebt Wort für Wort im eingestellten Tempo hervor.
 * mode: 'record' (läuft während der Aufnahme) | 'rehearse' (Probelesen)
 */
export function Prompter({ text, wpm, mode, onWpmStep, onClose }) {
  const { words, total } = useMemo(() => tokenize(text), [text]);
  const [idx, setIdx] = useState(-1);
  const [countdown, setCountdown] = useState(3);
  const [paused, setPaused] = useState(false);
  const [done, setDone] = useState(false);
  const posRef = useRef(0); // Position in Schlägen
  const wpmRef = useRef(wpm);
  wpmRef.current = wpm;
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const fillRef = useRef(null);
  const beatRef = useRef(null);
  const barRef = useRef(null);
  const wordEls = useRef([]);
  const idxRef = useRef(-1);

  // Countdown 3-2-1
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Taktgeber
  useEffect(() => {
    if (countdown > 0) return;
    let raf;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!pausedRef.current && posRef.current < total) {
        posRef.current = Math.min(total, posRef.current + (dt * wpmRef.current) / 60);
      }
      const pos = posRef.current;
      // aktuelles Wort suchen (ab dem bisherigen, die Position wächst nur)
      let i = Math.max(0, idxRef.current);
      while (i < words.length - 1 && words[i + 1].start <= pos) i++;
      if (pos >= total) i = words.length;
      if (i !== idxRef.current) {
        idxRef.current = i;
        setIdx(i);
        if (i >= words.length) setDone(true);
      }
      const w = words[i];
      if (w && fillRef.current) {
        const p = Math.min(1, (pos - w.start) / w.beats) * 100;
        fillRef.current.style.backgroundImage = `linear-gradient(90deg, #ff7ea6 ${p}%, #ffffff ${p}%)`;
      }
      if (beatRef.current) {
        const phase = pos % 1;
        const pulse = 1 - Math.min(1, phase * 3);
        beatRef.current.style.transform = `scale(${1 + pulse * 0.6})`;
        beatRef.current.style.opacity = String(0.35 + pulse * 0.65);
      }
      if (barRef.current) barRef.current.style.width = `${(pos / (total || 1)) * 100}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [countdown, words, total]);

  // aktuelles Wort mittig halten
  useEffect(() => {
    wordEls.current[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [idx]);

  // ↑/↓ Tempo, Esc schließen (nur beim Probelesen)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        onWpmStep(e.key === 'ArrowUp' ? 10 : -10);
      } else if (e.key === 'Escape' && mode === 'rehearse') {
        // nur die Vorlesehilfe schließen, nicht zusätzlich die Auswahl aufheben
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mode, onWpmStep, onClose]);

  const restart = () => {
    posRef.current = 0;
    idxRef.current = -1;
    setIdx(-1);
    setDone(false);
    setPaused(false);
    setCountdown(3);
  };

  return (
    <div className="fixed left-1/2 -translate-x-1/2 top-[72px] z-[55] w-[min(960px,92vw)] rounded-2xl border border-ink-600 bg-ink-950/92 backdrop-blur-md shadow-2xl overflow-hidden">
      {/* Kopfzeile */}
      <div className="flex items-center gap-2 px-4 h-11 border-b border-ink-700/80">
        {mode === 'record' ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-red-400">
            <Mic size={13} className="rec-pulse" /> Aufnahme läuft
          </span>
        ) : (
          <span className="text-xs font-semibold text-ink-300">Probelesen</span>
        )}
        <div ref={beatRef} className="ml-3 size-3 rounded-full bg-tape-400" title="Takt" />
        <span className="text-[11px] text-ink-500 ml-1">Takt</span>
        <div className="flex-1" />
        <button type="button" title="Langsamer (↓)" onClick={() => onWpmStep(-10)} className="size-7 rounded-md text-ink-300 hover:bg-ink-700 flex items-center justify-center">
          <Minus size={14} />
        </button>
        <span className="text-xs tabular-nums text-ink-200 w-24 text-center">{wpm} Wörter/min</span>
        <button type="button" title="Schneller (↑)" onClick={() => onWpmStep(10)} className="size-7 rounded-md text-ink-300 hover:bg-ink-700 flex items-center justify-center">
          <Plus size={14} />
        </button>
        <div className="w-px h-5 bg-ink-700 mx-1" />
        <button type="button" title={paused ? 'Weiter' : 'Pause'} onClick={() => setPaused((p) => !p)} className="size-7 rounded-md text-ink-300 hover:bg-ink-700 flex items-center justify-center">
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
        <button type="button" title="Von vorn" onClick={restart} className="size-7 rounded-md text-ink-300 hover:bg-ink-700 flex items-center justify-center">
          <RotateCcw size={14} />
        </button>
        <button type="button" title="Vorlesehilfe schließen" onClick={onClose} className="size-7 rounded-md text-ink-300 hover:bg-ink-700 flex items-center justify-center">
          <X size={15} />
        </button>
      </div>

      {/* Text */}
      <div className="relative h-56 overflow-hidden">
        {countdown > 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink-950/70">
            <span key={countdown} className="text-7xl font-bold text-tape-400 animate-ping [animation-iteration-count:1] [animation-duration:1s]">
              {countdown}
            </span>
          </div>
        )}
        <div className="h-full overflow-y-auto px-8 py-20 text-[28px] leading-[1.6] font-semibold [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {words.map((w, i) => {
            const state = i < idx ? 'past' : i === idx ? 'now' : 'next';
            return (
              <React.Fragment key={i}>
                <span
                  ref={(el) => {
                    wordEls.current[i] = el;
                    if (i === idx) fillRef.current = el;
                  }}
                  className={
                    state === 'past'
                      ? 'text-ink-500 transition-colors'
                      : state === 'now'
                        ? 'bg-clip-text text-transparent scale-105 inline-block'
                        : 'text-ink-200'
                  }
                  style={state === 'now' ? { WebkitBackgroundClip: 'text', backgroundImage: 'linear-gradient(90deg, #ff7ea6 0%, #ffffff 0%)' } : undefined}
                >
                  {w.word}
                </span>
                {w.br ? <br /> : ' '}
              </React.Fragment>
            );
          })}
          {done && (
            <div className="mt-6 text-base font-medium text-emerald-400">
              Fertig ✓ {mode === 'record' ? '– mit R oder ■ die Aufnahme beenden' : ''}
            </div>
          )}
        </div>
        {/* sanfte Ränder oben/unten */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-linear-to-b from-ink-950 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-ink-950 to-transparent" />
      </div>
      <div className="h-1 bg-ink-800">
        <div ref={barRef} className="h-full bg-tape-500" style={{ width: 0 }} />
      </div>
    </div>
  );
}
