/**
 * Sprach-Optimierung für Aufnahmen: Rumpelfilter, Klarheits-EQ, Wärme, Hall-/Raumreduktion (Expander),
 * Kompressor, De-Esser, Sättigung und Lautstärke-Angleichung. Arbeitet offline auf einem AudioBuffer.
 */

const BASE = { highpass: true, clarity: 1, warmth: 0, dereverb: 0.5, compress: 0.35, deess: 0, saturate: 0, vintage: false, normalize: true, target: -18 };

export const VOICE_PRESETS = {
  radio: { ...BASE, label: 'Radio', clarity: 1.3, warmth: 0.7, dereverb: 0.6, compress: 0.85, deess: 0.6, saturate: 0.35, target: -15 },
  standard: { ...BASE, label: 'Standard', clarity: 1, dereverb: 0.65, compress: 0.35 },
  sanft: { ...BASE, label: 'Sanft', clarity: 0.5, dereverb: 0.4, compress: 0.2 },
  kraeftig: { ...BASE, label: 'Kräftig', clarity: 1.4, dereverb: 0.95, compress: 0.55, deess: 0.3 },
  altradio: { ...BASE, label: 'Altes Radio', clarity: 0.4, vintage: true, dereverb: 0.5, compress: 0.8, saturate: 0.7, target: -16 },
};

const db = (x) => 20 * Math.log10(x + 1e-9);

async function render(buffer, build) {
  const oc = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const src = oc.createBufferSource();
  src.buffer = buffer;
  build(oc, src).connect(oc.destination);
  src.start();
  return oc.startRendering();
}

/** Filterkette: Hochpass + Klarheits-EQ. */
function filterChain(oc, src, o) {
  let node = src;
  const add = (n) => {
    node.connect(n);
    node = n;
  };
  const filt = (type, freq, q, gain = 0) => {
    const f = oc.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.gain.value = gain;
    add(f);
  };
  if (o.vintage) {
    // Altes Radio / Transistor: schmales Band, etwas „Nase“ in den Mitten
    filt('highpass', 380, 0.9);
    filt('highpass', 380, 0.9);
    filt('lowpass', 3200, 0.9);
    filt('lowpass', 3200, 0.9);
    filt('peaking', 1400, 1.2, 4);
  }
  if (o.warmth > 0) filt('lowshelf', 140, 0.7, 5 * o.warmth); // Nahbesprechungs-Wärme
  if (o.highpass) {
    const hp = oc.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 85;
    hp.Q.value = 0.7;
    add(hp);
  }
  if (o.clarity > 0) {
    const mud = oc.createBiquadFilter();
    mud.type = 'peaking';
    mud.frequency.value = 280;
    mud.Q.value = 1;
    mud.gain.value = -3 * o.clarity;
    add(mud);
    const presence = oc.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3500;
    presence.Q.value = 0.8;
    presence.gain.value = 3 * o.clarity;
    add(presence);
    const air = oc.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 9000;
    air.gain.value = 1.5 * o.clarity;
    add(air);
  }
  return node;
}

function channels(buffer) {
  const out = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c));
  return out;
}

/** Hüllkurve (Spitzenwert über alle Kanäle) mit einstellbarem Anstieg/Abfall in Sekunden. */
function envelope(chs, sr, attack, release) {
  const n = chs[0].length;
  const env = new Float32Array(n);
  const att = Math.exp(-1 / (attack * sr));
  const rel = Math.exp(-1 / (release * sr));
  let e = 0;
  for (let i = 0; i < n; i++) {
    let x = 0;
    for (const d of chs) {
      const v = d[i] < 0 ? -d[i] : d[i];
      if (v > x) x = v;
    }
    const k = x > e ? att : rel;
    e = k * e + (1 - k) * x;
    env[i] = e;
  }
  return env;
}

function quantiles(env, sr, qs) {
  const step = Math.max(1, Math.floor(sr * 0.01));
  const vals = [];
  for (let i = 0; i < env.length; i += step) vals.push(env[i]);
  vals.sort((a, b) => a - b);
  return qs.map((q) => vals[Math.min(vals.length - 1, Math.floor(q * vals.length))] || 0);
}

/**
 * Kompressor ohne Latenz und ohne automatische Verstärkung (die übernimmt `normalize`).
 * Schwelle relativ zum Sprachpegel, damit es unabhängig vom Aufnahmepegel gleich wirkt.
 */
function compress(buffer, amount) {
  const sr = buffer.sampleRate;
  const chs = channels(buffer);
  const env = envelope(chs, sr, 0.005, 0.15);
  const [speech] = quantiles(env, sr, [0.9]);
  if (speech <= 0) return;
  const thr = db(speech) - (4 + 10 * amount);
  const ratio = 2 + 4 * amount;
  const knee = 6;
  const slope = 1 / ratio - 1;
  const n = env.length;
  const gain = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const over = db(env[i]) - thr;
    let gr = 0;
    if (over >= knee / 2) gr = slope * over;
    else if (over > -knee / 2) gr = (slope * (over + knee / 2) ** 2) / (2 * knee);
    gain[i] = Math.pow(10, gr / 20);
  }
  // Vorausschau: Absenkung greift schon kurz vor einer Spitze
  const look = Math.floor(0.005 * sr);
  for (let i = 0; i < n; i++) {
    const g = Math.min(gain[i], gain[Math.min(n - 1, i + look)]);
    if (g < 1) for (const d of chs) d[i] *= g;
  }
}

/**
 * Abwärts-Expander: senkt alles deutlich unter dem Sprachpegel ab –
 * also Raumhall-Ausklänge und Rauschen zwischen Wörtern.
 * Mit 10 ms Vorausschau, damit Wortanfänge nicht verschluckt werden.
 */
function expanderGain(buffer, amount) {
  const sr = buffer.sampleRate;
  const chs = channels(buffer);
  const env = envelope(chs, sr, 0.002, 0.02);
  const [floor, speech] = quantiles(env, sr, [0.15, 0.9]);
  if (speech <= 0) return null;
  const floorDb = db(floor);
  const speechDb = db(speech);
  if (speechDb - floorDb < 6) return null; // kaum Unterschied zwischen Sprache und Pause
  const thr = floorDb + (speechDb - floorDb) * (0.45 + 0.4 * amount);
  const ratio = 1.5 + 3.5 * amount;
  const maxCut = 6 + 24 * amount;
  const open = Math.exp(-1 / (0.001 * sr));
  const close = Math.exp(-1 / ((0.06 - 0.035 * amount) * sr)); // stärker = schneller zu

  const n = env.length;
  const gain = new Float32Array(n);
  let g = 1;
  for (let i = 0; i < n; i++) {
    const lev = db(env[i]);
    const tDb = lev >= thr ? 0 : Math.max(-maxCut, (lev - thr) * (ratio - 1));
    const tg = Math.pow(10, tDb / 20);
    const k = tg > g ? open : close;
    g = k * g + (1 - k) * tg;
    gain[i] = g;
  }
  // Vorausschau: früher öffnen (Maximum aus jetzt und +10 ms), Schließen bleibt zeitrichtig
  const look = Math.floor(0.01 * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(gain[i], gain[Math.min(n - 1, i + look)]);
  return out;
}

function applyGain(buffer, gain) {
  for (const d of channels(buffer)) for (let i = 0; i < d.length; i++) d[i] *= gain[i];
}

/**
 * De-Esser: senkt nur das Band über ~5 kHz ab, wenn es im Verhältnis zur Stimme zu laut wird (S-, Z-, Sch-Laute).
 */
async function deess(buffer, amount) {
  const sr = buffer.sampleRate;
  const chain = (type, freq) => (oc, src) => {
    const a = oc.createBiquadFilter();
    a.type = type;
    a.frequency.value = freq;
    const b = oc.createBiquadFilter();
    b.type = type;
    b.frequency.value = freq;
    src.connect(a);
    a.connect(b);
    return b;
  };
  // Erkennung über steilen Hochpass; abgesenkt wird das phasenrichtige Gegenstück „Signal − Tiefpass“,
  // sonst würden sich die S-Laute wegen der Filter-Phasenverschiebung nur teilweise auslöschen.
  const det = await render(buffer, chain('highpass', 5500));
  const lp = await render(buffer, chain('lowpass', 4500));
  const chs = channels(buffer);
  const lps = channels(lp);
  const hbs = chs.map((d, c) => {
    const h = new Float32Array(d.length);
    for (let i = 0; i < d.length; i++) h[i] = d[i] - lps[c][i];
    return h;
  });
  const full = envelope(chs, sr, 0.001, 0.03);
  const high = envelope(channels(det), sr, 0.001, 0.03);
  const [speech] = quantiles(full, sr, [0.9]);
  const floorDb = db(speech) - 30;
  const thr = -9 + 6 * (1 - amount); // Abstand Hochton-Band zu Gesamtsignal, ab dem eingegriffen wird
  const maxCut = 4 + 10 * amount;
  const att = Math.exp(-1 / (0.001 * sr));
  const rel = Math.exp(-1 / (0.04 * sr));
  let g = 1;
  for (let i = 0; i < full.length; i++) {
    const hDb = db(high[i]);
    const over = hDb > floorDb ? hDb - db(full[i]) - thr : -1;
    const tg = over > 0 ? Math.pow(10, -Math.min(maxCut, over * 2) / 20) : 1;
    const k = tg < g ? att : rel;
    g = k * g + (1 - k) * tg;
    if (g < 0.999) for (let c = 0; c < chs.length; c++) chs[c][i] -= hbs[c][i] * (1 - g);
  }
}

/** Sanfte Sättigung (Röhren-/Bandcharakter): verdichtet und macht die Stimme „griffiger“. */
function saturate(buffer, amount) {
  const k = 1 + 3 * amount;
  const norm = 1 / Math.tanh(k);
  for (const d of channels(buffer)) for (let i = 0; i < d.length; i++) d[i] = Math.tanh(k * d[i]) * norm;
}

/** Sprachpegel auf ca. −18 dBFS (RMS der gesprochenen Teile), Spitzen höchstens −1 dBFS. */
function normalize(buffer, target = -18) {
  const sr = buffer.sampleRate;
  const chs = channels(buffer);
  const win = Math.floor(sr * 0.02);
  let sum = 0;
  let cnt = 0;
  let peak = 0;
  for (let i = 0; i < chs[0].length; i += win) {
    let s = 0;
    let c = 0;
    for (const d of chs) {
      for (let j = i; j < Math.min(i + win, d.length); j++) {
        s += d[j] * d[j];
        c++;
        const v = d[j] < 0 ? -d[j] : d[j];
        if (v > peak) peak = v;
      }
    }
    const rms = Math.sqrt(s / Math.max(1, c));
    if (db(rms) > -45) {
      sum += s;
      cnt += c;
    }
  }
  if (!cnt || peak <= 0) return;
  const rms = Math.sqrt(sum / cnt);
  const gain = Math.min(Math.pow(10, target / 20) / rms, 0.891 / peak);
  for (const d of chs) for (let i = 0; i < d.length; i++) d[i] *= gain;
}

export async function processVoice(buffer, o) {
  const out = await render(buffer, (oc, src) => filterChain(oc, src, o));
  // Expander analysiert das Signal vor dem Kompressor (der verkleinert den Abstand Sprache/Pause),
  // wird aber erst danach angewendet – sonst würde der Kompressor die Hallfahnen wieder anheben.
  const exp = o.dereverb > 0 ? expanderGain(out, o.dereverb) : null;
  if (o.compress > 0) compress(out, o.compress);
  if (o.deess > 0) await deess(out, o.deess); // nach dem Kompressor, der S-Laute mit anhebt
  if (exp) applyGain(out, exp);
  if (o.saturate > 0) {
    // vor der Sättigung auf einen definierten Pegel bringen, damit sie unabhängig von der Aufnahme wirkt
    normalize(out, -16);
    saturate(out, o.saturate);
  }
  if (o.normalize) normalize(out, o.target ?? -18);
  return out;
}

/** AudioBuffer → 16-Bit-WAV. */
export function encodeWav(buffer) {
  const nch = buffer.numberOfChannels;
  const n = buffer.length;
  const sr = buffer.sampleRate;
  const dataLen = n * nch * 2;
  const view = new DataView(new ArrayBuffer(44 + dataLen));
  const str = (o, s) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, nch, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * nch * 2, true);
  view.setUint16(32, nch * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, dataLen, true);
  const chs = channels(buffer);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const d of chs) {
      const s = Math.max(-1, Math.min(1, d[i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return view.buffer;
}
