import { Mp3Encoder } from '@breezystack/lamejs';

let encoder = null;
const FRAME = 1152;

function toInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function concat(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

self.onmessage = (e) => {
  const { id, type } = e.data;
  if (type === 'init') {
    encoder = new Mp3Encoder(2, e.data.sampleRate, e.data.kbps);
    self.postMessage({ id, data: new Uint8Array(0) });
  } else if (type === 'encode') {
    const L = toInt16(e.data.left);
    const R = toInt16(e.data.right);
    const parts = [];
    for (let i = 0; i < L.length; i += FRAME) {
      const buf = encoder.encodeBuffer(L.subarray(i, i + FRAME), R.subarray(i, i + FRAME));
      if (buf.length) parts.push(new Uint8Array(buf));
    }
    const data = concat(parts);
    self.postMessage({ id, data }, [data.buffer]);
  } else if (type === 'flush') {
    const data = new Uint8Array(encoder.flush());
    self.postMessage({ id, data }, [data.buffer]);
  }
};
