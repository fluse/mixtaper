import React, { memo, useEffect, useRef } from 'react';
import { PEAKS_PER_SEC } from '../lib/audio';

const TILE = 2048;

/** Ein Teilstück der Wellenform (Canvas-Breite ist begrenzt, daher gekachelt). */
const Tile = memo(function Tile({ peaks, x0, width, height, offset, zoom, gain, color }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(width * dpr));
    cv.height = Math.max(1, Math.round(height * dpr));
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    g.fillStyle = color;
    const mid = height / 2;
    const perPx = PEAKS_PER_SEC / zoom;
    for (let x = 0; x < width; x++) {
      const t = offset + (x0 + x) / zoom;
      const i0 = Math.floor(t * PEAKS_PER_SEC);
      const i1 = Math.max(i0 + 1, Math.floor(i0 + perPx));
      let max = 0;
      for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > max) max = peaks[i];
      // leicht komprimierte Darstellung, damit auch leise Sprache sichtbar ist
      const h = Math.max(0.5, Math.pow(Math.min(1, max * gain), 0.7) * (mid - 1));
      g.fillRect(x, mid - h, 1, h * 2);
    }
  }, [peaks, x0, width, height, offset, zoom, gain, color]);
  return <canvas ref={ref} style={{ position: 'absolute', left: x0, top: 0, width, height }} />;
});

export const Waveform = memo(function Waveform({ peaks, offset, duration, zoom, height, gain = 1, color }) {
  if (!peaks) return null;
  const total = Math.max(1, Math.round(duration * zoom));
  const tiles = [];
  for (let x0 = 0; x0 < total; x0 += TILE) {
    tiles.push(
      <Tile
        key={x0}
        peaks={peaks}
        x0={x0}
        width={Math.min(TILE, total - x0)}
        height={height}
        offset={offset}
        zoom={zoom}
        gain={gain}
        color={color}
      />,
    );
  }
  return <div className="absolute inset-0 pointer-events-none">{tiles}</div>;
});
