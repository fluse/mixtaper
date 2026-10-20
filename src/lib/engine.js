import { getAudioContext } from './audio';
import { clipEnd, effectiveTrackGain } from './utils';

/* ------------------------------------------------------------------ */
/* Hüllkurven (stückweise linear)                                      */
/* ------------------------------------------------------------------ */

export function envelopeAt(points, t) {
  if (!points.length) return 1;
  if (t <= points[0].t) return points[0].v;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (t <= b.t) {
      if (b.t === a.t) return b.v;
      return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
    }
  }
  return points[points.length - 1].v;
}

/** Plant eine Hüllkurve auf einem AudioParam ab Projektzeit `from` (= Kontextzeit `when`). */
function applyEnvelope(param, points, from, when) {
  param.setValueAtTime(envelopeAt(points, from), when);
  for (const p of points) {
    if (p.t > from) param.linearRampToValueAtTime(p.v, when + (p.t - from));
  }
}

export function clipEnvelope(clip) {
  const g = clip.gain ?? 1;
  const dur = clip.duration;
  let fi = Math.max(0, clip.fadeIn || 0);
  let fo = Math.max(0, clip.fadeOut || 0);
  if (fi + fo > dur) {
    const k = dur / (fi + fo);
    fi *= k;
    fo *= k;
  }
  const s = clip.start;
  const e = s + dur;
  const pts = [];
  if (fi > 0) pts.push({ t: s, v: 0 }, { t: s + fi, v: g });
  else pts.push({ t: s, v: g });
  if (fo > 0) pts.push({ t: e - fo, v: g }, { t: e, v: 0 });
  else pts.push({ t: e, v: g });
  return pts;
}

const DUCK_ATTACK = 0.35;
const DUCK_RELEASE = 0.7;

/** Zeitbereiche, in denen „Sprach“-Spuren (duck=true) aktiv sind. */
export function duckIntervals(doc) {
  const duckTracks = new Set(
    doc.tracks.filter((t) => t.duck && effectiveTrackGain(t, doc.tracks) > 0).map((t) => t.id),
  );
  const raw = doc.clips
    .filter((c) => duckTracks.has(c.trackId))
    .map((c) => ({ s: c.start, e: clipEnd(c) }))
    .sort((a, b) => a.s - b.s);
  const merged = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && iv.s - DUCK_ATTACK <= last.e + DUCK_RELEASE) last.e = Math.max(last.e, iv.e);
    else merged.push({ ...iv });
  }
  return merged;
}

function duckEnvelope(intervals, depth) {
  const pts = [];
  for (const { s, e } of intervals) {
    pts.push({ t: s - DUCK_ATTACK, v: 1 }, { t: s, v: depth }, { t: e, v: depth }, { t: e + DUCK_RELEASE, v: 1 });
  }
  return pts;
}

/* ------------------------------------------------------------------ */
/* Echo                                                                */
/* ------------------------------------------------------------------ */

export const ECHO_PRESETS = {
  slapback: { label: 'Slapback', time: 0.12, feedback: 0.15, mix: 0.35, damp: 0.3 },
  echo: { label: 'Echo', time: 0.35, feedback: 0.4, mix: 0.4, damp: 0.4 },
  canyon: { label: 'Canyon', time: 0.6, feedback: 0.55, mix: 0.45, damp: 0.6 },
  dub: { label: 'Dub', time: 0.45, feedback: 0.7, mix: 0.5, damp: 0.75 },
};

/** Wie lange ein Echo nach Clip-Ende nachklingt (bis ca. −60 dB), max. 15 s. */
export function echoTail(echo) {
  if (!echo || !(echo.mix > 0)) return 0;
  const fb = Math.min(0.9, Math.max(0.01, echo.feedback));
  return Math.min(15, echo.time * (1 + Math.log(0.001) / Math.log(fb)));
}

/** Gesamtlänge inkl. nachklingender Echos (für den Export). */
export function mixDuration(doc) {
  let end = 0;
  for (const c of doc.clips) end = Math.max(end, clipEnd(c) + echoTail(c.echo));
  return end;
}

/* ------------------------------------------------------------------ */
/* Audio-Graph                                                         */
/* ------------------------------------------------------------------ */

/**
 * Baut den kompletten Mix ab Projektzeit `from` auf.
 * Kette: Clip → Clip-Gain (Fades) → Spur-Ducking → Spur-Lautstärke → dest
 */
export function buildGraph(actx, dest, doc, sources, from, { when = actx.currentTime, to = Infinity } = {}) {
  const trackVol = new Map();
  const nodes = [];
  const intervals = duckIntervals(doc);
  const duckPts = duckEnvelope(intervals, doc.duckDepth ?? 0.3);

  for (const t of doc.tracks) {
    const duck = actx.createGain();
    const vol = actx.createGain();
    vol.gain.value = effectiveTrackGain(t, doc.tracks);
    duck.connect(vol);
    vol.connect(dest);
    if (!t.duck && duckPts.length) applyEnvelope(duck.gain, duckPts, from, when);
    trackVol.set(t.id, { duck, vol });
    nodes.push(duck, vol);
  }

  const players = [];
  for (const clip of doc.clips) {
    const buffer = sources.get(clip.sourceId)?.buffer;
    const track = trackVol.get(clip.trackId);
    if (!buffer || !track) continue;
    const end = clipEnd(clip);
    if (end <= from || clip.start >= to) continue;

    const src = actx.createBufferSource();
    src.buffer = buffer;
    const g = actx.createGain();
    applyEnvelope(g.gain, clipEnvelope(clip), from, when);
    src.connect(g);
    g.connect(track.duck);

    // Echo: Verzögerung mit Rückkopplung und Dämpfung (Tiefpass) im Rückkopplungszweig
    const e = clip.echo;
    if (e && e.mix > 0) {
      const delay = actx.createDelay(2);
      delay.delayTime.value = Math.min(2, Math.max(0.01, e.time));
      const tone = actx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 1200 + (1 - (e.damp ?? 0.4)) * 12000;
      const fb = actx.createGain();
      fb.gain.value = Math.min(0.9, Math.max(0, e.feedback));
      const wet = actx.createGain();
      wet.gain.value = e.mix;
      g.connect(delay);
      delay.connect(tone);
      tone.connect(fb);
      fb.connect(delay);
      tone.connect(wet);
      wet.connect(track.duck);
      nodes.push(delay, tone, fb, wet);
    }

    const delay = Math.max(0, clip.start - from);
    const into = Math.max(0, from - clip.start);
    const dur = clip.duration - into;
    if (dur <= 0) continue;
    src.start(when + delay, clip.offset + into, dur);
    players.push(src);
    nodes.push(g);
  }

  return {
    trackVol,
    stop() {
      for (const p of players) {
        try {
          p.stop();
        } catch {
          /* bereits beendet */
        }
        p.disconnect();
      }
      for (const n of nodes) n.disconnect();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Echtzeit-Wiedergabe                                                 */
/* ------------------------------------------------------------------ */

export class Player {
  constructor() {
    this.ctx = getAudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.graph = null;
    this.playing = false;
    this.startPos = 0;
    this.ctxStart = 0;
    this.masterValue = 1;
    this.cue = 1;
  }

  async play(doc, sources, from) {
    this._stopGraph();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    const when = this.ctx.currentTime + 0.04;
    this.graph = buildGraph(this.ctx, this.master, doc, sources, from, { when });
    this.startPos = from;
    this.ctxStart = when;
    this.playing = true;
  }

  position() {
    if (!this.playing) return this.startPos;
    return this.startPos + Math.max(0, this.ctx.currentTime - this.ctxStart);
  }

  stop() {
    const pos = this.position();
    this._stopGraph();
    this.playing = false;
    this.startPos = pos;
    return pos;
  }

  seek(pos) {
    this.startPos = pos;
  }

  /** Live-Update von Lautstärke/Mute/Solo ohne Neustart. */
  updateTrackGains(doc) {
    if (!this.graph) return;
    for (const t of doc.tracks) {
      const n = this.graph.trackVol.get(t.id);
      if (n) n.vol.gain.setTargetAtTime(effectiveTrackGain(t, doc.tracks), this.ctx.currentTime, 0.02);
    }
  }

  setMaster(v) {
    this.masterValue = v;
    this._applyMaster();
  }

  /** Mithör-Pegel während der Aufnahme. */
  setCue(v) {
    this.cue = v;
    this._applyMaster();
  }

  _applyMaster() {
    this.master.gain.setTargetAtTime(this.masterValue * this.cue, this.ctx.currentTime, 0.03);
  }

  _stopGraph() {
    if (this.graph) this.graph.stop();
    this.graph = null;
  }
}
