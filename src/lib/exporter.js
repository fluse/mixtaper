import { buildGraph, fxTail, mixDuration } from './engine';
import { buildChapters } from './chapters';
import { buildId3 } from './id3';

const SAMPLE_RATE = 44100;
const CHUNK_SEC = 30;
const TARGET_PEAK = 0.891; // -1 dBFS

/** Rendert einen Abschnitt des Mixes offline (stückweise, damit lange Mixtapes nicht den Speicher sprengen). */
async function renderChunk(doc, sources, index, totalFrames, preroll) {
  const chunkFrames = CHUNK_SEC * SAMPLE_RATE;
  const startFrame = index * chunkFrames;
  const frames = Math.min(chunkFrames, totalFrames - startFrame);
  const from = startFrame / SAMPLE_RATE;
  // Vorlauf: Echos aus dem vorherigen Abschnitt klingen so korrekt weiter
  const pre = index === 0 ? 0 : Math.round(preroll * SAMPLE_RATE);
  const oc = new OfflineAudioContext(2, frames + pre, SAMPLE_RATE);
  const master = oc.createGain();
  master.gain.value = doc.masterVolume ?? 1;
  master.connect(oc.destination);
  buildGraph(oc, master, doc, sources, from - pre / SAMPLE_RATE, { when: 0, to: from + frames / SAMPLE_RATE });
  const buf = await oc.startRendering();
  if (!pre) return buf;
  return { numberOfChannels: buf.numberOfChannels, getChannelData: (c) => buf.getChannelData(c).subarray(pre) };
}

function peakOf(buf) {
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const v = d[i] < 0 ? -d[i] : d[i];
      if (v > peak) peak = v;
    }
  }
  return peak;
}

function wavHeader(totalFrames) {
  const dataLen = totalFrames * 4;
  const b = new DataView(new ArrayBuffer(44));
  const str = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  b.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, 2, true);
  b.setUint32(24, SAMPLE_RATE, true);
  b.setUint32(28, SAMPLE_RATE * 4, true);
  b.setUint16(32, 4, true);
  b.setUint16(34, 16, true);
  str(36, 'data');
  b.setUint32(40, dataLen, true);
  return new Uint8Array(b.buffer);
}

function interleave16(L, R) {
  const out = new Int16Array(L.length * 2);
  for (let i = 0; i < L.length; i++) {
    const l = Math.max(-1, Math.min(1, L[i]));
    const r = Math.max(-1, Math.min(1, R[i]));
    out[2 * i] = l < 0 ? l * 0x8000 : l * 0x7fff;
    out[2 * i + 1] = r < 0 ? r * 0x8000 : r * 0x7fff;
  }
  return new Uint8Array(out.buffer);
}

function createMp3Worker() {
  const worker = new Worker(new URL('./mp3.worker.js', import.meta.url), { type: 'module' });
  let seq = 0;
  const pending = new Map();
  worker.onmessage = (e) => {
    pending.get(e.data.id)?.(e.data.data);
    pending.delete(e.data.id);
  };
  const call = (msg, transfer = []) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      worker.postMessage({ ...msg, id }, transfer);
    });
  return { call, terminate: () => worker.terminate() };
}

/**
 * Exportiert den Mix als MP3 oder WAV direkt in eine Datei.
 * @param {object} opts { path, format: 'mp3'|'wav', kbps, normalize, chapters, onProgress(0..1, text), signal }
 */
export async function exportMix(doc, sources, opts) {
  const { path, format = 'mp3', kbps = 192, normalize = true, chapters = true, onProgress = () => {}, signal } = opts;
  const duration = mixDuration(doc);
  const preroll = Math.max(0, ...doc.clips.map(fxTail));
  if (duration <= 0) throw new Error('Das Mixtape ist noch leer.');
  const totalFrames = Math.ceil(duration * SAMPLE_RATE);
  const chunks = Math.ceil(totalFrames / (CHUNK_SEC * SAMPLE_RATE));
  const passes = normalize ? 2 : 1;
  const check = () => {
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
  };

  // Durchgang 1: Spitzenpegel bestimmen (Auspegeln)
  let scale = 1;
  if (normalize) {
    let peak = 0;
    for (let i = 0; i < chunks; i++) {
      check();
      const buf = await renderChunk(doc, sources, i, totalFrames, preroll);
      peak = Math.max(peak, peakOf(buf));
      onProgress((i + 1) / (chunks * passes), 'Analysiere Lautstärke …');
    }
    if (peak > 0) scale = TARGET_PEAK / peak;
  }

  const id = await window.api.streamOpen(path);
  const mp3 = format === 'mp3' ? createMp3Worker() : null;
  try {
    if (mp3) {
      const chaps = chapters ? buildChapters(doc) : [];
      await window.api.streamWrite(id, buildId3({ title: doc.title, artist: 'MixTape', album: doc.title, chapters: chaps }));
      await mp3.call({ type: 'init', sampleRate: SAMPLE_RATE, kbps });
    } else {
      await window.api.streamWrite(id, wavHeader(totalFrames));
    }

    for (let i = 0; i < chunks; i++) {
      check();
      const buf = await renderChunk(doc, sources, i, totalFrames, preroll);
      const L = buf.getChannelData(0).slice();
      const R = buf.getChannelData(1).slice();
      if (scale !== 1) {
        for (let j = 0; j < L.length; j++) {
          L[j] *= scale;
          R[j] *= scale;
        }
      }
      const data = mp3
        ? await mp3.call({ type: 'encode', left: L, right: R }, [L.buffer, R.buffer])
        : interleave16(L, R);
      if (data.length) await window.api.streamWrite(id, data);
      onProgress((chunks * (passes - 1) + i + 1) / (chunks * passes), mp3 ? 'Erzeuge MP3 …' : 'Erzeuge WAV …');
    }
    if (mp3) {
      const tail = await mp3.call({ type: 'flush' });
      if (tail.length) await window.api.streamWrite(id, tail);
    }
  } finally {
    mp3?.terminate();
    await window.api.streamClose(id);
  }
  return { path, duration };
}
