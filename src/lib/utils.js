export const uid = (prefix = 'id') =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function fmtTime(s, precise = false) {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  if (precise) return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
  return `${m}:${String(Math.floor(sec)).padStart(2, '0')}`;
}

export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => (g <= 0.00001 ? -100 : 20 * Math.log10(g));

export const basename = (p) => (p || '').split(/[\\/]/).pop();
export const stripExt = (name) => (name || '').replace(/\.[^.]+$/, '');

export const clipEnd = (c) => c.start + c.duration;

export function projectDuration(doc) {
  let end = 0;
  for (const c of doc.clips) end = Math.max(end, clipEnd(c));
  return end;
}

export const TRACK_COLORS = ['#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#fb7185', '#22d3ee', '#f97316'];

export function newTrack(tracks, overrides = {}) {
  const n = tracks.length;
  return {
    id: uid('trk'),
    name: `Spur ${n + 1}`,
    volume: 1,
    muted: false,
    solo: false,
    duck: false,
    color: TRACK_COLORS[n % TRACK_COLORS.length],
    ...overrides,
  };
}

export function emptyDoc() {
  const music = newTrack([], { name: 'Musik' });
  const voice = newTrack([music], { name: 'Sprache', duck: true });
  return {
    title: 'Mein Mixtape',
    tracks: [music, voice],
    clips: [],
    markers: [],
    masterVolume: 1,
    duckDepth: 0.3,
  };
}

/** Effektive Lautstärke einer Spur unter Berücksichtigung von Mute/Solo. */
export function effectiveTrackGain(track, tracks) {
  const anySolo = tracks.some((t) => t.solo);
  if (track.muted) return 0;
  if (anySolo && !track.solo) return 0;
  return track.volume;
}

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Ende der letzten Clip-Position einer Spur. */
export function trackEnd(doc, trackId) {
  let end = 0;
  for (const c of doc.clips) if (c.trackId === trackId) end = Math.max(end, clipEnd(c));
  return end;
}
