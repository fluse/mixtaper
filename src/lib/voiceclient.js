/** Schnittstelle zum Stimmen-Worker plus Hilfen für Mono-Ausschnitte. */

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./voice.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (!p) return;
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.data);
    };
  }
  return worker;
}

/** Mono-Signal verwandeln (im Hintergrund-Thread). */
export function transformVoiceAsync(mono, sampleRate, settings) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    const copy = mono.slice();
    getWorker().postMessage({ id, data: copy, sampleRate, settings }, [copy.buffer]);
  });
}

/** Ausschnitt eines Puffers als Mono-Signal. */
export function regionMono(buffer, offset, duration) {
  const sr = buffer.sampleRate;
  const a = Math.max(0, Math.floor(offset * sr));
  const z = Math.min(buffer.length, a + Math.max(1, Math.round(duration * sr)));
  const out = new Float32Array(z - a);
  const nch = buffer.numberOfChannels;
  for (let c = 0; c < nch; c++) {
    const d = buffer.getChannelData(c);
    for (let i = a; i < z; i++) out[i - a] += d[i] / nch;
  }
  return out;
}

export function monoToBuffer(data, sampleRate) {
  const buf = new AudioBuffer({ numberOfChannels: 1, length: Math.max(1, data.length), sampleRate });
  buf.copyToChannel(data, 0);
  return buf;
}
