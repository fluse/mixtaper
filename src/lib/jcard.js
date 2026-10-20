import { fmtTime } from './utils';

export const JCARD_THEMES = {
  sunset: { name: 'Sonnenuntergang', a: '#ff6b6b', b: '#ffa94d', c: '#ffd43b', bg: '#fff8ef', ink: '#2b1d16' },
  ocean: { name: 'Ozean', a: '#1c7ed6', b: '#22b8cf', c: '#96f2d7', bg: '#f1f9ff', ink: '#0b2239' },
  grape: { name: 'Traube', a: '#ae3ec9', b: '#f06595', c: '#ffc9e3', bg: '#fdf4ff', ink: '#2a1033' },
  mint: { name: 'Minze', a: '#2f9e44', b: '#94d82d', c: '#ffe066', bg: '#f4fce3', ink: '#17301b' },
  mono: { name: 'Klassisch', a: '#212529', b: '#868e96', c: '#dee2e6', bg: '#ffffff', ink: '#111111' },
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Teilt Einträge in Seite A / B an der zeitlichen Mitte. */
export function splitSides(items, total) {
  const half = total / 2;
  return {
    a: items.filter((i) => i.time < half),
    b: items.filter((i) => i.time >= half),
  };
}

function list(items, offset) {
  return items
    .map(
      (it, i) => `<li class="${it.kind || ''}"><span class="n">${i + 1}</span><span class="t">${esc(it.title)}</span><span class="d">${fmtTime(it.time - offset)}</span></li>`,
    )
    .join('');
}

/**
 * Erzeugt eine druckbare J-Card (Kassetteneinleger) als HTML-Dokument im A4-Querformat.
 * opts: { title, to, from, date, message, theme, items, total, sides }
 */
export function buildJCardHtml(opts) {
  const th = JCARD_THEMES[opts.theme] || JCARD_THEMES.sunset;
  const items = opts.items || [];
  const total = opts.total || 0;
  const sides = opts.sides ? splitSides(items, total) : { a: items, b: [] };
  const half = opts.sides ? total / 2 : 0;
  const tracks = sides.b.length
    ? `<div class="side"><h3>Seite A</h3><ol>${list(sides.a, 0)}</ol></div><div class="side"><h3>Seite B</h3><ol>${list(sides.b, half)}</ol></div>`
    : `<div class="side wide"><h3>Tracklist</h3><ol>${list(sides.a, 0)}</ol></div>`;

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${esc(opts.title)} – J-Card</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; }
  body { font-family: "Segoe UI", system-ui, sans-serif; color: ${th.ink}; width: 297mm; height: 210mm; padding: 14mm 12mm; position: relative; }
  .hint { font-size: 8pt; color: #888; margin-bottom: 6mm; }
  .row { display: flex; gap: 14mm; align-items: flex-start; }
  .label { font-size: 7pt; color: #999; margin-top: 2mm; letter-spacing: .06em; text-transform: uppercase; }
  .card { display: flex; height: 101.6mm; border: 0.2mm solid #999; background: ${th.bg}; }
  .card > div { height: 100%; position: relative; overflow: hidden; }
  .card > div + div { border-left: 0.2mm dashed #bbb; }
  .flap { width: 16mm; }
  .spine { width: 13mm; }
  .front { width: 65mm; }
  .stripes { position: absolute; left: 0; right: 0; height: 18mm; bottom: 14mm;
    background: linear-gradient(${th.a} 0 33%, ${th.b} 33% 66%, ${th.c} 66% 100%); }
  .front .inner { position: absolute; inset: 0; padding: 6mm 5mm; display: flex; flex-direction: column; }
  .front h1 { font-size: 17pt; line-height: 1.05; font-weight: 800; letter-spacing: -.01em; word-break: break-word; }
  .front .for { margin-top: 3mm; font-size: 10pt; }
  .front .for b { color: ${th.a}; }
  .front .msg { margin-top: 3mm; font-size: 8pt; font-style: italic; opacity: .85; }
  .front .foot { position: absolute; left: 5mm; right: 5mm; bottom: 4mm; font-size: 7pt; display: flex; justify-content: space-between; opacity: .8; }
  .tape { position: absolute; left: 50%; transform: translateX(-50%); bottom: 35mm; width: 40mm; height: 20mm; border: 0.6mm solid ${th.ink}; border-radius: 3mm; opacity: .9; }
  .tape::before, .tape::after { content: ""; position: absolute; top: 5.5mm; width: 8mm; height: 8mm; border-radius: 50%; border: 0.6mm solid ${th.ink}; background: ${th.bg}; }
  .tape::before { left: 6mm; } .tape::after { right: 6mm; }
  .spine .v { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%) rotate(-90deg); white-space: nowrap; font-weight: 800; font-size: 10pt; width: 95mm; text-align: center; }
  .spine { background: linear-gradient(90deg, ${th.a}, ${th.b}); color: #fff; }
  .flap .v { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%) rotate(-90deg); white-space: nowrap; font-size: 7.5pt; width: 95mm; text-align: center; }
  .inside { width: 94mm; padding: 5mm 4mm; display: flex; gap: 3mm; }
  .side { flex: 1; min-width: 0; }
  .side h3 { font-size: 8pt; text-transform: uppercase; letter-spacing: .08em; color: ${th.a}; border-bottom: 0.3mm solid ${th.b}; padding-bottom: 1mm; margin-bottom: 1.5mm; }
  ol { list-style: none; }
  li { display: flex; gap: 1.5mm; font-size: 6.6pt; line-height: 1.35; }
  li .n { width: 3.5mm; opacity: .5; text-align: right; flex: none; }
  li .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li .d { opacity: .6; font-variant-numeric: tabular-nums; flex: none; }
  li.voice .t { font-style: italic; }
  li.marker .t { font-weight: 700; color: ${th.a}; }
</style></head>
<body>
  <p class="hint">Beide Teile entlang der durchgezogenen Linie ausschneiden, Rückseiten aufeinanderkleben und an den gestrichelten Linien falzen.</p>
  <div class="row">
    <div>
      <div class="card">
        <div class="flap"><div class="v">${esc(opts.date || '')}${opts.to ? ` · für ${esc(opts.to)}` : ''}</div></div>
        <div class="spine"><div class="v">${esc(opts.title)}</div></div>
        <div class="front">
          <div class="stripes"></div>
          <div class="tape"></div>
          <div class="inner">
            <h1>${esc(opts.title)}</h1>
            ${opts.to ? `<div class="for">für <b>${esc(opts.to)}</b></div>` : ''}
            ${opts.message ? `<div class="msg">${esc(opts.message)}</div>` : ''}
          </div>
          <div class="foot"><span>${opts.from ? `von ${esc(opts.from)}` : ''}</span><span>${fmtTime(total)} min</span></div>
        </div>
      </div>
      <div class="label">Außenseite</div>
    </div>
    <div>
      <div class="card">
        <div class="inside">${tracks}</div>
      </div>
      <div class="label">Innenseite</div>
    </div>
  </div>
</body></html>`;
}
