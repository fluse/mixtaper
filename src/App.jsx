import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, TriangleAlert, Check, Info } from 'lucide-react';
import { Toolbar } from './components/Toolbar';
import { Timeline, HEADER_W } from './components/Timeline';
import { Inspector } from './components/Inspector';
import { YouTubeDialog, ExportDialog, JCardDialog } from './components/Dialogs';
import { SoundLibrary } from './components/SoundLibrary';
import { VoiceFxDialog } from './components/VoiceFxDialog';
import { FxDialog } from './components/FxDialog';
import { Prompter } from './components/Prompter';
import { VoiceDialog } from './components/VoiceDialog';
import { transformVoiceAsync, regionMono, monoToBuffer } from './lib/voiceclient';
import { encodeWav } from './lib/voicefx';
import { ResizeHandle } from './components/ui';
import { useHistory } from './lib/history';
import { playhead } from './lib/playhead';
import { Player } from './lib/engine';
import { computeMiniWave, computePeaks, decodeAudio, detectSound, getAudioContext } from './lib/audio';
import {
  basename, clamp, clipEnd, emptyDoc, fmtTime, isTypingTarget, newTrack, projectDuration, selectedClipIds, stripExt, trackEnd, uid,
} from './lib/utils';

const toArrayBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

/** Zahl, die über Neustarts erhalten bleibt (z. B. Panel-Größen). */
function useStoredNumber(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem(key));
      return Number.isFinite(v) ? v : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, String(Math.round(value)));
    } catch {
      /* nicht kritisch */
    }
  }, [key, value]);
  return [value, setValue];
}

export default function App() {
  const { doc, set, commitFrom, undo, redo, reset, canUndo, canRedo } = useHistory(emptyDoc());
  const docRef = useRef(doc);
  docRef.current = doc;

  const sourcesRef = useRef(new Map());
  const [srcVersion, setSrcVersion] = useState(0);
  const playerRef = useRef(null);
  if (!playerRef.current) playerRef.current = new Player();
  const player = playerRef.current;

  const scrollRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(30);
  const [selection, setSelection] = useState(null);
  const [selectedTrackId, setSelectedTrackId] = useState(() => doc.tracks[0]?.id);
  const [magnet, setMagnet] = useState(true);
  const [projectPath, setProjectPath] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [recording, setRecording] = useState(null);
  const [recSettings, setRecSettings] = useState(() => {
    const defaults = { deviceId: '', lowerMusic: false, cueLevel: 0.35, trimSilence: true, prompter: true, wpm: 130, promptText: '' };
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem('mixtape.recSettings') || '{}') };
    } catch {
      return defaults;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('mixtape.recSettings', JSON.stringify(recSettings));
    } catch {
      /* nicht kritisch */
    }
  }, [recSettings]);
  const recRef = useRef(null);
  const [bottomH, setBottomH] = useStoredNumber('mixtape.bottomH', 230);
  const [libraryW, setLibraryW] = useStoredNumber('mixtape.libraryW', 520);
  const editSnapshot = useRef(null);

  const total = projectDuration(doc);

  const notify = useCallback((text, kind = 'info') => {
    setToast({ text, kind, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    document.title = `${doc.title || 'Mixtape'} – MixTape`;
  }, [doc.title]);

  /* ---------------------------------------------------------------- */
  /* Bearbeitungs-Transaktionen (Slider, Texteingaben)                 */
  /* ---------------------------------------------------------------- */

  const beginEdit = useCallback(() => {
    if (!editSnapshot.current) editSnapshot.current = docRef.current;
  }, []);
  const endEdit = useCallback(() => {
    if (editSnapshot.current) commitFrom(editSnapshot.current);
    editSnapshot.current = null;
  }, [commitFrom]);

  /* ---------------------------------------------------------------- */
  /* Wiedergabe                                                        */
  /* ---------------------------------------------------------------- */

  const startPlayback = useCallback(
    async (from = playhead.get()) => {
      await player.play(docRef.current, sourcesRef.current, from);
      setPlaying(true);
    },
    [player],
  );

  const stopPlayback = useCallback(() => {
    const pos = player.stop();
    playhead.set(pos);
    setPlaying(false);
  }, [player]);

  const togglePlay = useCallback(() => {
    if (recRef.current) return;
    if (player.playing) stopPlayback();
    else {
      if (playhead.get() >= projectDuration(docRef.current) - 0.05) playhead.set(0);
      startPlayback();
    }
  }, [player, startPlayback, stopPlayback]);

  const seek = useCallback(
    (t) => {
      t = Math.max(0, t);
      playhead.set(t);
      if (player.playing && !recRef.current) player.play(docRef.current, sourcesRef.current, t);
      else player.seek(t);
    },
    [player],
  );

  // Positionsanzeige während der Wiedergabe
  useEffect(() => {
    if (!playing) return;
    let raf;
    const tick = () => {
      const pos = player.position();
      playhead.set(pos);
      if (!recRef.current && pos > projectDuration(docRef.current) + 0.3) {
        player.stop();
        player.seek(projectDuration(docRef.current));
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, player]);

  // Clip-Änderungen während der Wiedergabe → neu planen
  const duckKey = doc.tracks.map((t) => `${t.id}:${t.duck}:${t.duck && t.muted}`).join('|');
  useEffect(() => {
    if (player.playing && !recRef.current) player.play(docRef.current, sourcesRef.current, player.position());
  }, [doc.clips, duckKey, doc.duckDepth, srcVersion, player]);

  // Lautstärken live
  useEffect(() => player.updateTrackGains(doc), [doc.tracks, player, doc]);
  useEffect(() => player.setMaster(doc.masterVolume ?? 1), [doc.masterVolume, player]);

  /* ---------------------------------------------------------------- */
  /* Quellen & Import                                                  */
  /* ---------------------------------------------------------------- */

  const loadSource = useCallback(async ({ arrayBuffer, path, name, id }) => {
    const buffer = await decodeAudio(arrayBuffer);
    const src = { id: id || uid('src'), path, name, buffer, peaks: computePeaks(buffer) };
    sourcesRef.current.set(src.id, src);
    setSrcVersion((v) => v + 1);
    return src;
  }, []);

  /* ---------------------------------------------------------------- */
  /* Stimme verwandeln                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Berechnet die verwandelte Fassung eines Clips – immer vom Original aus (voiceFrom),
   * damit mehrfaches Ändern keine Qualität kostet. settings = null → zurück zur Original-Stimme.
   */
  const voiceClip = useCallback(async (c, settings) => {
    const fromId = c.voiceFrom?.sourceId ?? c.sourceId;
    const absOffset = c.voiceFrom ? c.voiceFrom.offset + c.offset : c.offset;
    if (!settings) return c.voiceFrom ? { sourceId: fromId, offset: absOffset, voice: undefined, voiceFrom: undefined } : null;
    const orig = sourcesRef.current.get(fromId);
    if (!orig?.buffer) throw new Error('Audiodatei nicht geladen');
    const sr = orig.buffer.sampleRate;
    const out = await transformVoiceAsync(regionMono(orig.buffer, absOffset, c.duration), sr, settings);
    const buffer = monoToBuffer(out, sr);
    const name = `${stripExt(orig.name || c.name)} (${settings.label})`;
    const path = await window.api.saveRecording(encodeWav(buffer), 'wav', name);
    const src = { id: uid('src'), path, name, buffer, peaks: computePeaks(buffer) };
    sourcesRef.current.set(src.id, src);
    return { sourceId: src.id, offset: 0, voice: settings, voiceFrom: { sourceId: fromId, offset: absOffset } };
  }, []);

  const applyVoice = useCallback(
    async (ids, settings, record = true) => {
      const clips = docRef.current.clips.filter((c) => ids.includes(c.id));
      const patches = new Map();
      for (let i = 0; i < clips.length; i++) {
        setBusy(clips.length > 1 ? `Verwandle Stimme ${i + 1}/${clips.length} …` : 'Verwandle Stimme …');
        try {
          const p = await voiceClip(clips[i], settings);
          if (p) patches.set(clips[i].id, p);
        } catch (err) {
          notify(`„${clips[i].name}“: ${err.message}`, 'error');
        }
      }
      setBusy(null);
      setSrcVersion((v) => v + 1);
      if (patches.size) set((d) => ({ ...d, clips: d.clips.map((c) => (patches.has(c.id) ? { ...c, ...patches.get(c.id) } : c)) }), record);
      return patches.size;
    },
    [voiceClip, set, notify],
  );

  /** Fügt geladene Quellen nacheinander als Clips ein. */
  const insertSources = useCallback(
    (srcs, trackId, at) => {
      const d = docRef.current;
      let createdTrack = null;
      let tid = trackId;
      if (!tid || !d.tracks.some((t) => t.id === tid)) {
        createdTrack = newTrack(d.tracks, { name: stripExt(srcs[0]?.name) || `Spur ${d.tracks.length + 1}` });
        tid = createdTrack.id;
      }
      let t = at ?? trackEnd(d, tid);
      const clips = srcs.map((s) => {
        const c = {
          id: uid('clip'),
          trackId: tid,
          sourceId: s.id,
          name: s.clipName ?? stripExt(s.name),
          start: t,
          offset: s.clipOffset ?? 0,
          ...(s.clipReversed ? { reversed: true } : {}),
          duration: s.clipDuration ?? s.buffer.duration,
          gain: 1,
          fadeIn: 0,
          fadeOut: 0,
        };
        t += c.duration;
        return c;
      });
      set((x) => ({
        ...x,
        tracks: createdTrack ? [...x.tracks, createdTrack] : x.tracks,
        clips: [...x.clips, ...clips],
      }));
      if (createdTrack) setSelectedTrackId(createdTrack.id);
      if (clips.length === 1) setSelection({ type: 'clip', id: clips[0].id });
      return clips;
    },
    [set],
  );

  /* ---------------------------------------------------------------- */
  /* Sound-Liste                                                       */
  /* ---------------------------------------------------------------- */

  const [library, setLibrary] = useState([]);
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const [libraryCollapsed, setLibraryCollapsed] = useState(() => {
    try {
      return localStorage.getItem('mixtape.libraryCollapsed') === '1';
    } catch {
      return false;
    }
  });
  const [previewId, setPreviewId] = useState(null);
  const previewRef = useRef(null);

  useEffect(() => {
    window.api.getLibrary().then(setLibrary).catch(() => {});
  }, []);

  const toggleLibrary = useCallback(() => {
    setLibraryCollapsed((c) => {
      try {
        localStorage.setItem('mixtape.libraryCollapsed', c ? '0' : '1');
      } catch {
        /* nicht kritisch */
      }
      return !c;
    });
  }, []);

  const storeLibrary = useCallback((next) => {
    libraryRef.current = next;
    setLibrary(next);
    window.api.setLibrary(next).catch(() => {});
  }, []);

  const waveFailed = useRef(new Set());
  useEffect(() => {
    const todo = library.filter((i) => !i.wave && !i.missing && !waveFailed.current.has(i.id));
    if (!todo.length) return;
    let cancelled = false;
    (async () => {
      for (const item of todo) {
        if (cancelled) return;
        try {
          const u8 = await window.api.readFile(item.path);
          if (!u8) throw new Error('missing');
          const buf = await decodeAudio(toArrayBuffer(u8));
          if (cancelled) return;
          const wave = computeMiniWave(buf, item.offset ?? 0, item.duration);
          storeLibrary(libraryRef.current.map((i) => (i.id === item.id ? { ...i, wave } : i)));
        } catch {
          waveFailed.current.add(item.id);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [library, storeLibrary]);

  /** Liefert eine (ggf. bereits geladene) Quelle für einen Dateipfad. */
  const sourceForPath = useCallback(
    async (path, name) => {
      for (const s of sourcesRef.current.values()) if (s.path === path && s.buffer) return s;
      const u8 = await window.api.readFile(path);
      if (!u8) throw new Error('Datei nicht gefunden');
      return loadSource({ arrayBuffer: toArrayBuffer(u8), path, name });
    },
    [loadSource],
  );

  /** entries: [{ path, name, offset?, duration? }] */
  const addToLibrary = useCallback(
    async (entries) => {
      const added = [];
      for (const en of entries) {
        if (!en.path) continue;
        const offset = en.offset ?? 0;
        const dupe = libraryRef.current.some(
          (i) =>
            i.path === en.path &&
            Math.abs((i.offset ?? 0) - offset) < 0.01 &&
            !!i.reversed === !!en.reversed &&
            (en.duration == null || Math.abs(i.duration - en.duration) < 0.01),
        );
        if (dupe) continue;
        try {
          setBusy(`Lade ${en.name} …`);
          const src = await sourceForPath(en.path, en.name);
          added.push({
            id: uid('snd'),
            name: stripExt(en.name),
            path: en.path,
            offset,
            duration: en.duration ?? src.buffer.duration - offset,
            wave: computeMiniWave(src.buffer, offset, en.duration ?? src.buffer.duration - offset),
            ...(en.reversed ? { reversed: true } : {}),
            addedAt: Date.now(),
          });
        } catch {
          notify(`Konnte nicht gelesen werden: ${en.name}`, 'error');
        }
      }
      setBusy(null);
      if (added.length) {
        storeLibrary([...added, ...libraryRef.current]);
        notify(added.length === 1 ? `„${added[0].name}“ in die Sound-Liste aufgenommen` : `${added.length} Sounds aufgenommen`, 'success');
      } else if (entries.length) notify('Schon in der Sound-Liste', 'info');
    },
    [sourceForPath, storeLibrary, notify],
  );

  const stopPreview = useCallback(() => {
    if (previewRef.current) {
      try {
        previewRef.current.stop();
      } catch {
        /* bereits beendet */
      }
      previewRef.current = null;
    }
    setPreviewId(null);
  }, []);

  const togglePreview = useCallback(
    async (item) => {
      const same = previewId === item.id;
      stopPreview();
      if (same) return;
      try {
        const src = await sourceForPath(item.path, item.name);
        const actx = getAudioContext();
        await actx.resume();
        const node = actx.createBufferSource();
        node.buffer = src.buffer;
        node.connect(actx.destination);
        node.onended = () => {
          if (previewRef.current === node) {
            previewRef.current = null;
            setPreviewId(null);
          }
        };
        node.start(0, item.offset ?? 0, item.duration);
        previewRef.current = node;
        setPreviewId(item.id);
      } catch (err) {
        notify(`Vorhören nicht möglich: ${err.message}`, 'error');
      }
    },
    [previewId, stopPreview, sourceForPath, notify],
  );

  const insertSound = useCallback(
    async (soundId, trackId, at) => {
      const item = libraryRef.current.find((i) => i.id === soundId);
      if (!item) return;
      try {
        const src = await sourceForPath(item.path, item.name);
        const offset = Math.min(item.offset ?? 0, src.buffer.duration);
        insertSources(
          [{ ...src, clipName: item.name, clipOffset: offset, clipDuration: Math.min(item.duration, src.buffer.duration - offset), clipReversed: item.reversed }],
          trackId,
          at,
        );
      } catch (err) {
        notify(`„${item.name}“: ${err.message}`, 'error');
      }
    },
    [sourceForPath, insertSources, notify],
  );

  const importItems = useCallback(
    async (items, trackId, at) => {
      const srcs = [];
      const failed = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        setBusy(`Lade ${it.name} (${i + 1}/${items.length}) …`);
        try {
          const arrayBuffer = await it.read();
          srcs.push(await loadSource({ arrayBuffer, path: it.path, name: it.name }));
        } catch (err) {
          console.error(err);
          failed.push(it.name);
        }
      }
      setBusy(null);
      if (srcs.length) insertSources(srcs, trackId, at);
      if (failed.length) notify(`Konnte nicht gelesen werden: ${failed.join(', ')}`, 'error');
      else if (srcs.length) notify(`${srcs.length} Datei(en) eingefügt`, 'success');
    },
    [loadSource, insertSources, notify],
  );

  const importDialog = useCallback(async () => {
    const paths = await window.api.openAudioDialog();
    if (!paths.length) return;
    const tid = selectedTrackId && docRef.current.tracks.some((t) => t.id === selectedTrackId) ? selectedTrackId : null;
    importItems(
      paths.map((p) => ({
        name: basename(p),
        path: p,
        read: async () => {
          const u8 = await window.api.readFile(p);
          if (!u8) throw new Error('Datei nicht lesbar');
          return toArrayBuffer(u8);
        },
      })),
      tid,
      undefined,
    );
  }, [importItems, selectedTrackId]);

  const onDropFiles = useCallback(
    (files, trackId, time) => {
      importItems(
        files.map((f) => ({ name: f.name, path: window.api.getPathForFile(f), read: () => f.arrayBuffer() })),
        trackId,
        time,
      );
    },
    [importItems],
  );

  const onYoutubeImported = useCallback(
    async ({ path, title }, trackId, where) => {
      if (where === 'library') {
        await addToLibrary([{ path, name: title }]);
        return;
      }
      const u8 = await window.api.readFile(path);
      if (!u8) throw new Error('Heruntergeladene Datei nicht gefunden');
      const src = await loadSource({ arrayBuffer: toArrayBuffer(u8), path, name: title });
      insertSources([src], trackId, where === 'playhead' ? playhead.get() : undefined);
      notify(`„${title}“ eingefügt`, 'success');
    },
    [loadSource, insertSources, notify, addToLibrary],
  );

  /* ---------------------------------------------------------------- */
  /* Aufnahme                                                          */
  /* ---------------------------------------------------------------- */

  const [prompter, setPrompter] = useState(null); // { text, mode: 'record' | 'rehearse' }
  const [voiceTarget, setVoiceTarget] = useState(null); // { mode: 'clip' } | { mode: 'track', trackId }

  /** Vorlesetext: Notiz an/vor der Abspielposition, sonst eigener Text aus den Einstellungen. */
  const findPromptText = useCallback(() => {
    const t = playhead.get();
    const m = docRef.current.markers
      .filter((x) => x.note?.trim() && x.time <= t + 0.5)
      .sort((a, b) => b.time - a.time)[0];
    return m?.note?.trim() || recSettings.promptText?.trim() || '';
  }, [recSettings.promptText]);

  const startRecording = useCallback(async (opts) => {
    if (recRef.current) return;
    const promptText = typeof opts?.text === 'string' ? opts.text : recSettings.prompter ? findPromptText() : '';
    let stream;
    try {
      const audio = { echoCancellation: false, noiseSuppression: true, autoGainControl: true };
      const { deviceId } = recSettings;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...audio, deviceId: { exact: deviceId } } : audio });
      } catch (err) {
        // Gewähltes Gerät nicht (mehr) verfügbar → Standardgerät
        if (!deviceId || !['OverconstrainedError', 'NotFoundError'].includes(err.name)) throw err;
        stream = await navigator.mediaDevices.getUserMedia({ audio });
        notify('Gewähltes Mikrofon nicht gefunden – nehme mit dem Standardgerät auf.', 'info');
      }
    } catch (err) {
      notify(`Kein Mikrofonzugriff: ${err.message}`, 'error');
      return;
    }
    const actx = getAudioContext();
    await actx.resume();
    const input = actx.createMediaStreamSource(stream);
    const analyser = actx.createAnalyser();
    analyser.fftSize = 1024;
    input.connect(analyser);

    // Zielspur: ausgewählte Sprachspur, sonst erste Sprachspur, sonst neue
    const d = docRef.current;
    let track = d.tracks.find((t) => t.id === selectedTrackId && t.duck) || d.tracks.find((t) => t.duck);
    if (!track) {
      track = newTrack(d.tracks, { name: 'Sprache', duck: true });
      set((x) => ({ ...x, tracks: [...x.tracks, track] }));
    }
    setSelectedTrackId(track.id);

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 192000 });
    const chunks = [];
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const startAt = playhead.get();
    player.setCue(recSettings.lowerMusic ? recSettings.cueLevel : 1);
    if (player.playing) player.stop();
    await player.play(docRef.current, sourcesRef.current, startAt);
    setPlaying(true);
    mr.start(250);

    recRef.current = { mr, stream, input, chunks, startAt, trackId: track.id };
    setRecording({ analyser, trackId: track.id });
    if (promptText) setPrompter({ text: promptText, mode: 'record' });
  }, [notify, player, recSettings, selectedTrackId, set, findPromptText]);

  const stopRecording = useCallback(async () => {
    const r = recRef.current;
    if (!r) return;
    await new Promise((res) => {
      r.mr.onstop = res;
      r.mr.stop();
    });
    r.stream.getTracks().forEach((t) => t.stop());
    r.input.disconnect();
    recRef.current = null;
    setRecording(null);
    setPrompter((p) => (p?.mode === 'record' ? null : p));
    stopPlayback();
    player.setCue(1);

    setBusy('Speichere Aufnahme …');
    try {
      const blob = new Blob(r.chunks, { type: r.mr.mimeType });
      const ab = await blob.arrayBuffer();
      const path = await window.api.saveRecording(ab, 'webm');
      const now = new Date();
      const src = await loadSource({
        arrayBuffer: ab,
        path,
        name: `Aufnahme ${now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`,
      });
      let offset = 0;
      let duration = src.buffer.duration;
      if (recSettings.trimSilence) {
        const s = detectSound(src.buffer);
        if (s) {
          offset = s.start;
          duration = s.end - s.start;
        }
      }
      const clip = {
        id: uid('clip'),
        trackId: r.trackId,
        sourceId: src.id,
        name: src.name,
        start: r.startAt + offset,
        offset,
        duration,
        gain: 1,
        fadeIn: 0.05,
        fadeOut: 0.1,
      };
      set((d) => ({ ...d, clips: [...d.clips, clip] }));
      setSelection({ type: 'clip', id: clip.id });
      const figure = docRef.current.tracks.find((t) => t.id === r.trackId)?.voice;
      if (figure) {
        // Sprecher-Spur: direkt als Figur verwandeln (gleicher Undo-Schritt wie die Aufnahme)
        setBusy(`Verwandle als „${figure.label}“ …`);
        const patch = await voiceClip(clip, figure);
        set((d) => ({ ...d, clips: d.clips.map((c) => (c.id === clip.id ? { ...c, ...patch } : c)) }), false);
        setSrcVersion((v) => v + 1);
        notify(`Aufnahme als „${figure.label}“ eingefügt (${fmtTime(duration, true)})`, 'success');
      } else notify(`Aufnahme eingefügt (${fmtTime(duration, true)})`, 'success');
    } catch (err) {
      notify(`Aufnahme fehlgeschlagen: ${err.message}`, 'error');
    } finally {
      setBusy(null);
    }
  }, [loadSource, notify, player, recSettings.trimSilence, set, stopPlayback, voiceClip]);

  const toggleRecord = useCallback(() => (recRef.current ? stopRecording() : startRecording()), [startRecording, stopRecording]);

  const recordMarkerText = useCallback(
    (marker) => {
      seek(marker.time);
      startRecording({ text: marker.note || '' });
    },
    [seek, startRecording],
  );

  /* ---------------------------------------------------------------- */
  /* Bearbeiten                                                        */
  /* ---------------------------------------------------------------- */

  const updateClip = useCallback(
    (id, patch, record = true) => set((d) => ({ ...d, clips: d.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }), record),
    [set],
  );
  const updateMarker = useCallback(
    (id, patch, record = true) => set((d) => ({ ...d, markers: d.markers.map((m) => (m.id === id ? { ...m, ...patch } : m)) }), record),
    [set],
  );
  const updateTrack = useCallback(
    (id, patch, record = true) => set((d) => ({ ...d, tracks: d.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }), record),
    [set],
  );
  const updateDoc = useCallback((patch, record = true) => set((d) => ({ ...d, ...patch }), record), [set]);

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    if (selection.type === 'clip') {
      const ids = new Set(selectedClipIds(selection));
      set((d) => ({ ...d, clips: d.clips.filter((c) => !ids.has(c.id)) }));
    }
    if (selection.type === 'marker') set((d) => ({ ...d, markers: d.markers.filter((m) => m.id !== selection.id) }));
    setSelection(null);
  }, [selection, set]);

  const splitAt = useCallback(
    (t = playhead.get()) => {
      const d = docRef.current;
      const inside = (c) => t > c.start + 0.05 && t < clipEnd(c) - 0.05;
      let targets = selection?.type === 'clip' ? d.clips.filter((c) => c.id === selection.id && inside(c)) : [];
      if (!targets.length) targets = d.clips.filter((c) => c.trackId === selectedTrackId && inside(c));
      if (!targets.length) {
        notify('Kein Clip unter der Abspielposition zum Teilen.', 'info');
        return;
      }
      const replace = new Map();
      let rightSel = null;
      for (const c of targets) {
        const cut = t - c.start;
        // Rückwärts: der linke Teil spielt das Ende des Original-Ausschnitts
        const left = { ...c, duration: cut, fadeOut: 0, offset: c.reversed ? c.offset + c.duration - cut : c.offset };
        const right = {
          ...c,
          id: uid('clip'),
          start: t,
          offset: c.reversed ? c.offset : c.offset + cut,
          duration: c.duration - cut,
          fadeIn: 0,
        };
        rightSel = right.id;
        replace.set(c.id, [left, right]);
      }
      set((x) => ({ ...x, clips: x.clips.flatMap((c) => replace.get(c.id) ?? [c]) }));
      if (rightSel) setSelection({ type: 'clip', id: rightSel });
    },
    [selection, selectedTrackId, set, notify],
  );

  const duplicateClip = useCallback(() => {
    const ids = selectedClipIds(selection);
    const sel = docRef.current.clips.filter((x) => ids.includes(x.id));
    if (!sel.length) return;
    // Auswahl als Block direkt hinter sich selbst kopieren
    const span = Math.max(...sel.map(clipEnd)) - Math.min(...sel.map((c) => c.start));
    const copies = sel.map((c) => ({ ...c, id: uid('clip'), start: c.start + span }));
    set((d) => ({ ...d, clips: [...d.clips, ...copies] }));
    setSelection(
      copies.length === 1
        ? { type: 'clip', id: copies[0].id }
        : { type: 'clip', id: copies[copies.length - 1].id, ids: copies.map((c) => c.id) },
    );
  }, [selection, set]);

  /** Ausgewählte Clips gemeinsam um dt Sekunden verschieben (nicht vor 0). */
  const nudgeSelection = useCallback(
    (dt) => {
      const ids = new Set(selectedClipIds(selection));
      const sel = docRef.current.clips.filter((c) => ids.has(c.id));
      if (!sel.length) return false;
      const delta = Math.max(dt, -Math.min(...sel.map((c) => c.start)));
      if (delta) set((d) => ({ ...d, clips: d.clips.map((c) => (ids.has(c.id) ? { ...c, start: c.start + delta } : c)) }));
      return true;
    },
    [selection, set],
  );

  const selectAllClips = useCallback(() => {
    const ids = docRef.current.clips.map((c) => c.id);
    if (ids.length) setSelection({ type: 'clip', id: ids[ids.length - 1], ids });
  }, []);

  /* ---------------------------------------------------------------- */
  /* Zwischenablage (Strg+C / Strg+X / Strg+V)                         */
  /* ---------------------------------------------------------------- */

  // Enthält die Clips relativ zum Blockanfang plus ihre Quellen – Einfügen klappt so auch nach „Neues Projekt“.
  const clipboardRef = useRef(null);

  const copySelection = useCallback(
    (cut = false) => {
      const ids = new Set(selectedClipIds(selection));
      const d = docRef.current;
      const sel = d.clips.filter((c) => ids.has(c.id));
      if (!sel.length) return;
      const t0 = Math.min(...sel.map((c) => c.start));
      clipboardRef.current = {
        items: sel.map((c) => ({ clip: { ...c }, rel: c.start - t0, trackIdx: d.tracks.findIndex((t) => t.id === c.trackId) })),
        sources: new Map(
          sel
            .flatMap((c) => [c.sourceId, c.voiceFrom?.sourceId].filter(Boolean))
            .map((id) => [id, sourcesRef.current.get(id)])
            .filter(([, s]) => s),
        ),
      };
      const what = sel.length === 1 ? `„${sel[0].name}“` : `${sel.length} Clips`;
      if (cut) {
        set((x) => ({ ...x, clips: x.clips.filter((c) => !ids.has(c.id)) }));
        setSelection(null);
        notify(`${what} ausgeschnitten – Strg+V fügt an der Abspielposition ein`, 'info');
      } else notify(`${what} kopiert – Strg+V fügt an der Abspielposition ein`, 'info');
    },
    [selection, set, notify],
  );

  const pasteClipboard = useCallback(() => {
    const cb = clipboardRef.current;
    if (!cb?.items.length) return;
    // Quellen wieder bereitstellen, falls sie inzwischen fehlen (z. B. neues Projekt)
    let added = false;
    for (const [id, src] of cb.sources) {
      if (!sourcesRef.current.has(id)) {
        sourcesRef.current.set(id, src);
        added = true;
      }
    }
    if (added) setSrcVersion((v) => v + 1);

    const d = docRef.current;
    const at = playhead.get();
    const fallback = d.tracks.find((t) => t.id === selectedTrackId) ? selectedTrackId : d.tracks[0]?.id;
    const singleTrack = new Set(cb.items.map((i) => i.clip.trackId)).size === 1;
    let tracks = d.tracks;
    if (!tracks.length) tracks = [newTrack([], { name: 'Musik' })];
    const targetIdx = Math.max(0, tracks.findIndex((t) => t.id === (fallback ?? tracks[0].id)));
    const baseIdx = Math.min(...cb.items.map((i) => i.trackIdx));
    const copies = cb.items.map(({ clip, rel, trackIdx }) => {
      let trackId;
      if (singleTrack) trackId = tracks[targetIdx].id; // eine Spur → in die ausgewählte Spur
      else trackId = tracks[Math.min(tracks.length - 1, targetIdx + (trackIdx - baseIdx))].id; // Spurabstände beibehalten
      return { ...clip, id: uid('clip'), trackId, start: at + rel };
    });
    set((x) => ({ ...x, tracks: x.tracks.length ? x.tracks : tracks, clips: [...x.clips, ...copies] }));
    setSelection(
      copies.length === 1
        ? { type: 'clip', id: copies[0].id }
        : { type: 'clip', id: copies[copies.length - 1].id, ids: copies.map((c) => c.id) },
    );
    // Abspielmarker ans Ende des eingefügten Blocks → mehrfaches Einfügen reiht aneinander
    const end = Math.max(...copies.map(clipEnd));
    playhead.set(end);
    if (!player.playing) player.seek(end);
  }, [selectedTrackId, set, player]);

  const trimSilence = useCallback(() => {
    if (selection?.type !== 'clip') return;
    const c = docRef.current.clips.find((x) => x.id === selection.id);
    const buf = sourcesRef.current.get(c?.sourceId)?.buffer;
    if (!buf) return;
    const s = detectSound(buf, { from: c.offset, to: c.offset + c.duration });
    if (!s) {
      notify('Im Clip ist nur Stille.', 'info');
      return;
    }
    // Rückwärts: am Clip-Anfang liegt das Ende des Original-Ausschnitts
    const cutStart = c.reversed ? c.offset + c.duration - s.end : s.start - c.offset;
    updateClip(c.id, { start: c.start + cutStart, offset: s.start, duration: s.end - s.start });
    notify(`Stille entfernt (${(c.duration - (s.end - s.start)).toFixed(1)} s)`, 'success');
  }, [selection, updateClip, notify]);

  const crossfade = useCallback(
    (len = 3) => {
      if (selection?.type !== 'clip') return;
      const d = docRef.current;
      const c = d.clips.find((x) => x.id === selection.id);
      const prev = d.clips
        .filter((x) => x.trackId === c.trackId && x.id !== c.id && x.start < c.start)
        .sort((a, b) => clipEnd(b) - clipEnd(a))[0];
      if (!prev) {
        notify('Kein vorheriger Clip auf dieser Spur.', 'info');
        return;
      }
      const l = Math.min(len, prev.duration / 2, c.duration / 2);
      const start = Math.max(prev.start + 0.1, clipEnd(prev) - l);
      const delta = start - c.start;
      set((x) => ({
        ...x,
        clips: x.clips.map((k) => {
          if (k.id === prev.id) return { ...k, fadeOut: l };
          if (k.id === c.id) return { ...k, start, fadeIn: l };
          // Folgende Clips der Spur mitziehen
          if (k.trackId === c.trackId && k.start > c.start) return { ...k, start: Math.max(0, k.start + delta) };
          return k;
        }),
      }));
      notify(`Crossfade ${l.toFixed(1)} s gesetzt`, 'success');
    },
    [selection, set, notify],
  );

  const closeGaps = useCallback(
    (trackId) => {
      set((d) => {
        const own = d.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
        if (!own.length) return d;
        let t = own[0].start;
        const moved = new Map();
        for (const c of own) {
          moved.set(c.id, t);
          t += c.duration;
        }
        return { ...d, clips: d.clips.map((c) => (moved.has(c.id) ? { ...c, start: moved.get(c.id) } : c)) };
      });
      notify('Lücken geschlossen', 'success');
    },
    [set, notify],
  );

  const addMarker = useCallback(
    (time = playhead.get()) => {
      const m = { id: uid('mrk'), time, text: `Notiz ${docRef.current.markers.length + 1}`, note: '', chapter: false, color: '#fbbf24' };
      set((d) => ({ ...d, markers: [...d.markers, m] }));
      setSelection({ type: 'marker', id: m.id });
    },
    [set],
  );

  const addTrack = useCallback(() => {
    const t = newTrack(docRef.current.tracks);
    set((d) => ({ ...d, tracks: [...d.tracks, t] }));
    setSelectedTrackId(t.id);
  }, [set]);

  const deleteTrack = useCallback(
    (id) => {
      const d = docRef.current;
      const n = d.clips.filter((c) => c.trackId === id).length;
      if (n && !window.confirm(`Spur mit ${n} Clip(s) löschen?`)) return;
      set((x) => ({ ...x, tracks: x.tracks.filter((t) => t.id !== id), clips: x.clips.filter((c) => c.trackId !== id) }));
    },
    [set],
  );

  const applyZoom = useCallback(
    (factor) => {
      const el = scrollRef.current;
      const next = clamp(zoom * factor, 2, 400);
      const t = playhead.get();
      setZoom(next);
      if (el) requestAnimationFrame(() => (el.scrollLeft = Math.max(0, t * next - (el.clientWidth - HEADER_W) / 2)));
    },
    [zoom],
  );

  /* ---------------------------------------------------------------- */
  /* Projekte                                                          */
  /* ---------------------------------------------------------------- */

  const [recentProjects, setRecentProjects] = useState([]);
  const [startDismissed, setStartDismissed] = useState(false);
  const refreshRecent = useCallback(() => {
    window.api.recentProjects().then(setRecentProjects).catch(() => {});
  }, []);
  useEffect(refreshRecent, [refreshRecent]);

  const saveProject = useCallback(
    async (saveAs = false) => {
      const d = docRef.current;
      const used = new Set(d.clips.flatMap((c) => [c.sourceId, c.voiceFrom?.sourceId].filter(Boolean)));
      const sources = [...sourcesRef.current.values()]
        .filter((s) => used.has(s.id))
        .map((s) => ({ id: s.id, path: s.path, name: s.name }));
      const p = await window.api.saveProject({ app: 'MixTape', version: 1, doc: d, sources }, projectPath, saveAs);
      if (p) {
        setProjectPath(p);
        refreshRecent();
        notify(`Gespeichert: ${basename(p)}`, 'success');
        if (sources.some((s) => !s.path)) notify('Hinweis: Einige Clips haben keinen Dateipfad und fehlen beim Öffnen.', 'error');
      }
    },
    [projectPath, notify, refreshRecent],
  );

  /** Öffnet ein Projekt – mit Pfad direkt (z. B. aus „Zuletzt geöffnet“), sonst per Dialog. */
  const openProject = useCallback(async (filePath) => {
    const res = await window.api.openProject(typeof filePath === 'string' ? filePath : undefined).catch((err) => {
      notify(`Projekt konnte nicht geöffnet werden: ${err.message}`, 'error');
      return null;
    });
    refreshRecent();
    if (!res) return;
    if (player.playing) stopPlayback();
    const { data, path } = res;
    sourcesRef.current = new Map();
    const missing = [];
    for (let i = 0; i < data.sources.length; i++) {
      const s = data.sources[i];
      setBusy(`Lade Audio ${i + 1}/${data.sources.length}: ${s.name}`);
      const resolved = await window.api.resolveSource({ path: s.path, relPath: s.relPath, projectPath: path });
      const u8 = resolved ? await window.api.readFile(resolved) : null;
      try {
        if (!u8) throw new Error('missing');
        await loadSource({ arrayBuffer: toArrayBuffer(u8), path: resolved, name: s.name, id: s.id });
      } catch {
        missing.push(s.name);
        sourcesRef.current.set(s.id, { id: s.id, path: s.path, name: s.name, missing: true });
      }
    }
    setBusy(null);
    setSrcVersion((v) => v + 1);
    reset({ ...emptyDoc(), ...data.doc });
    setProjectPath(path);
    setSelection(null);
    setSelectedTrackId(data.doc.tracks[0]?.id);
    playhead.set(0);
    player.seek(0);
    if (missing.length) notify(`Nicht gefunden: ${missing.join(', ')}`, 'error');
    else notify(`Geöffnet: ${basename(path)}`, 'success');
  }, [loadSource, notify, player, reset, stopPlayback, refreshRecent]);

  const newProject = useCallback(() => {
    if (docRef.current.clips.length && !window.confirm('Neues Projekt anlegen? Nicht gespeicherte Änderungen gehen verloren.')) return;
    if (player.playing) stopPlayback();
    const d = emptyDoc();
    sourcesRef.current = new Map();
    setSrcVersion((v) => v + 1);
    reset(d);
    setProjectPath(null);
    setStartDismissed(false);
    refreshRecent();
    setSelection(null);
    setSelectedTrackId(d.tracks[0].id);
    playhead.set(0);
    player.seek(0);
  }, [player, reset, stopPlayback, refreshRecent]);

  /* ---------------------------------------------------------------- */
  /* Tastatur                                                          */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const onKey = (e) => {
      if (dialog || isTypingTarget(document.activeElement)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === 'z' && !e.shiftKey) (e.preventDefault(), undo());
      else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) (e.preventDefault(), redo());
      else if (ctrl && k === 's') (e.preventDefault(), saveProject(e.shiftKey));
      else if (ctrl && k === 'o') (e.preventDefault(), openProject());
      else if (ctrl && k === 'd') (e.preventDefault(), duplicateClip());
      else if (ctrl && k === 'a') (e.preventDefault(), selectAllClips());
      else if (ctrl && k === 'c') (e.preventDefault(), copySelection(false));
      else if (ctrl && k === 'x') (e.preventDefault(), copySelection(true));
      else if (ctrl && k === 'v') (e.preventDefault(), pasteClipboard());
      else if (ctrl) return;
      else if (e.code === 'Space') (e.preventDefault(), togglePlay());
      else if (k === 'delete' || k === 'backspace') deleteSelection();
      else if (k === 's') splitAt();
      else if (k === 'm') addMarker();
      else if (k === 'r') toggleRecord();
      else if (k === 'arrowleft' || k === 'arrowright') {
        e.preventDefault();
        const dir = k === 'arrowleft' ? -1 : 1;
        // Clips verschieben, sonst Abspielposition
        if (!nudgeSelection(dir * (e.shiftKey ? 1 : 0.1))) seek(playhead.get() + dir * (e.shiftKey ? 5 : 1));
      } else if (k === 'home') seek(0);
      else if (k === 'end') seek(projectDuration(docRef.current));
      else if (k === '+' || k === '=') applyZoom(1.5);
      else if (k === '-') applyZoom(1 / 1.5);
      else if (k === 'escape') setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, undo, redo, saveProject, openProject, duplicateClip, selectAllClips, copySelection, pasteClipboard, nudgeSelection, togglePlay, deleteSelection, splitAt, addMarker, toggleRecord, seek, applyZoom]);

  // Auswahl verwerfen, wenn das Objekt (z. B. durch Undo) verschwindet
  useEffect(() => {
    if (selection?.type === 'clip') {
      const ids = selectedClipIds(selection).filter((id) => doc.clips.some((c) => c.id === id));
      if (!ids.length) setSelection(null);
      else if (ids.length !== selectedClipIds(selection).length || !ids.includes(selection.id))
        setSelection(ids.length === 1 ? { type: 'clip', id: ids[0] } : { type: 'clip', id: ids.includes(selection.id) ? selection.id : ids[0], ids });
    }
    if (selection?.type === 'marker' && !doc.markers.some((m) => m.id === selection.id)) setSelection(null);
    if (selectedTrackId && !doc.tracks.some((t) => t.id === selectedTrackId)) setSelectedTrackId(doc.tracks[0]?.id);
  }, [doc, selection, selectedTrackId]);

  const clipToLibrary = useCallback(() => {
    if (selection?.type !== 'clip') return;
    const c = docRef.current.clips.find((x) => x.id === selection.id);
    const src = sourcesRef.current.get(c?.sourceId);
    if (!src?.path) {
      notify('Dieser Clip hat keine Datei auf der Festplatte.', 'error');
      return;
    }
    addToLibrary([{ path: src.path, name: c.name, offset: c.offset, duration: c.duration, reversed: !!c.reversed }]);
  }, [selection, addToLibrary, notify]);

  const selectedClip = selection?.type === 'clip' ? doc.clips.find((c) => c.id === selection.id) : null;

  const openVoiceFx = useCallback(() => {
    const c = selection?.type === 'clip' && docRef.current.clips.find((x) => x.id === selection.id);
    if (!sourcesRef.current.get(c?.sourceId)?.buffer) {
      notify('Für diesen Clip ist keine Audiodatei geladen.', 'error');
      return;
    }
    setDialog('voicefx');
  }, [selection, notify]);

  /** Optimierte Fassung als neue Datei speichern und dem Clip zuweisen (Original bleibt erhalten). */
  const applyVoiceFx = useCallback(
    async (buffer) => {
      const c = docRef.current.clips.find((x) => x.id === selection?.id);
      if (!c || !buffer) return;
      const name = `${c.name.replace(/ \(optimiert\)$/, '')} (optimiert)`;
      try {
        const path = await window.api.saveRecording(encodeWav(buffer), 'wav', name);
        const src = { id: uid('src'), path, name, buffer, peaks: computePeaks(buffer) };
        sourcesRef.current.set(src.id, src);
        setSrcVersion((v) => v + 1);
        updateClip(c.id, { sourceId: src.id, name });
        notify('Stimme optimiert', 'success');
      } catch (err) {
        notify(`Speichern fehlgeschlagen: ${err.message}`, 'error');
      }
    },
    [selection, updateClip, notify],
  );

  const clipActions = useMemo(
    () => ({
      split: () => splitAt(),
      trimSilence,
      crossfade: () => crossfade(3),
      duplicate: duplicateClip,
      remove: deleteSelection,
      toLibrary: clipToLibrary,
      optimize: openVoiceFx,
      voice: () => selection?.type === 'clip' && setVoiceTarget({ mode: 'clip' }),
      reverse: () => {
        // alle ausgewählten Clips umschalten (Richtung des angeklickten Clips gibt den neuen Wert vor)
        const ids = new Set(selectedClipIds(selection));
        const primary = docRef.current.clips.find((c) => c.id === selection?.id);
        if (!primary) return;
        const reversed = !primary.reversed;
        set((d) => ({ ...d, clips: d.clips.map((c) => (ids.has(c.id) ? { ...c, reversed } : c)) }));
      },
      fx: () => selection?.type === 'clip' && setDialog('fx'),
    }),
    [splitAt, trimSilence, crossfade, duplicateClip, deleteSelection, clipToLibrary, openVoiceFx, selection],
  );

  /** Daten für den Stimmen-Dialog (Clip- oder Spur-Modus). */
  const sampleOf = (c) => {
    if (!c) return null;
    const src = sourcesRef.current.get(c.voiceFrom?.sourceId ?? c.sourceId);
    if (!src?.buffer) return null;
    return { buffer: src.buffer, offset: c.voiceFrom ? c.voiceFrom.offset + c.offset : c.offset, duration: c.duration, gain: c.gain };
  };
  const renderVoiceDialog = () => {
    if (voiceTarget.mode === 'clip') {
      if (!selectedClip) return null;
      const ids = selectedClipIds(selection);
      return (
        <VoiceDialog
          mode="clip"
          title={`Stimme verwandeln – ${ids.length > 1 ? `${ids.length} Clips` : selectedClip.name}`}
          initial={selectedClip.voice}
          sample={sampleOf(selectedClip)}
          onApply={(settings) => applyVoice(ids, settings)}
          onRemove={selectedClip.voice ? () => applyVoice(ids, null) : undefined}
          onClose={() => setVoiceTarget(null)}
        />
      );
    }
    const track = doc.tracks.find((t) => t.id === voiceTarget.trackId);
    if (!track) return null;
    const trackClips = doc.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
    return (
      <VoiceDialog
        mode="track"
        title={`Sprecher-Spur „${track.name}“`}
        initial={track.voice}
        sample={sampleOf(trackClips[0])}
        trackClipCount={trackClips.length}
        onApply={async (settings, applyExisting) => {
          set((d) => ({ ...d, tracks: d.tracks.map((t) => (t.id === track.id ? { ...t, voice: settings } : t)) }));
          if (applyExisting && trackClips.length) await applyVoice(trackClips.map((c) => c.id), settings, false);
          notify(`Spur „${track.name}“ spricht jetzt als „${settings.label}“`, 'success');
        }}
        onRemove={track.voice ? () => set((d) => ({ ...d, tracks: d.tracks.map((t) => (t.id === track.id ? { ...t, voice: undefined } : t)) })) : undefined}
        onClose={() => setVoiceTarget(null)}
      />
    );
  };

  const ytDefaultTrack =
    doc.tracks.find((t) => t.id === selectedTrackId && !t.duck)?.id || doc.tracks.find((t) => !t.duck)?.id || doc.tracks[0]?.id;

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        title={projectPath ? basename(projectPath) : doc.title}
        total={total}
        playing={playing}
        recording={recording}
        canUndo={canUndo}
        canRedo={canRedo}
        magnet={magnet}
        masterVolume={doc.masterVolume ?? 1}
        hasSelection={!!selection}
        onNew={newProject}
        onToStart={() => seek(0)}
        onTogglePlay={recording ? stopRecording : togglePlay}
        onStop={() => {
          if (recRef.current) stopRecording();
          else {
            stopPlayback();
            seek(0);
          }
        }}
        onToggleRecord={toggleRecord}
        onImport={importDialog}
        onYoutube={() => setDialog('youtube')}
        onAddMarker={() => addMarker()}
        onSplit={() => splitAt()}
        onDelete={deleteSelection}
        onToggleMagnet={() => setMagnet((m) => !m)}
        onUndo={undo}
        onRedo={redo}
        onZoom={applyZoom}
        onMasterVolume={(v) => updateDoc({ masterVolume: v }, false)}
        onOpen={openProject}
        onSave={() => saveProject(false)}
        onExport={() => setDialog('export')}
        onJCard={() => setDialog('jcard')}
      />

      <Timeline
        doc={doc}
        docRef={docRef}
        sources={sourcesRef.current}
        srcVersion={srcVersion}
        zoom={zoom}
        setZoom={setZoom}
        selection={selection}
        selectedTrackId={selectedTrackId}
        recordingTrackId={recording?.trackId}
        magnet={magnet}
        playing={playing}
        scrollRef={scrollRef}
        set={set}
        commitFrom={commitFrom}
        onSelect={setSelection}
        onSelectTrack={setSelectedTrackId}
        onSeek={seek}
        onAddMarker={addMarker}
        onDropFiles={onDropFiles}
        onDropSound={insertSound}
        onTrackVoice={(trackId) => setVoiceTarget({ mode: 'track', trackId })}
        onTrackChange={updateTrack}
        onDeleteTrack={deleteTrack}
        onCloseGaps={closeGaps}
        onAddTrack={addTrack}
        onBeginEdit={beginEdit}
        onEndEdit={endEdit}
        onImport={importDialog}
        onRecord={startRecording}
        onYoutube={() => setDialog('youtube')}
        onOpenProject={openProject}
        recentProjects={recentProjects}
        showStart={!startDismissed}
        onDismissStart={() => setStartDismissed(true)}
      />

      <div className="relative shrink-0 border-t border-ink-700 flex min-h-0" style={{ height: bottomH }}>
      <ResizeHandle
        direction="y"
        value={bottomH}
        onChange={(h) => setBottomH(clamp(h, 150, Math.round(window.innerHeight * 0.65)))}
        className="absolute -top-1 left-0 right-0 h-2 z-30 cursor-ns-resize"
        title="Höhe ziehen"
      />
      <Inspector
        doc={doc}
        selection={selection}
        sources={sourcesRef.current}
        onClipChange={updateClip}
        onMarkerChange={updateMarker}
        onDocChange={updateDoc}
        onDelete={deleteSelection}
        onRehearse={(m) => setPrompter({ text: m.note || '', mode: 'rehearse' })}
        onRecordText={recordMarkerText}
        onBeginEdit={beginEdit}
        onEndEdit={endEdit}
        clipActions={clipActions}
        selCount={selectedClipIds(selection).length}
        recSettings={recSettings}
        setRecSettings={setRecSettings}
      />
      <SoundLibrary
        width={libraryW}
        onResize={(w) => setLibraryW(clamp(w, 300, Math.round(window.innerWidth * 0.6)))}
        items={library}
        previewId={previewId}
        collapsed={libraryCollapsed}
        onToggle={toggleLibrary}
        onPreview={togglePreview}
        onRename={(id, name) => storeLibrary(libraryRef.current.map((i) => (i.id === id ? { ...i, name } : i)))}
        onRemove={(id) => {
          if (previewId === id) stopPreview();
          storeLibrary(libraryRef.current.filter((i) => i.id !== id));
        }}
        onAddFiles={(files) => addToLibrary(files.map((f) => ({ path: window.api.getPathForFile(f), name: f.name })))}
        onAddDialog={async () => {
          const paths = await window.api.openAudioDialog();
          if (paths.length) addToLibrary(paths.map((p) => ({ path: p, name: basename(p) })));
        }}
      />
      </div>

      {dialog === 'youtube' && (
        <YouTubeDialog tracks={doc.tracks} defaultTrackId={ytDefaultTrack} onClose={() => setDialog(null)} onImported={onYoutubeImported} />
      )}
      {dialog === 'export' && <ExportDialog doc={doc} sources={sourcesRef.current} onClose={() => setDialog(null)} />}
      {dialog === 'jcard' && <JCardDialog doc={doc} onClose={() => setDialog(null)} />}
      {voiceTarget && renderVoiceDialog()}
      {dialog === 'fx' && selectedClip && (
        <FxDialog
          clip={selectedClip}
          sources={sourcesRef.current}
          onApply={({ echo, reverb }) => {
            // auf alle ausgewählten Clips anwenden
            const ids = new Set(selectedClipIds(selection));
            set((d) => ({ ...d, clips: d.clips.map((c) => (ids.has(c.id) ? { ...c, echo, reverb } : c)) }));
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'voicefx' && selectedClip && sourcesRef.current.get(selectedClip.sourceId)?.buffer && (
        <VoiceFxDialog
          clip={selectedClip}
          source={sourcesRef.current.get(selectedClip.sourceId)}
          onApply={applyVoiceFx}
          onClose={() => setDialog(null)}
        />
      )}

      {prompter && (
        <Prompter
          key={prompter.text + prompter.mode}
          text={prompter.text}
          mode={prompter.mode}
          wpm={recSettings.wpm}
          onWpmStep={(d) => setRecSettings((s) => ({ ...s, wpm: clamp(s.wpm + d, 60, 260) }))}
          onClose={() => setPrompter(null)}
        />
      )}

      {busy && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center">
          <div className="rounded-xl bg-ink-850 border border-ink-700 px-5 py-4 flex items-center gap-3 text-sm shadow-2xl">
            <LoaderCircle size={18} className="animate-spin text-tape-400" /> {busy}
          </div>
        </div>
      )}

      {toast && (
        <div
          key={toast.id}
          className={`fixed bottom-48 right-5 z-[70] max-w-md rounded-xl px-4 py-3 text-sm shadow-2xl border flex items-start gap-2 ${
            toast.kind === 'error'
              ? 'bg-red-950/95 border-red-500/40 text-red-200'
              : toast.kind === 'success'
                ? 'bg-emerald-950/95 border-emerald-500/40 text-emerald-200'
                : 'bg-ink-800 border-ink-600 text-ink-200'
          }`}
        >
          {toast.kind === 'error' ? (
            <TriangleAlert size={16} className="shrink-0 mt-0.5" />
          ) : toast.kind === 'success' ? (
            <Check size={16} className="shrink-0 mt-0.5" />
          ) : (
            <Info size={16} className="shrink-0 mt-0.5" />
          )}
          {toast.text}
        </div>
      )}
    </div>
  );
}
