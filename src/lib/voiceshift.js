/**
 * Stimmen-Verwandlung (läuft im Web Worker, reines JavaScript ohne Web-Audio-API):
 *  1. Tonhöhe: WSOLA-Zeitdehnung + Umrechnung → Tonhöhe ändert sich, Tempo bleibt
 *  2. Klangfarbe: LPC-Analyse/-Synthese mit verzerrter Hüllkurve → Formanten unabhängig verschieben
 *     (korrigiert auch die Formant-Verschiebung aus Schritt 1, damit es nicht nach Micky Maus klingt)
 *  3. Charakter-Effekte: Vibrato, Roboter, Alien, Helligkeit, Wärme
 */

export const VOICE_CHARACTERS = {
  kind: { label: 'Kind', pitch: 5, formant: 3.5, bright: 0.3 },
  tief: { label: 'Tiefe Stimme', pitch: -4, formant: -2, warm: 0.5 },
  riese: { label: 'Riese', pitch: -8, formant: -4.5, warm: 0.6, bright: -0.3 },
  oma: { label: 'Oma', pitch: 2.5, formant: 1, vibrato: 0.6, bright: -0.2 },
  opa: { label: 'Opa', pitch: -2.5, formant: -1, vibrato: 0.5, bright: -0.3 },
  roboter: { label: 'Roboter', pitch: 0, formant: 0, robot: 1 },
  alien: { label: 'Alien', pitch: 3, formant: -2.5, alien: 1 },
  micky: { label: 'Micky Maus', pitch: 8, formant: 8, bright: 0.2 },
};

export const VOICE_DEFAULTS = { pitch: 0, formant: 0, vibrato: 0, robot: 0, alien: 0, bright: 0, warm: 0 };

const TWO_PI = Math.PI * 2;

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / n);
  return w;
}

/* ------------------------------------------------------------------ */
/* Tonhöhe                                                             */
/* ------------------------------------------------------------------ */

/** WSOLA: dehnt auf ≈ factor-fache Länge, ohne die Tonhöhe zu ändern. */
export function wsolaStretch(x, sr, factor) {
  if (Math.abs(factor - 1) < 1e-3) return x.slice();
  const W = Math.round(sr * 0.04) & ~1;
  const Hs = W / 2;
  const Ha = Hs / factor;
  const tol = Math.round(sr * 0.012);
  const L = Math.round(W / 3);
  const win = hann(W);
  const outLen = Math.ceil(x.length * factor);
  const out = new Float32Array(outLen + W);
  const norm = new Float32Array(outLen + W);
  let prev = 0;
  for (let k = 0; ; k++) {
    const outPos = k * Hs;
    const nominal = Math.round(k * Ha);
    if (outPos >= outLen || nominal >= x.length) break;
    let start = Math.min(nominal, Math.max(0, x.length - W));
    if (k > 0) {
      // Abschnitt wählen, der am besten an die natürliche Fortsetzung des vorherigen anschließt
      const nat = prev + Hs;
      const lo = Math.max(0, nominal - tol);
      const hi = Math.min(x.length - W, nominal + tol);
      if (nat + L < x.length && hi >= lo) {
        let best = -Infinity;
        for (let c = lo; c <= hi; c += 2) {
          let s = 0;
          for (let j = 0; j < L; j += 3) s += x[nat + j] * x[c + j];
          if (s > best) {
            best = s;
            start = c;
          }
        }
      }
    }
    for (let j = 0; j < W; j++) {
      const xi = start + j;
      if (xi >= x.length) break;
      out[outPos + j] += x[xi] * win[j];
      norm[outPos + j] += win[j];
    }
    prev = start;
  }
  for (let i = 0; i < outLen; i++) if (norm[i] > 1e-3) out[i] /= norm[i];
  return out.subarray(0, outLen);
}

/** Liest x mit Schrittweite `step` (kubische Interpolation). */
function resample(x, step, outLen) {
  const out = new Float32Array(outLen);
  const n = x.length;
  const at = (i) => x[i < 0 ? 0 : i >= n ? n - 1 : i];
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const i1 = Math.floor(pos);
    const t = pos - i1;
    const y0 = at(i1 - 1);
    const y1 = at(i1);
    const y2 = at(i1 + 1);
    const y3 = at(i1 + 2);
    const a = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
    const b = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c = -0.5 * y0 + 0.5 * y2;
    out[i] = ((a * t + b) * t + c) * t + y1;
  }
  return out;
}

/** Tonhöhe um `semis` Halbtöne verschieben, Länge bleibt (Formanten wandern mit). */
export function pitchShift(x, sr, semis) {
  const r = Math.pow(2, semis / 12);
  const stretched = wsolaStretch(x, sr, r);
  return resample(stretched, r, x.length);
}

/* ------------------------------------------------------------------ */
/* Klangfarbe (Formanten) per LPC                                       */
/* ------------------------------------------------------------------ */

function levinson(r, p) {
  const a = new Float64Array(p + 1);
  const tmp = new Float64Array(p + 1);
  a[0] = 1;
  let e = r[0];
  if (!(e > 0)) return a;
  for (let i = 1; i <= p; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / e;
    tmp.set(a);
    for (let j = 1; j < i; j++) a[j] = tmp[j] + k * tmp[i - j];
    a[i] = k;
    e *= 1 - k * k;
    if (!(e > 1e-12)) break;
  }
  return a;
}

/**
 * Verschiebt die Formanten um den Faktor `phi` (>1 = „kleiner Körper“, <1 = „großer Körper“),
 * die Tonhöhe (Anregung) bleibt unverändert.
 */
export function formantWarp(x, sr, phi) {
  const n = x.length;
  const p = Math.min(48, Math.round(sr / 1000) + 4);
  const hop = Math.round(sr * 0.005);
  const W = hop * 4;
  const win = hann(W);
  const K = 128;
  const frames = Math.ceil(n / hop) + 1;

  // Kosinus-/Sinus-Tabellen für Hüllkurve und Autokorrelation
  const cosT = [];
  const sinT = [];
  const wk = new Float64Array(K);
  for (let k = 0; k < K; k++) wk[k] = (Math.PI * k) / (K - 1);
  for (let m = 0; m <= p; m++) {
    const c = new Float64Array(K);
    const s = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      c[k] = Math.cos(m * wk[k]);
      s[k] = Math.sin(m * wk[k]);
    }
    cosT.push(c);
    sinT.push(s);
  }

  const A = [];
  const B = [];
  const seg = new Float64Array(W);
  const r = new Float64Array(p + 1);
  const P = new Float64Array(K);
  const P2 = new Float64Array(K);
  for (let f = 0; f < frames; f++) {
    const s0 = f * hop - W / 2;
    for (let j = 0; j < W; j++) {
      const xi = s0 + j;
      seg[j] = xi >= 0 && xi < n ? x[xi] * win[j] : 0;
    }
    for (let m = 0; m <= p; m++) {
      let acc = 0;
      for (let j = m; j < W; j++) acc += seg[j] * seg[j - m];
      r[m] = acc;
    }
    r[0] = r[0] * 1.0001 + 1e-10; // leichte Regularisierung
    const a = levinson(r, p);
    // Hüllkurve |1/A(e^jw)|² …
    for (let k = 0; k < K; k++) {
      let re = 0;
      let im = 0;
      for (let j = 0; j <= p; j++) {
        re += a[j] * cosT[j][k];
        im -= a[j] * sinT[j][k];
      }
      P[k] = 1 / (re * re + im * im + 1e-12);
    }
    // … auf der Frequenzachse stauchen/dehnen: P'(w) = P(w / phi)
    for (let k = 0; k < K; k++) {
      const idx = (k / phi);
      if (idx >= K - 1) P2[k] = P[K - 1];
      else {
        const i0 = Math.floor(idx);
        const t = idx - i0;
        P2[k] = P[i0] * (1 - t) + P[i0 + 1] * t;
      }
    }
    // zurück in eine (stabile) Allpol-Darstellung über die Autokorrelation
    const r2 = new Float64Array(p + 1);
    for (let m = 0; m <= p; m++) {
      let acc = 0;
      for (let k = 0; k < K; k++) acc += (k === 0 || k === K - 1 ? 0.5 : 1) * P2[k] * cosT[m][k];
      r2[m] = acc;
    }
    r2[0] *= 1.0001;
    A.push(a);
    B.push(levinson(r2, p));
  }

  // Anregung (Restsignal) mit der Original-Hüllkurve gewinnen, mit der neuen wieder einfärben
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const f = Math.min(frames - 1, Math.floor(i / hop + 0.5));
    const a = A[f];
    const b = B[f];
    let e = x[i];
    for (let j = 1; j <= p && j <= i; j++) e += a[j] * x[i - j];
    let v = e;
    for (let j = 1; j <= p && j <= i; j++) v -= b[j] * y[i - j];
    if (!Number.isFinite(v) || Math.abs(v) > 50) v = 0; // Sicherheitsnetz
    y[i] = v;
  }

  // Lautstärkeverlauf an das Original angleichen (die neue Hüllkurve hat eine andere Verstärkung)
  const out = new Float32Array(n);
  const att = Math.exp(-1 / (0.01 * sr));
  const rel = Math.exp(-1 / (0.06 * sr));
  let ex = 0;
  let ey = 0;
  let g = 1;
  const gs = Math.exp(-1 / (0.02 * sr));
  for (let i = 0; i < n; i++) {
    const ax = Math.abs(x[i]);
    const ay = Math.abs(y[i]);
    ex = (ax > ex ? att : rel) * ex + (1 - (ax > ex ? att : rel)) * ax;
    ey = (ay > ey ? att : rel) * ey + (1 - (ay > ey ? att : rel)) * ay;
    const tg = ey > 1e-6 ? Math.min(10, Math.max(0.1, ex / ey)) : 1;
    g = gs * g + (1 - gs) * tg;
    out[i] = y[i] * g;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Charakter-Effekte                                                   */
/* ------------------------------------------------------------------ */

function vibrato(x, sr, amount) {
  // leicht zittrige Stimme: modulierte Verzögerung (Tonhöhe) + etwas Lautstärke-Schwankung
  const n = x.length;
  const out = new Float32Array(n);
  const base = Math.round(sr * 0.004);
  const depth = sr * 0.0007 * amount;
  const rate = 5.5;
  for (let i = 0; i < n; i++) {
    const ph = (TWO_PI * rate * i) / sr;
    const d = base + depth * Math.sin(ph);
    const pos = i - d;
    const i0 = Math.floor(pos);
    const t = pos - i0;
    const a = i0 >= 0 && i0 < n ? x[i0] : 0;
    const b = i0 + 1 >= 0 && i0 + 1 < n ? x[i0 + 1] : 0;
    out[i] = (a * (1 - t) + b * t) * (1 - 0.12 * amount * (0.5 + 0.5 * Math.sin(ph * 0.9)));
  }
  // Verzögerung ausgleichen
  return out.copyWithin(0, base).fill(0, n - base);
}

function robot(x, sr, amount) {
  // Ringmodulation + kurzer metallischer Kammfilter
  const n = x.length;
  const out = new Float32Array(n);
  const d = Math.round(sr * 0.009);
  for (let i = 0; i < n; i++) {
    const rm = x[i] * Math.sin((TWO_PI * 55 * i) / sr);
    let v = x[i] * (1 - amount) + rm * amount * 1.4;
    if (i >= d) v += out[i - d] * 0.45 * amount;
    out[i] = v;
  }
  return out;
}

function alien(x, sr, amount) {
  // schwebender Flanger + leichte hohe Ringmodulation
  const n = x.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = sr * (0.0025 + 0.0018 * Math.sin((TWO_PI * 0.35 * i) / sr));
    const pos = i - d;
    const i0 = Math.floor(pos);
    const t = pos - i0;
    const del = i0 >= 0 ? x[i0] * (1 - t) + (i0 + 1 < n ? x[i0 + 1] : 0) * t : 0;
    const ring = x[i] * Math.sin((TWO_PI * 420 * i) / sr);
    out[i] = x[i] + amount * (0.7 * del + 0.35 * ring);
  }
  return out;
}

/** RBJ-Biquad (Shelving), in place. */
function shelf(x, sr, type, f0, gainDb) {
  if (!gainDb) return;
  const A = Math.pow(10, gainDb / 40);
  const w0 = (TWO_PI * f0) / sr;
  const cs = Math.cos(w0);
  const alpha = Math.sin(w0) / 2 / Math.SQRT1_2;
  const sq = 2 * Math.sqrt(A) * alpha;
  let b0, b1, b2, a0, a1, a2;
  if (type === 'low') {
    b0 = A * (A + 1 - (A - 1) * cs + sq);
    b1 = 2 * A * (A - 1 - (A + 1) * cs);
    b2 = A * (A + 1 - (A - 1) * cs - sq);
    a0 = A + 1 + (A - 1) * cs + sq;
    a1 = -2 * (A - 1 + (A + 1) * cs);
    a2 = A + 1 + (A - 1) * cs - sq;
  } else {
    b0 = A * (A + 1 + (A - 1) * cs + sq);
    b1 = -2 * A * (A - 1 + (A + 1) * cs);
    b2 = A * (A + 1 + (A - 1) * cs - sq);
    a0 = A + 1 - (A - 1) * cs + sq;
    a1 = 2 * (A - 1 - (A + 1) * cs);
    a2 = A + 1 - (A - 1) * cs - sq;
  }
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    x[i] = y0;
  }
}

function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

/** Kompletter Ablauf für ein Mono-Signal. */
export function transformVoice(x, sr, settings) {
  const o = { ...VOICE_DEFAULTS, ...settings };
  let y = x;
  const r = Math.pow(2, o.pitch / 12);
  const phi = Math.pow(2, o.formant / 12);
  if (o.pitch) y = pitchShift(y, sr, o.pitch);
  // Nach der Tonhöhenänderung liegen die Formanten bei ×r → auf das gewünschte ×phi korrigieren
  const warp = phi / r;
  if (Math.abs(warp - 1) > 0.01) y = formantWarp(y, sr, warp);
  if (o.vibrato > 0) y = vibrato(y, sr, o.vibrato);
  if (o.robot > 0) y = robot(y, sr, o.robot);
  if (o.alien > 0) y = alien(y, sr, o.alien);
  if (y === x) y = x.slice();
  shelf(y, sr, 'high', 3000, 6 * o.bright);
  shelf(y, sr, 'low', 200, 5 * o.warm);
  // Gesamtlautstärke wie im Original, Spitzen begrenzen
  const g = rms(x) / (rms(y) || 1);
  let peak = 0;
  for (let i = 0; i < y.length; i++) {
    y[i] *= g;
    const a = Math.abs(y[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0.97) for (let i = 0; i < y.length; i++) y[i] *= 0.97 / peak;
  return y;
}
