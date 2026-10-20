import React, { useEffect, useRef } from 'react';
import {
  CassetteTape, SkipBack, Play, Pause, Square, Mic, Upload, Youtube, StickyNote, Scissors, Trash2, Magnet,
  Undo2, Redo2, ZoomIn, ZoomOut, Volume2, FolderOpen, Save, Download, Printer, FilePlus,
} from 'lucide-react';
import { IconButton, Divider } from './ui';
import { usePlayhead } from '../lib/playhead';
import { fmtTime } from '../lib/utils';

function TimeDisplay({ total }) {
  const t = usePlayhead();
  return (
    <div className="px-3 h-9 rounded-lg bg-ink-950 border border-ink-700 flex items-center gap-1.5 font-mono tabular-nums text-sm whitespace-nowrap shrink-0">
      <span className="text-white">{fmtTime(t, true)}</span>
      <span className="text-ink-500">/ {fmtTime(total)}</span>
    </div>
  );
}

function LevelMeter({ analyser }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!analyser) return;
    const data = new Float32Array(analyser.fftSize);
    let raf;
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      if (ref.current) {
        ref.current.style.width = `${Math.min(100, Math.sqrt(peak) * 100)}%`;
        ref.current.style.background = peak > 0.9 ? '#ef4444' : peak > 0.5 ? '#f59e0b' : '#22c55e';
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [analyser]);
  return (
    <div className="w-20 h-2 rounded-full bg-ink-700 overflow-hidden" title="Mikrofon-Pegel">
      <div ref={ref} className="h-full transition-[width] duration-75" />
    </div>
  );
}

export function Toolbar({
  title,
  total,
  playing,
  recording,
  canUndo,
  canRedo,
  magnet,
  masterVolume,
  hasSelection,
  onNew,
  onToStart,
  onTogglePlay,
  onStop,
  onToggleRecord,
  onImport,
  onYoutube,
  onAddMarker,
  onSplit,
  onDelete,
  onToggleMagnet,
  onUndo,
  onRedo,
  onZoom,
  onMasterVolume,
  onOpen,
  onSave,
  onExport,
  onJCard,
}) {
  return (
    <header className="flex items-center gap-1 px-3 h-14 border-b border-ink-700 bg-ink-900 shrink-0 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden">
      <div className="flex shrink-0 items-center gap-2 pr-3 mr-1 border-r border-ink-700 h-8">
        <div className="size-8 rounded-lg bg-linear-to-br from-tape-500 to-sun-400 flex items-center justify-center">
          <CassetteTape size={18} className="text-white" />
        </div>
        <div className="leading-tight hidden 2xl:block">
          <div className="text-sm font-bold text-white">MixTape</div>
          <div className="text-[11px] text-ink-400 max-w-40 truncate">{title}</div>
        </div>
      </div>

      <IconButton icon={FilePlus} label="Neues Projekt" onClick={onNew} />
      <IconButton icon={FolderOpen} label="Projekt öffnen (Strg+O)" onClick={onOpen} />
      <IconButton icon={Save} label="Projekt speichern (Strg+S)" onClick={onSave} />
      <Divider />

      <IconButton icon={SkipBack} label="Zum Anfang (Pos1)" onClick={onToStart} />
      <button
        type="button"
        onClick={onTogglePlay}
        title="Abspielen / Pause (Leertaste)"
        className="size-10 shrink-0 rounded-full bg-white text-ink-950 hover:scale-105 transition-transform flex items-center justify-center mx-0.5"
      >
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
      </button>
      <IconButton icon={Square} label="Stopp" onClick={onStop} />
      <button
        type="button"
        onClick={onToggleRecord}
        title="Sprachaufnahme starten/stoppen (R)"
        className={`h-9 px-3 shrink-0 whitespace-nowrap rounded-lg flex items-center gap-2 text-sm font-medium transition-colors ${
          recording ? 'bg-red-500 text-white' : 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
        }`}
      >
        {recording ? <Square size={14} fill="currentColor" /> : <Mic size={16} />}
        {recording ? (
          <>
            <span className="rec-pulse">Aufnahme</span>
            <LevelMeter analyser={recording.analyser} />
          </>
        ) : (
          <span className="hidden 2xl:inline">Aufnehmen</span>
        )}
      </button>
      <TimeDisplay total={total} />
      <Divider />

      <IconButton icon={Upload} label="Audiodateien importieren" onClick={onImport} />
      <IconButton icon={Youtube} label="Von YouTube importieren" onClick={onYoutube} />
      <IconButton icon={StickyNote} label="Notiz / Marker an Abspielposition (M)" onClick={onAddMarker} />
      <IconButton icon={Scissors} label="Clip an Abspielposition teilen (S)" onClick={onSplit} />
      <IconButton icon={Trash2} label="Auswahl löschen (Entf)" onClick={onDelete} disabled={!hasSelection} danger />
      <IconButton icon={Magnet} label="Magnet-Modus: Clips rasten an Kanten ein" onClick={onToggleMagnet} active={magnet} />
      <Divider />
      <IconButton icon={Undo2} label="Rückgängig (Strg+Z)" onClick={onUndo} disabled={!canUndo} />
      <IconButton icon={Redo2} label="Wiederholen (Strg+Y)" onClick={onRedo} disabled={!canRedo} />
      <div className="hidden xl:flex shrink-0 gap-1">
        <IconButton icon={ZoomOut} label="Herauszoomen (−)" onClick={() => onZoom(1 / 1.5)} />
        <IconButton icon={ZoomIn} label="Hineinzoomen (+)" onClick={() => onZoom(1.5)} />
      </div>

      <div className="flex-1 min-w-2" />

      <div className="hidden xl:flex shrink-0 items-center gap-2 mr-2" title="Gesamtlautstärke (Master)">
        <Volume2 size={16} className="text-ink-400" />
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.01}
          value={masterVolume}
          onChange={(e) => onMasterVolume(parseFloat(e.target.value))}
          onDoubleClick={() => onMasterVolume(1)}
          className="w-24"
        />
        <span className="hidden 2xl:inline w-9 text-xs text-ink-400 tabular-nums">{Math.round(masterVolume * 100)}%</span>
      </div>
      <IconButton icon={Printer} label="Kassetten-Einleger & Tracklist" onClick={onJCard}>
        <span className="hidden 2xl:inline whitespace-nowrap">J-Card</span>
      </IconButton>
      <button
        type="button"
        onClick={onExport}
        className="h-9 px-3.5 shrink-0 whitespace-nowrap rounded-lg bg-tape-500 hover:bg-tape-400 text-white text-sm font-medium flex items-center gap-2 shadow-lg shadow-tape-500/20"
        title="Mixtape exportieren"
      >
        <Download size={16} /> <span className="hidden xl:inline">Exportieren</span>
      </button>
    </header>
  );
}
