// Drawing fish: body, fins and tail in each genome's colours and shapes, swimming, turning and pitching.
import { facingNow, fishShape } from '../fish.js';
import { clamp, hash, hslHex } from '../geom.js';
import { ARROW } from './marks.js';
import { COIN, sprite } from './pixelart.js';

const fishInks = new WeakMap(); // a genome's colours, worked out once

const inksOf = (g) => {
  if (fishInks.has(g)) return fishInks.get(g);
  const ink = (c, dl = 0) => hslHex(c.h, c.s * (g.albino ? 0.5 : 1), c.l + dl + (g.albino ? 10 : 0));
  const inks = {
    body: ink(g.body),
    back: ink(g.body, -10),
    belly: ink(g.body, 12),
    dark: ink({ h: g.body.h, s: 20, l: 18 }),
    spots: ink(g.spots),
    tail: ink(g.tailColor),
    tip: ink(g.tailColor, 10),
    tail2: ink(g.tailColor2),
    eye: g.albino ? '#d8394a' : '#141414',
    glint: '#eef4ff',
  };
  fishInks.set(g, inks);
  return inks;
};

// How far a tail spreads either side of its middle, t of the way along it.
const TAIL_SHAPES = {
  delta: (t, ped, S) => ped + (S - ped) * t,
  fan: (t, ped, S) => (ped + (S - ped) * Math.sqrt(t)) * (t > 0.8 ? 1 - (t - 0.8) * 1.5 : 1),
  round: (t, ped, S) => Math.max(ped, S * 0.8 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2))),
  spade: (t, ped, S) => (t < 0.55 ? ped + (S * 0.8 - ped) * (t / 0.55) : (S * 0.8 * (1 - t)) / 0.45),
  veil: (t, ped, S) => ped + (S * 1.1 - ped) * Math.sqrt(t),
  sword: (t, ped, S) => ped + (S * 0.6 - ped) * t,
  double: (t, ped, S) => ped + (S * 0.5 - ped) * t,
  lyre: (t, ped, S) => ped + (S - ped) * t,
};

// Where a sword reaches on past the tail, along its lower (or upper) edge.
const swordAt = (t, ped, S) => ped + (S * 0.65 - ped) * Math.min(t, 1);

// The colour of a fish's pixel at (u, v) in its own frame (u from its middle toward its nose, v down), or null if
// it's not on the fish.
const fishInk = (g, ink, shape, u, v, beat, time) => {
  const { len, depth, tail, spread, dorsal } = shape;
  const half = len / 2;
  const ped = depth * 0.18;
  if (u > half) return null;
  if (u > -half) {
    const sb = (u + half) / len; // 0 at the root of the tail .. 1 at the nose
    // Deepest a little in front of the middle, narrowing to the tail and rounding off to the nose.
    const prof =
      sb < 0.55
        ? 0.35 + 0.65 * Math.sin(((sb / 0.55) * Math.PI) / 2)
        : 0.2 + 0.8 * Math.sqrt(1 - ((sb - 0.55) / 0.45) ** 2);
    const hh = (depth / 2) * prof;
    const vv = v - (g.male ? 0 : depth * 0.08) * Math.sin(sb * Math.PI); // a female's belly hangs lower
    if (Math.abs(vv) > hh) {
      // The dorsal fin: a male's long and swept back, a female's a little triangle.
      const fin = g.male
        ? sb > 0.08 && sb < 0.55 && dorsal * clamp((0.55 - sb) / 0.3, 0, 1)
        : sb > 0.3 && sb < 0.55 && dorsal * (1 - Math.abs(sb - 0.42) / 0.13);
      return fin && vv < -hh && -vv - hh < fin ? ink.tail : null;
    }
    if (Math.abs(u - half * 0.62) < 0.75 && Math.abs(vv + hh * 0.25) < 0.75) return ink.eye;
    if (!g.male && sb > 0.3 && sb < 0.55 && vv > hh * 0.15) return ink.dark; // the gravid spot
    if (g.pattern === 'spots' && sb < 0.65 && hash(g.seed, Math.round(u * 1.3), Math.round(v * 1.3)) < 0.2) {
      return ink.spots;
    }
    if (g.pattern === 'snakeskin' && sb < 0.75 && ((Math.round(u) + Math.round(v * 1.5)) & 1) === 0) return ink.back;
    if (g.pattern === 'tuxedo' && sb < 0.5) return ink.dark;
    if (g.metallic && vv < 0 && hash(g.seed, Math.round(u), Math.round(v) + 9, Math.floor(time / 8)) < 0.08) {
      return ink.glint;
    }
    return vv < -hh * 0.35 ? ink.back : vv > hh * 0.4 ? ink.belly : ink.body;
  }
  // The tail, sweeping side to side so it looks shorter and longer, and fluttering up and down a little.
  const t = (-half - u) / (tail * beat);
  const vt = v - (g.tail === 'veil' ? t * t * spread * 0.4 : 0); // a veil droops
  const h = TAIL_SHAPES[g.tail](Math.min(t, 1), ped, spread);
  const notch = g.tail === 'lyre' && t > 0.6 && Math.abs(vt) < h * (t - 0.6) * 2.2;
  if (t <= 1 && Math.abs(vt) <= h && !notch) {
    switch (g.tailPattern) {
      case 'mosaic':
        return hash(g.seed, Math.floor(t * 4), Math.floor(vt / 1.5)) < 0.45 ? ink.tail2 : ink.tail;
      case 'leopard':
        return hash(g.seed, Math.round(t * 6), Math.round(vt)) < 0.22 ? ink.dark : ink.tail;
      case 'grass':
        return hash(g.seed, Math.round(t * 8), Math.round(vt * 1.3), 3) < 0.35 ? ink.tail2 : ink.tail;
      case 'edge':
        return t > 0.8 || Math.abs(vt) > h - 0.8 ? ink.tail2 : ink.tail;
      case 'half':
        return t < 0.45 ? ink.tail2 : ink.tail;
      default:
        return t > 0.7 ? ink.tip : ink.tail;
    }
  }
  // Swords reach on past the end along an edge; a lyre's outer rays do too.
  const sword = (sign) => Math.abs(vt - sign * swordAt(t, ped, spread)) < 0.75;
  if (t > 0.3 && t < 1.5 && ((g.tail !== 'lyre' && sword(1)) || (g.tail === 'double' && sword(-1)))) {
    return g.tail === 'sword' || g.tail === 'double' ? ink.tip : null;
  }
  const rim = ped + (spread - ped) * Math.min(t, 1);
  if (g.tail === 'lyre' && t > 0.8 && t < 1.3 && Math.abs(Math.abs(vt) - rim) < 0.75) return ink.tip;
  return null;
};

// A guppy, side on: every pixel round it looked up in the fish's own frame, which turns as it pitches up and down
// and narrows as it turns round. A male on display curves into a quivering S; out of the water it curls as it flops.
export const drawFish = (ctx, world, f) => {
  const g = f.genome;
  const ink = inksOf(g);
  const shape = fishShape(g);
  if (f.flare) [shape.dorsal, shape.spread] = [shape.dorsal * (1 + 0.7 * f.flare), shape.spread * (1 + 0.3 * f.flare)];
  const turning = f.turn > 0;
  const across = facingNow(f);
  const sx = Math.sign(across || 1) * Math.max(0.25, Math.abs(across));
  // Pitch in steps, like sprite frames: the slightest tilt would shuffle every pixel of the fish.
  const pitch = turning ? 0 : Math.round(f.pitch / 0.2) * 0.2;
  const [c, s] = [Math.cos(pitch), Math.sin(pitch)];
  const beat = 0.88 + 0.12 * Math.cos(f.tail);
  const sway = f.display > 0 ? 0.9 : 0;
  const curl = f.dry ? Math.sin(f.tail) * 1.2 : 0;
  const half = shape.len / 2;
  const r = Math.ceil(half + shape.tail * 1.5 + shape.dorsal + 2);
  let current = null;
  for (let py = Math.floor(f.y - r); py <= f.y + r; py++) {
    for (let px = Math.floor(f.x - r); px <= f.x + r; px++) {
      const [dx, dy] = [px + 0.5 - f.x, py + 0.5 - f.y];
      const u = turning ? dx / sx : f.facing * dx * c + dy * s;
      let v = turning ? dy : -f.facing * dx * s + dy * c;
      v -= sway * Math.sin(u * 0.9 + world.time * 0.8) + curl * (u / half) ** 2;
      v -= Math.sin(f.tail) * 0.3 * Math.max(0, (-half - u) / shape.tail) ** 2; // the tail flutters
      const color = fishInk(g, ink, shape, u, v, beat, world.time);
      if (!color) continue;
      if (color !== current) ctx.fillStyle = current = color;
      ctx.fillRect(px, py, 1, 1);
    }
  }
  if (world.selected === f) {
    ctx.fillStyle = COIN;
    sprite(ctx, ARROW, f.x - 2, f.y - shape.depth - shape.dorsal - 6 + (Math.floor(world.time / 20) % 2));
  }
};

// A fish as the shop shows it, or following the pointer before it's let go: side on, facing right, finning.
export const posedFish = (genome, x, y, time) => ({ genome, x, y, facing: 1, turn: 0, pitch: 0, tail: time * 0.15 });
