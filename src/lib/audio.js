let ctx = null;

export function getAudioContext() {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
  return ctx;
}

export async function decodeAudio(arrayBuffer) {
  // decodeAudioData löst den Buffer ab – Kopie, falls er noch gebraucht wird
  return getAudioContext().decodeAudioData(arrayBuffer.slice(0));
}

/** Auflösung der Wellenform-Daten (Werte pro Sekunde). */
export const PEAKS_PER_SEC = 200;

/** Maximalamplitude je Zeitfenster über alle Kanäle. */
export function computePeaks(buffer) {
  const n = Math.max(1, Math.ceil(buffer.duration * PEAKS_PER_SEC));
  const peaks = new Float32Array(n);
  const spp = buffer.sampleRate / PEAKS_PER_SEC;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const from = Math.floor(i * spp);
      const to = Math.min(data.length, Math.floor((i + 1) * spp));
      let max = peaks[i];
      for (let j = from; j < to; j++) {
        const v = data[j] < 0 ? -data[j] : data[j];
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
  }
  return peaks;
}

const reversedCache = new WeakMap();

/** Rückwärts-Version eines Puffers (einmal berechnet, danach aus dem Cache). */
export function reversedBuffer(buffer) {
  let rev = reversedCache.get(buffer);
  if (!rev) {
    rev = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length: buffer.length, sampleRate: buffer.sampleRate });
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = rev.getChannelData(ch);
      for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
    }
    reversedCache.set(buffer, rev);
  }
  return rev;
}

const reversedPeaksCache = new WeakMap();
export function reversedPeaks(peaks) {
  let rev = reversedPeaksCache.get(peaks);
  if (!rev) {
    rev = peaks.slice().reverse();
    reversedPeaksCache.set(peaks, rev);
  }
  return rev;
}

/**
 * Bei rückwärts laufenden Clips beschreibt `offset` weiterhin den Ausschnitt im Original.
 * Im umgedrehten Puffer liegt derselbe Ausschnitt bei `Länge − offset − duration`.
 */
export function playOffset(clip, bufferDuration) {
  return clip.reversed ? Math.max(0, bufferDuration - clip.offset - clip.duration) : clip.offset;
}

/** Grobe Wellenform (Werte 0–100) für Vorschauen, z. B. in der Sound-Liste. */
export function computeMiniWave(buffer, offset = 0, duration = buffer.duration - offset, n = 140) {
  const sr = buffer.sampleRate;
  const start = Math.floor(offset * sr);
  const len = Math.max(1, Math.floor(duration * sr));
  const per = len / n;
  const stride = Math.max(1, Math.floor(per / 400)); // nicht jedes Sample nötig
  const chans = [];
  for (let ch = 0; ch < Math.min(2, buffer.numberOfChannels); ch++) chans.push(buffer.getChannelData(ch));
  let max = 0;
  const raw = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const from = start + Math.floor(i * per);
    const to = Math.min(start + Math.floor((i + 1) * per), buffer.length);
    let peak = 0;
    for (const d of chans) {
      for (let j = from; j < to; j += stride) {
        const v = d[j] < 0 ? -d[j] : d[j];
        if (v > peak) peak = v;
      }
    }
    raw[i] = peak;
    if (peak > max) max = peak;
  }
  // auf den lautesten Punkt skalieren, damit auch leise Snippets gut erkennbar sind
  return raw.map((v) => Math.round((max > 0 ? v / max : 0) * 100));
}

/**
 * Findet Beginn und Ende des hörbaren Bereichs (z. B. für Sprachaufnahmen).
 * Gibt Sekunden relativ zum Puffer zurück, inkl. kleiner Sicherheitsreserve.
 */
export function detectSound(buffer, { threshold = 0.02, pad = 0.15, from = 0, to = buffer.duration } = {}) {
  const sr = buffer.sampleRate;
  const win = Math.floor(sr * 0.01); // 10 ms Fenster
  const start = Math.floor(from * sr);
  const end = Math.min(buffer.length, Math.floor(to * sr));
  const chans = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) chans.push(buffer.getChannelData(ch));

  const rms = (i) => {
    let sum = 0;
    let cnt = 0;
    for (const d of chans) {
      for (let j = i; j < Math.min(i + win, end); j++) {
        sum += d[j] * d[j];
        cnt++;
      }
    }
    return Math.sqrt(sum / Math.max(1, cnt));
  };

  let first = -1;
  for (let i = start; i < end; i += win) {
    if (rms(i) > threshold) {
      first = i;
      break;
    }
  }
  if (first < 0) return null; // nur Stille
  let last = first;
  for (let i = end - win; i > first; i -= win) {
    if (rms(i) > threshold) {
      last = i + win;
      break;
    }
  }
  return {
    start: Math.max(from, first / sr - pad),
    end: Math.min(to, last / sr + pad),
  };
}
