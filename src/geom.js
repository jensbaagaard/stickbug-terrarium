// Small maths, segment and colour helpers shared by the simulation and the renderer.

export const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Deterministic 0..1 noise from a few numbers, for patterns and textures that must not flicker.
export const hash = (a, b = 0, c = 0) => {
  let h = Math.imul(Math.floor(a) | 0, 374761393) + Math.imul(Math.floor(b) | 0, 668265263);
  h = Math.imul(h ^ Math.imul(Math.floor(c) | 0, 2246822519), 3266489917);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const pick = (rand, list) => list[Math.floor(rand() * list.length)];

// Points are {x, y}.
export const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k });
export const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const normalize = (v) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

// A segment / surface is {x0, y0, x1, y1}.
export const segLength = (g) => Math.hypot(g.x1 - g.x0, g.y1 - g.y0) || 1;
export const segDir = (g) => {
  const l = segLength(g);
  return { x: (g.x1 - g.x0) / l, y: (g.y1 - g.y0) / l };
};
// Normal pointing "up" off the surface (for left-to-right segments).
export const segNormal = (g) => {
  const d = segDir(g);
  return { x: d.y, y: -d.x };
};
export const pointAt = (g, s) => {
  const d = segDir(g);
  return { x: g.x0 + d.x * s, y: g.y0 + d.y * s };
};
// Arc-length position of the closest point on g to (x, y).
export const project = (g, x, y) => {
  const d = segDir(g);
  return clamp((x - g.x0) * d.x + (y - g.y0) * d.y, 0, segLength(g));
};
export const distToSeg = (g, x, y) => {
  const p = pointAt(g, project(g, x, y));
  return Math.hypot(x - p.x, y - p.y);
};

const cross = (ax, ay, bx, by) => ax * by - ay * bx;

// Where two segments cross, or null.
export const segIntersect = (a, b) => {
  const ax = a.x1 - a.x0, ay = a.y1 - a.y0;
  const bx = b.x1 - b.x0, by = b.y1 - b.y0;
  const den = cross(ax, ay, bx, by);
  if (Math.abs(den) < 1e-9) return null;
  const ta = cross(b.x0 - a.x0, b.y0 - a.y0, bx, by) / den;
  const tb = cross(b.x0 - a.x0, b.y0 - a.y0, ax, ay) / den;
  return ta >= 0 && ta <= 1 && tb >= 0 && tb <= 1 ? { x: a.x0 + ax * ta, y: a.y0 + ay * ta } : null;
};

// Closest approach between two segments: arc positions on each and the gap.
export const closestApproach = (a, b) => {
  const hit = segIntersect(a, b);
  if (hit) return { sa: project(a, hit.x, hit.y), sb: project(b, hit.x, hit.y), d: 0 };
  let best = { sa: 0, sb: 0, d: Infinity };
  for (const [from, onto, swapped] of [[a, b, false], [b, a, true]]) {
    for (const [x, y] of [[from.x0, from.y0], [from.x1, from.y1]]) {
      const sOnto = project(onto, x, y);
      const sFrom = project(from, x, y);
      const p = pointAt(onto, sOnto);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < best.d) best = swapped ? { sa: sOnto, sb: sFrom, d } : { sa: sFrom, sb: sOnto, d };
    }
  }
  return best;
};

// A #rrggbb colour as [r, g, b], cached.
const rgbCache = new Map();
export const rgb = (hex) => {
  let v = rgbCache.get(hex);
  if (!v) rgbCache.set(hex, (v = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16))));
  return v;
};

// HSL (degrees, percent, percent) to a cached #rrggbb string.
const hexCache = new Map();
export const hslHex = (h, s, l) => {
  const hh = ((Math.round(h) % 360) + 360) % 360;
  const ss = clamp(Math.round(s), 0, 100);
  const ll = clamp(Math.round(l), 0, 100);
  const key = hh * 1e6 + ss * 1e3 + ll;
  let hex = hexCache.get(key);
  if (!hex) {
    const a = (ss / 100) * Math.min(ll / 100, 1 - ll / 100);
    const f = (n) => {
      const k = (n + hh / 30) % 12;
      const c = ll / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(c * 255).toString(16).padStart(2, '0');
    };
    hex = `#${f(0)}${f(8)}${f(4)}`;
    hexCache.set(key, hex);
  }
  return hex;
};
