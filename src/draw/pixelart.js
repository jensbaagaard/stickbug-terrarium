// The pixel-art basics everything is drawn with: a dab of px (plot), a line of them, a polyline coloured px by px
// (strokeBy), sprites from rows of #, and the 3x5 digits and colour of coin popups.
import { THICKNESS } from '../anatomy.js';

export const COIN = '#f2c94c';
// 3x5 digits for coin popups.
export const GLYPHS = {
  '+': ['...', '.#.', '###', '.#.', '...'],
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '.##', '..#', '###'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'],
};

// Fill a pixel-snapped square of width w centred on (x, y).
export const plot = (ctx, x, y, w) => {
  const h = w / 2;
  const x0 = Math.ceil(x - h);
  const y0 = Math.ceil(y - h);
  ctx.fillRect(x0, y0, Math.ceil(x + h) - x0, Math.ceil(y + h) - y0);
};

export const line = (ctx, a, b, w = THICKNESS) => {
  const steps = Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1));
  for (let i = 0; i <= steps; i++) plot(ctx, a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, w);
};

// Stroke a polyline a pixel at a time, asking colorAt(u) for each pixel's colour (u = px from the start).
export const strokeBy = (ctx, pts, colorAt, w = THICKNESS) => {
  let u = 0;
  let current = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))));
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const c = colorAt(u + (len * k) / steps);
      if (c !== current) ctx.fillStyle = current = c;
      plot(ctx, a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps, w);
    }
    u += len;
  }
};

export const sprite = (ctx, rows, x, y) =>
  rows.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch === '#') ctx.fillRect(Math.round(x) + i, Math.round(y) + j, 1, 1);
    }),
  );
