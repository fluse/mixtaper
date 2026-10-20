import React, { useState } from 'react';
import { ListMusic, Play, Square, Plus, X, ChevronRight, ChevronLeft, Search, GripVertical, TriangleAlert } from 'lucide-react';
import { SOUND_MIME } from './Timeline';
import { ResizeHandle } from './ui';
import { fmtTime } from '../lib/utils';

function MiniWave({ wave, active }) {
  if (!wave) return <div className="h-5 rounded bg-ink-800/80 animate-pulse" />;
  let d = '';
  wave.forEach((v, i) => {
    const h = Math.max(1.5, v / 2);
    d += `M${i + 0.5} ${50 - h}V${50 + h}`;
  });
  return (
    <svg viewBox={`0 0 ${wave.length} 100`} preserveAspectRatio="none" className={`w-full h-5 ${active ? 'text-tape-400' : 'text-ink-400 group-hover:text-ink-300'}`}>
      <path d={d} stroke="currentColor" strokeWidth="0.7" />
    </svg>
  );
}

function SoundRow({ item, playing, onPreview, onRename, onRemove }) {
  const [editing, setEditing] = useState(false);
  return (
    <div
      draggable={!item.missing && !editing}
      onDragStart={(e) => {
        e.dataTransfer.setData(SOUND_MIME, item.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className={`group flex items-center gap-2 h-12 pl-1 pr-1.5 rounded-lg ${
        item.missing ? 'opacity-60' : 'cursor-grab active:cursor-grabbing hover:bg-ink-700/70'
      }`}
      title={item.missing ? `Datei nicht gefunden: ${item.path}` : `${item.path}\nIn eine Spur ziehen zum Einfügen`}
    >
      <GripVertical size={14} className="shrink-0 text-ink-600 group-hover:text-ink-400" />
      <button
        type="button"
        disabled={item.missing}
        onClick={() => onPreview(item)}
        title={playing ? 'Vorhören stoppen' : 'Vorhören'}
        className={`size-7 shrink-0 rounded-full flex items-center justify-center transition-colors disabled:pointer-events-none ${
          playing ? 'bg-tape-500 text-white' : 'bg-ink-700 text-ink-300 hover:bg-ink-600 hover:text-white'
        }`}
      >
        {item.missing ? (
          <TriangleAlert size={11} className="text-amber-400" />
        ) : playing ? (
          <Square size={9} fill="currentColor" />
        ) : (
          <Play size={10} fill="currentColor" className="ml-px" />
        )}
      </button>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
      {editing ? (
        <input
          autoFocus
          defaultValue={item.name}
          onBlur={(e) => {
            setEditing(false);
            const name = e.target.value.trim();
            if (name && name !== item.name) onRename(item.id, name);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="w-full h-5 rounded bg-ink-950 border border-ink-600 px-1.5 text-sm text-white focus:outline-none"
        />
      ) : (
        <span className="truncate text-sm leading-5 text-ink-200" onDoubleClick={() => setEditing(true)}>
          {item.name}
        </span>
      )}
      {item.missing ? <div className="h-5 border-b border-dashed border-ink-600" /> : <MiniWave wave={item.wave} active={playing} />}
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-ink-500">{fmtTime(item.duration)}</span>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        title="Aus der Liste entfernen (Datei bleibt erhalten)"
        className="size-6 shrink-0 rounded flex items-center justify-center text-ink-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function SoundLibrary({
  items,
  width,
  onResize,
  previewId,
  collapsed,
  onToggle,
  onPreview,
  onRename,
  onRemove,
  onAddFiles,
  onAddDialog,
}) {
  const [query, setQuery] = useState('');
  const [dropHover, setDropHover] = useState(false);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        title="Sound-Liste öffnen"
        className="w-10 shrink-0 border-l border-ink-700 bg-ink-900 hover:bg-ink-850 flex flex-col items-center gap-2 pt-3 text-ink-400 hover:text-white"
      >
        <ChevronLeft size={16} />
        <ListMusic size={16} />
        <span className="text-[11px] [writing-mode:vertical-rl] rotate-180 tracking-wider">Sounds ({items.length})</span>
      </button>
    );
  }

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;

  return (
    <div
      className={`relative shrink-0 border-l border-ink-700 bg-ink-900 flex flex-col min-h-0 ${dropHover ? 'ring-2 ring-inset ring-tape-400 bg-tape-500/5' : ''}`}
      style={{ width }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropHover(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setDropHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropHover(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onAddFiles(files);
      }}
    >
      <ResizeHandle
        direction="x-left"
        value={width}
        onChange={onResize}
        className="absolute -left-1 top-0 bottom-0 w-2 z-20 cursor-ew-resize"
        title="Breite ziehen"
      />
      <div className="flex items-center gap-1.5 px-2.5 h-10 shrink-0 border-b border-ink-700">
        <ListMusic size={15} className="text-tape-400 shrink-0" />
        <span className="text-sm font-medium text-white">Sounds</span>
        <div className="flex-1 min-w-0 relative ml-1">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Suchen …"
            className="w-full h-7 rounded-md bg-ink-950 border border-ink-700 pl-7 pr-2 text-xs text-ink-200 placeholder:text-ink-500 focus:outline-none focus:border-tape-500/60"
          />
        </div>
        <button
          type="button"
          onClick={onAddDialog}
          title="Sounds hinzufügen"
          className="size-7 shrink-0 rounded-md flex items-center justify-center text-ink-300 hover:text-white hover:bg-ink-700"
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          onClick={onToggle}
          title="Sound-Liste einklappen"
          className="size-7 shrink-0 rounded-md flex items-center justify-center text-ink-400 hover:text-white hover:bg-ink-700"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-1.5">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-xs text-ink-500 px-6 gap-1">
            <span className="text-ink-400">Noch keine Sounds</span>
            Zieh Audiodateien hier hinein oder übernimm einen Clip mit „In Sound-Liste“. Von hier aus ziehst du sie in jede Spur.
          </div>
        ) : shown.length === 0 ? (
          <div className="text-xs text-ink-500 p-3">Nichts gefunden.</div>
        ) : (
          shown.map((item) => (
            <SoundRow
              key={item.id}
              item={item}
              playing={previewId === item.id}
              onPreview={onPreview}
              onRename={onRename}
              onRemove={onRemove}
            />
          ))
        )}
      </div>
    </div>
  );
}
