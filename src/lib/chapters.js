import { clipEnd, fmtTime, projectDuration } from './utils';

/**
 * Kapitelliste für Export, CUE-Sheet und Tracklist.
 * Nutzt Kapitelmarken – falls keine vorhanden, die Clips der Musik-Spuren.
 */
export function buildChapters(doc) {
  const total = projectDuration(doc);
  let items = doc.markers
    .filter((m) => m.chapter && m.time < total)
    .map((m) => ({ time: m.time, title: m.text || 'Kapitel' }));

  if (!items.length) {
    const musicTracks = new Set(doc.tracks.filter((t) => !t.duck).map((t) => t.id));
    items = doc.clips
      .filter((c) => musicTracks.has(c.trackId))
      .map((c) => ({ time: c.start, title: c.name }));
  }
  items.sort((a, b) => a.time - b.time);
  // Doppelte Zeitpunkte und geteilte Clips desselben Songs zusammenfassen
  const out = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    if (prev && (Math.abs(prev.time - it.time) < 0.5 || prev.title === it.title)) continue;
    out.push({ ...it });
  }
  if (out.length && out[0].time > 0.5) out.unshift({ time: 0, title: 'Intro' });
  for (let i = 0; i < out.length; i++) out[i].end = i + 1 < out.length ? out[i + 1].time : total;
  return out;
}

/** Tracklist mit Songs, Sprachstücken und Notizen in zeitlicher Reihenfolge. */
export function buildTracklist(doc, { includeVoice = true, includeMarkers = true } = {}) {
  const trackById = new Map(doc.tracks.map((t) => [t.id, t]));
  const items = [];
  for (const c of doc.clips) {
    const t = trackById.get(c.trackId);
    if (!t) continue;
    if (t.duck && !includeVoice) continue;
    items.push({ time: c.start, end: clipEnd(c), title: c.name, kind: t.duck ? 'voice' : 'song' });
  }
  if (includeMarkers) {
    for (const m of doc.markers) if (m.chapter) items.push({ time: m.time, title: m.text, kind: 'marker' });
  }
  items.sort((a, b) => a.time - b.time);
  // Geteilte Clips desselben Songs nur einmal auflisten
  return items.filter((it, i) => !items.slice(0, i).some((p) => p.kind === it.kind && p.title === it.title && Math.abs((p.end ?? p.time) - it.time) < 1));
}

function cueTime(s) {
  const frames = Math.round(s * 75);
  const m = Math.floor(frames / (75 * 60));
  const sec = Math.floor(frames / 75) % 60;
  const f = frames % 75;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(m)}:${p(sec)}:${p(f)}`;
}

const q = (s) => `"${String(s).replace(/"/g, "'")}"`;

export function buildCueSheet(doc, audioFileName, type = 'MP3') {
  const lines = [`TITLE ${q(doc.title)}`, `PERFORMER ${q('MixTape')}`, `FILE ${q(audioFileName)} ${type}`];
  buildChapters(doc).forEach((c, i) => {
    lines.push(`  TRACK ${String(i + 1).padStart(2, '0')} AUDIO`);
    lines.push(`    TITLE ${q(c.title)}`);
    lines.push(`    INDEX 01 ${cueTime(c.time)}`);
  });
  return lines.join('\r\n') + '\r\n';
}

export function buildChapterText(doc) {
  return buildChapters(doc)
    .map((c) => `${fmtTime(c.time)} ${c.title}`)
    .join('\n');
}
