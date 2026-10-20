/**
 * Minimaler ID3v2.3-Writer: Titel, Interpret, Album und Kapitelmarken (CHAP/CTOC),
 * damit Podcast-/Hörbuch-Player die Kapitel direkt im MP3 erkennen.
 */

function utf16Text(str) {
  // Encoding 1 = UTF-16 mit BOM, nullterminiert
  const bytes = [1, 0xff, 0xfe];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    bytes.push(c & 0xff, c >> 8);
  }
  bytes.push(0, 0);
  return bytes;
}

function latin1Z(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff);
  bytes.push(0);
  return bytes;
}

function u32(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function frame(id, body) {
  return [...latin1Z(id).slice(0, 4), ...u32(body.length), 0, 0, ...body];
}

export function buildId3({ title, artist, album, chapters = [] }) {
  let frames = [];
  if (title) frames.push(...frame('TIT2', utf16Text(title)));
  if (artist) frames.push(...frame('TPE1', utf16Text(artist)));
  if (album) frames.push(...frame('TALB', utf16Text(album)));

  const chaps = chapters.slice(0, 255);
  if (chaps.length) {
    const ids = chaps.map((_, i) => `chp${i}`);
    const toc = [...latin1Z('toc'), 0x03, chaps.length];
    ids.forEach((id) => toc.push(...latin1Z(id)));
    frames.push(...frame('CTOC', toc));
    chaps.forEach((c, i) => {
      const body = [
        ...latin1Z(ids[i]),
        ...u32(Math.round(c.time * 1000)),
        ...u32(Math.round(c.end * 1000)),
        ...u32(0xffffffff),
        ...u32(0xffffffff),
        ...frame('TIT2', utf16Text(c.title || `Kapitel ${i + 1}`)),
      ];
      frames.push(...frame('CHAP', body));
    });
  }

  const size = frames.length;
  const header = [
    0x49, 0x44, 0x33, 3, 0, 0,
    (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f,
  ];
  return new Uint8Array([...header, ...frames]);
}
