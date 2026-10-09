// Random sticks for the shop: eight styles (a crooked branch, a fork, an arch, driftwood, manzanita, bamboo, spiderwood
// roots and cholla), in ten woods, with their own foliage; stood in the tank like a stick leaning on the glass.
// Pure generators: objects.js turns their pieces into surfaces.
import { add, dirOf, pick, range } from './geom.js';

// Woods: name and colour.
const WOODS = {
  Oak: (r) => ({ h: range(r, 22, 34), s: range(r, 30, 45), l: range(r, 22, 32) }),
  Driftwood: (r) => ({ h: range(r, 28, 40), s: range(r, 8, 15), l: range(r, 45, 58) }),
  Birch: (r) => ({ h: 40, s: range(r, 6, 10), l: range(r, 70, 80) }),
  Redbark: (r) => ({ h: range(r, 10, 20), s: range(r, 35, 45), l: range(r, 24, 32) }),
  Mopani: (r) => ({ h: range(r, 18, 26), s: range(r, 30, 40), l: range(r, 16, 22) }),
  Grapevine: (r) => ({ h: range(r, 24, 32), s: range(r, 18, 28), l: range(r, 28, 36) }),
  Manzanita: (r) => ({ h: range(r, 6, 14), s: range(r, 45, 60), l: range(r, 30, 38) }),
  Bamboo: (r) =>
    r() < 0.6
      ? { h: range(r, 50, 68), s: range(r, 40, 55), l: range(r, 45, 55) }
      : { h: range(r, 34, 44), s: range(r, 35, 50), l: range(r, 52, 62) },
  Spiderwood: (r) => ({ h: range(r, 28, 36), s: range(r, 25, 35), l: range(r, 50, 60) }),
  Cholla: (r) => ({ h: range(r, 34, 42), s: range(r, 18, 28), l: range(r, 58, 68) }),
};

export const LEAF_SHAPES = ['round', 'long', 'needle', 'heart', 'oak', 'fan'];

// The leaves on the starting stick.
export const DEFAULT_FOLIAGE = { shape: 'round', size: 1.4, color: { h: 135, s: 39, l: 40 }, moss: false, knots: true };

// A stick's foliage: what its leaves look like (now and then in autumn colours), and whether its bark has knots
// or moss. Smooth woods have neither; bamboo has long narrow leaves.
const makeFoliage = (rand, style) => {
  const autumn = rand() < 0.15;
  const rough = STICK_STYLES[style].rough;
  return {
    shape: pick(rand, style === 'bamboo' ? ['long', 'needle'] : ['round', 'long', 'heart', 'oak', 'fan']),
    size: range(rand, 1.1, 2.2),
    color: { h: autumn ? range(rand, 8, 48) : range(rand, 75, 150), s: range(rand, 35, 70), l: range(rand, 28, 48) },
    moss: rough && rand() < 0.35,
    knots: rough && rand() < 0.6,
  };
};

const DEG = Math.PI / 180;
// The way to go deg degrees above horizontal, leaning to side (-1 left, 1 right).
const rise = (side, deg) => Math.atan2(-Math.sin(deg * DEG), side * Math.cos(deg * DEG));
// Keep a direction leaning between lo and hi degrees above horizontal, on the same side (left or right): steep
// enough to look like a stick, shallow enough for a bug to walk up.
const lean = (a, lo, hi) => {
  const side = Math.cos(a) < 0 ? -1 : 1;
  const up = Math.atan2(-Math.sin(a), Math.abs(Math.cos(a))) / DEG;
  return rise(side, Math.min(Math.max(up, lo), hi));
};

// Shapes are grown from the base at (0, 0) as pieces {a, b, parent, depth}, parent an index into pieces (-1 for
// the base) and depth 0 for the main limbs, 1 for twigs, 2 for twigs off twigs.

// A run of n pieces of length len from `from`, turning by turn(angle, i) after each; returns the last one's index.
const limb = (pieces, from, angle, n, len, parent, depth, turn = (a) => a) => {
  let at = from;
  for (let i = 0; i < n; i++) {
    const b = add(at, dirOf(angle), len);
    pieces.push({ a: at, b, parent, depth });
    parent = pieces.length - 1;
    at = b;
    angle = turn(angle, i);
  }
  return parent;
};

// A twig forking off a joint, now and then with a twig of its own.
const twig = (rand, pieces, from, angle, len, parent, depth) => {
  const a = lean(angle + (rand() < 0.5 ? -1 : 1) * range(rand, 0.35, 0.7), 10, 60);
  const l = len * range(rand, 0.5, 0.9);
  const b = add(from, dirOf(a), l);
  pieces.push({ a: from, b, parent, depth });
  if (depth < 2 && rand() < 0.35) twig(rand, pieces, b, a, l * 0.7, pieces.length - 1, depth + 1);
};

// Stick styles: the woods each comes in, what it's called (the wood's name and a noun, or just the wood's), how
// wide its main limbs, twigs and twigs off twigs are, whether its bark is rough (knots and moss), and how it grows
// in a tank H tall, leaning to side.
const STICK_STYLES = {
  // A crooked limb in a few pieces with twigs forking off its joints.
  branch: {
    woods: ['Oak', 'Birch', 'Redbark', 'Mopani'],
    noun: 'branch',
    widths: [4, 3, 2],
    rough: true,
    grow: (rand, H, side) => {
      const pieces = [];
      let angle = rise(side, range(rand, 28, 55));
      const n = 3 + Math.floor(rand() * 3);
      const total = H * range(rand, 0.3, 0.55);
      const bushy = range(rand, 0.4, 0.9); // how keen it is to fork
      let at = { x: 0, y: 0 };
      let parent = -1;
      for (let i = 0; i < n; i++) {
        const len = (total / n) * range(rand, 0.8, 1.2);
        parent = limb(pieces, at, angle, 1, len, parent, 0);
        const b = pieces[parent].b;
        // Twigs off the joints (sometimes a pair), and usually a little fork at the very end.
        const last = i === n - 1;
        const twigs = rand() < (last ? 0.7 : bushy) ? (rand() < (last ? 0.6 : 0.3) ? 2 : 1) : 0;
        for (let k = 0; k < twigs; k++) twig(rand, pieces, b, angle, len * (last ? 0.8 : 1.1), parent, 1);
        at = b;
        angle = lean(angle + (rand() - 0.5) * 0.4, 15, 60);
      }
      return pieces;
    },
  },
  // A trunk splitting into two arms, one leaning each way.
  fork: {
    woods: ['Oak', 'Redbark', 'Grapevine'],
    noun: 'fork',
    widths: [4, 3, 2],
    rough: true,
    grow: (rand, H, side) => {
      const pieces = [];
      const total = H * range(rand, 0.35, 0.5);
      const wobble = (a) => lean(a + (rand() - 0.5) * 0.3, 20, 60);
      const trunk = limb(pieces, { x: 0, y: 0 }, rise(side, range(rand, 52, 60)), 1, total * 0.3, -1, 0);
      const split = pieces[trunk].b;
      for (const [s, lo, hi] of [
        [side, 25, 40],
        [-side, 30, 50],
      ]) {
        const len = total * range(rand, 0.18, 0.24);
        const end = limb(pieces, split, rise(s, range(rand, lo, hi)), 2, len, trunk, 0, wobble);
        if (rand() < 0.6) twig(rand, pieces, pieces[end].b, rise(s, 40), total * 0.2, end, 1);
      }
      return pieces;
    },
  },
  // A bent bough arching up off the floor and back down to it: a bridge to walk over.
  arch: {
    woods: ['Grapevine', 'Driftwood', 'Oak'],
    noun: 'arch',
    widths: [4, 3, 2],
    rough: true,
    grow: (rand, H, side) => {
      const pieces = [];
      const span = H * range(rand, 0.35, 0.5);
      const height = span * range(rand, 0.3, 0.5); // no steeper than a bug can climb at the ends
      const n = 6;
      const at = (t) => ({ x: side * span * t, y: -height * Math.sin(Math.PI * t) });
      let parent = -1;
      for (let i = 0; i < n; i++) {
        pieces.push({ a: at(i / n), b: at((i + 1) / n), parent, depth: 0 });
        parent = pieces.length - 1;
        if (i > 0 && i < n - 1 && rand() < 0.4) {
          twig(rand, pieces, at((i + 1) / n), rise(rand() < 0.5 ? 1 : -1, 50), span * 0.25, parent, 1);
        }
      }
      return pieces;
    },
  },
  // A long, smooth, pale log lying low, with a stub or two where branches broke off.
  driftwood: {
    woods: ['Driftwood'],
    noun: null,
    widths: [5, 3, 2],
    rough: false,
    grow: (rand, H, side) => {
      const pieces = [];
      const n = 3 + Math.floor(rand() * 2);
      const total = H * range(rand, 0.4, 0.6);
      const bend = (a) => lean(a + (rand() - 0.5) * 0.3, 8, 30);
      limb(pieces, { x: 0, y: 0 }, rise(side, range(rand, 12, 22)), n, total / n, -1, 0, bend);
      for (let k = 0, stubs = 1 + Math.floor(rand() * 2); k < stubs; k++) {
        const i = Math.floor(rand() * n);
        const stub = add(pieces[i].b, dirOf(rise(side, range(rand, 40, 58))), total * 0.07);
        pieces.push({ a: pieces[i].b, b: stub, parent: i, depth: 1 });
      }
      return pieces;
    },
  },
  // A twisty red limb, zigzagging at every joint, bushy with little twisty twigs.
  manzanita: {
    woods: ['Manzanita'],
    noun: null,
    widths: [3, 2, 2],
    rough: false,
    grow: (rand, H, side) => {
      const pieces = [];
      const n = 5 + Math.floor(rand() * 3);
      const total = H * range(rand, 0.35, 0.5);
      const zigzag = (a, i) => lean(a + (i % 2 ? 1 : -1) * range(rand, 0.35, 0.6), 15, 60);
      limb(pieces, { x: 0, y: 0 }, rise(side, range(rand, 35, 55)), n, total / n, -1, 0, zigzag);
      for (let i = 0; i < n; i++) {
        if (rand() < 0.6) twig(rand, pieces, pieces[i].b, rise(rand() < 0.5 ? 1 : -1, 40), total / n, i, 1);
      }
      return pieces;
    },
  },
  // Two or three straight canes from one clump, ringed at every node, with a leafy sprig at the top.
  bamboo: {
    woods: ['Bamboo'],
    noun: null,
    widths: [3, 2, 1],
    rough: false,
    grow: (rand, H, side) => {
      const pieces = [];
      const canes = rand() < 0.4 ? 3 : 2;
      for (let k = 0; k < canes; k++) {
        const s = k === 1 ? -side : side;
        const len = H * range(rand, 0.35, 0.6) * (k === 0 ? 1 : 0.75);
        const node = range(rand, 10, 14);
        const angle = rise(s, k === 0 ? range(rand, 48, 60) : range(rand, 40, 56));
        const top = limb(pieces, { x: 0, y: 0 }, angle, Math.max(2, Math.round(len / node)), node, -1, 0);
        twig(rand, pieces, pieces[top].b, angle, node, top, 1);
      }
      return pieces;
    },
  },
  // Many thin pale roots fanning up from one spot, like a hand.
  spiderwood: {
    woods: ['Spiderwood'],
    noun: null,
    widths: [2, 2, 1],
    rough: false,
    grow: (rand, H, side) => {
      const pieces = [];
      const roots = 5 + Math.floor(rand() * 3);
      const wobble = (a) => lean(a + (rand() - 0.5) * 0.5, 20, 60);
      for (let k = 0; k < roots; k++) {
        const s = k % 2 ? -side : side;
        const len = H * range(rand, 0.15, 0.38);
        const n = 2 + Math.floor(rand() * 2);
        const depth = k % 3 ? 1 : 0; // a few thicker roots among the thin ones
        const end = limb(pieces, { x: 0, y: 0 }, rise(s, range(rand, 25, 60)), n, len / n, -1, depth, wobble);
        if (rand() < 0.3) twig(rand, pieces, pieces[end].b, rise(s, 45), len * 0.3, end, 2);
      }
      return pieces;
    },
  },
  // The hollow, holey skeleton of a cholla cactus: thick, straight, with one arm.
  cholla: {
    woods: ['Cholla'],
    noun: null,
    widths: [5, 4, 3],
    rough: false,
    grow: (rand, H, side) => {
      const pieces = [];
      const total = H * range(rand, 0.3, 0.45);
      const straight = (a) => lean(a + (rand() - 0.5) * 0.15, 40, 60);
      limb(pieces, { x: 0, y: 0 }, rise(side, range(rand, 45, 60)), 2, total / 2, -1, 0, straight);
      limb(pieces, pieces[0].b, rise(-side, range(rand, 35, 50)), 1 + Math.floor(rand() * 2), total * 0.25, 0, 1);
      return pieces;
    },
  },
};

const STICK_KINDS = Object.keys(STICK_STYLES);

// How wide a stick of this style is at this depth (main limb 0, twigs 1, twigs off twigs 2).
export const stickWidth = (style, depth) => STICK_STYLES[style ?? 'branch'].widths[depth] ?? 1;

// Stand pieces grown from (0, 0) on base, in a tank W by H, like a stick leaning against the glass: a piece that
// would poke out of the tank is cut off at its side (or top), and whatever grows beyond the cut goes too.
const standIn = (pieces, base, W, H) => {
  const out = [];
  const kept = new Map(); // index in pieces -> index in out, for pieces kept whole
  pieces.forEach((p, i) => {
    if (p.parent >= 0 && !kept.has(p.parent)) return;
    const a = { x: base.x + p.a.x, y: base.y + p.a.y };
    const b = { x: base.x + p.b.x, y: base.y + p.b.y };
    // How far along a -> b it can go before leaving the tank.
    let t = 1;
    if (b.x < 2) t = Math.min(t, (a.x - 2) / (a.x - b.x));
    if (b.x > W - 3) t = Math.min(t, (W - 3 - a.x) / (b.x - a.x));
    if (b.y < 4) t = Math.min(t, (a.y - 4) / (a.y - b.y));
    if (t * Math.hypot(b.x - a.x, b.y - a.y) < 3) return; // too little left to be worth having
    out.push({ ...p, a, b: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, parent: kept.get(p.parent) ?? -1 });
    if (t === 1) kept.set(i, out.length - 1);
  });
  return out;
};

// A random stick standing on base, in a tank W by H: its style, name, wood, foliage and pieces {a, b, parent,
// depth}. Its shape comes only from rand, never from where it stands, so it doesn't turn about as it's carried
// around before it's put down.
export const makeStick = (rand, base, W, H) => {
  const style = pick(rand, STICK_KINDS);
  const st = STICK_STYLES[style];
  const side = rand() < 0.5 ? -1 : 1;
  const pieces = st.grow(rand, H, side);
  const woodName = pick(rand, st.woods);
  return {
    style,
    name: st.noun ? `${woodName} ${st.noun}` : woodName,
    pieces: standIn(pieces, base, W, H),
    wood: { name: woodName, ...WOODS[woodName](rand) },
    foliage: makeFoliage(rand, style),
  };
};
