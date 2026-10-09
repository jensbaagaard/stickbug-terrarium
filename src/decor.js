// Random decorations for the shop: sticks, plant genomes and wallpapers. Pure generators; sim.js turns their
// shapes into surfaces. Colours are {h, s, l}.
import { add, pick } from './geom.js';

const range = (rand, lo, hi) => lo + rand() * (hi - lo);
const dirOf = (a) => ({ x: Math.cos(a), y: Math.sin(a) });

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

const LEAF_SHAPES = ['round', 'long', 'needle', 'heart', 'oak', 'fan'];

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

const PLANT_NAMES = [
  'Rotala', 'Ludwigia', 'Pilea', 'Fittonia', 'Peperomia', 'Hygrophila', 'Bacopa', 'Tradescantia',
  'Selaginella', 'Creeping fig', 'Pothos', 'Begonia', 'Cosmos', 'Campanula', 'Primula', 'Lavender',
];
const FLOWER_FORMS = ['daisy', 'star', 'bell', 'tulip', 'cluster', 'spike', 'pom'];

// A flower genome: its form, how many petals and how big, colours from petal base to tip, the centre, and
// sometimes a second ring of petals inside the first. nodeBloom is the chance a node flowers too, not just
// the tips.
const makeFlower = (rand) => {
  const h = rand() * 360;
  return {
    form: pick(rand, FLOWER_FORMS),
    petals: 4 + Math.floor(rand() * 9),
    size: range(rand, 0.8, 2.2),
    petalLen: range(rand, 2, 4.5),
    petalWidth: range(rand, 1, 2.4),
    petal: { h, s: range(rand, 55, 95), l: range(rand, 50, 78) },
    tip: { h: h + range(rand, -60, 60), l: range(rand, -20, 20) },
    centre: { h: rand() < 0.6 ? range(rand, 40, 55) : rand() * 360, s: range(rand, 50, 90), l: range(rand, 30, 65) },
    centreSize: range(rand, 0.8, 2.5),
    ring: rand() < 0.35 ? { h: h + range(rand, 120, 240), s: range(rand, 50, 90), l: range(rand, 50, 80) } : null,
    nodeBloom: rand() < 0.4 ? range(rand, 0.15, 0.6) : 0,
  };
};

// Now and then a plant comes with leaves of an unusual colour; more rarely, a mutation has taken the chlorophyll
// from all or part of its leaves, and it's worth a lot more. A mutation marks the leaves (mark: marbled, half of
// each leaf, speckled, or a pale rim, covering about amount of each, more on some leaves than others) or paints
// them over (leaf).
const TINT_CHANCE = 0.1;
const MUTATION_CHANCE = 0.04;
const LEAF_TINTS = [
  ['Purple', (r) => ({ h: range(r, 270, 295), s: range(r, 30, 45), l: range(r, 26, 34) })],
  ['Black', (r) => ({ h: range(r, 290, 330), s: range(r, 15, 25), l: range(r, 14, 19) })],
  ['Golden', (r) => ({ h: range(r, 52, 64), s: range(r, 60, 75), l: range(r, 45, 52) })],
  ['Silver', (r) => ({ h: range(r, 170, 200), s: range(r, 8, 16), l: range(r, 52, 62) })],
  ['Copper', (r) => ({ h: range(r, 15, 28), s: range(r, 45, 60), l: range(r, 34, 42) })],
  ['Pink', (r) => ({ h: range(r, 330, 345), s: range(r, 45, 60), l: range(r, 55, 64) })],
];
const CREAM = { h: 58, s: 25, l: 90 };
const MUTATIONS = [
  { name: 'Albo', mark: 'marble', color: CREAM, amount: 0.5 },
  { name: 'Half-moon', mark: 'half', color: CREAM, amount: 1 },
  { name: 'Pink princess', mark: 'marble', color: { h: 335, s: 55, l: 72 }, amount: 0.45 },
  { name: 'Constellation', mark: 'speckle', color: { h: 55, s: 35, l: 85 }, amount: 0.3 },
  { name: 'Marginata', mark: 'rim', color: { h: 55, s: 50, l: 78 }, amount: 1 },
  { name: 'Aurea', leaf: { h: 62, s: 70, l: 52 } },
  { name: 'Ghost', leaf: { h: 95, s: 22, l: 82 } },
];

// Give a species its rare leaves, if it's lucky: tinted or mutated, named for it.
const rareLeaves = (rand, sp) => {
  const r = rand();
  const named = (prefix) => `${prefix} ${sp.name.charAt(0).toLowerCase()}${sp.name.slice(1)}`;
  if (r < MUTATION_CHANCE) {
    const { name, mark, color, amount, leaf } = pick(rand, MUTATIONS);
    const mutation = mark ? { mark, color, amount } : null;
    return { ...sp, name: named(name), rare: 'mutation', leaf: leaf ?? sp.leaf, mutation };
  }
  if (r < MUTATION_CHANCE + TINT_CHANCE) {
    const [name, color] = pick(rand, LEAF_TINTS);
    return { ...sp, name: named(name), rare: 'tint', leaf: color(rand) };
  }
  return sp;
};

// What rare leaves add to a plant's price.
export const rarePrice = (sp) => (sp.rare === 'mutation' ? 30 : sp.rare === 'tint' ? 6 : 0);

// A random plant species: how it grows node by node and what its leaves and flowers look like.
export const makeSpecies = (rand) => {
  const red = rand() < 0.2;
  const sp = {
    name: pick(rand, PLANT_NAMES),
    stem: { h: red ? range(rand, 345, 365) : range(rand, 85, 125), s: range(rand, 35, 60), l: range(rand, 26, 38) },
    leaf: { h: red ? range(rand, 340, 375) : range(rand, 80, 140), s: range(rand, 40, 70), l: range(rand, 30, 48) },
    shape: pick(rand, LEAF_SHAPES),
    leafSize: range(rand, 0.8, 1.6),
    internode: range(rand, 5, 11), // px between nodes
    maxNodes: 6 + Math.floor(rand() * 8),
    branchChance: range(rand, 0.05, 0.3),
    wobble: range(rand, 0.15, 0.55), // radians of wander per node
    lean: (rand() - 0.5) * 0.5,
    speed: range(rand, 0.008, 0.02), // px per tick
    flower: makeFlower(rand),
    leafLife: range(rand, 120000, 240000), // ticks a leaf lasts before it yellows and drops
  };
  return rareLeaves(rand, sp);
};

// Clump plants grow a crown of leaves straight from the base instead of up a stem, plus flower stalks or runners
// once the crown is full. Each form has its own names, leaf shape and habit; colours and sizes vary within it.
// Lengths are px; leafWidth is half a leaf's width at its widest; fan is how far (radians) the outer leaves lean
// from upright; curl how much each few px of a leaf turns toward hanging down, so a leaf arches over; crown is how
// far either side of the middle leaves come out of the ground.
const CLUMP_FORMS = {
  // Big paddle leaves on long stalks, and now and then a stalk with an orange-crested bird of a flower.
  strelitzia: (rand) => ({
    name: pick(rand, ['Strelitzia', 'Bird of paradise', 'Crane flower']),
    leaf: { h: range(rand, 120, 150), s: range(rand, 25, 45), l: range(rand, 26, 34) },
    stem: { h: range(rand, 95, 125), s: range(rand, 25, 40), l: range(rand, 30, 38) },
    shape: 'paddle',
    leaves: 5 + Math.floor(rand() * 4),
    leafLen: range(rand, 38, 55),
    leafWidth: range(rand, 3.6, 5),
    petiole: range(rand, 0.4, 0.55),
    fan: range(rand, 0.3, 0.5),
    curl: range(rand, 0.01, 0.03),
    crown: 2,
    stripe: null,
    bands: false,
    stalks: 1 + Math.floor(rand() * 2),
    stalkLen: range(rand, 0.95, 1.1), // of leafLen
    stalkCurl: 0.01,
    flower: {
      kind: 'bird',
      size: range(rand, 1.3, 1.8),
      // Orange, or now and then yellow.
      crest:
        rand() < 0.15
          ? { h: 50, s: 90, l: 60 }
          : { h: range(rand, 22, 38), s: range(rand, 85, 95), l: range(rand, 52, 60) },
      tongue: { h: range(rand, 220, 245), s: range(rand, 60, 80), l: range(rand, 45, 58) },
      beak: { h: range(rand, 110, 140), s: range(rand, 25, 40), l: range(rand, 28, 36) },
      blush: { h: range(rand, 330, 350), s: range(rand, 35, 55), l: range(rand, 32, 42) },
    },
  }),
  // A tall tussock of grass that stays put (it doesn't spread), arching over like a fountain, with feathery plumes.
  tussock: (rand) => {
    const leaf = pick(rand, [
      () => ({ h: range(rand, 80, 120), s: range(rand, 35, 55), l: range(rand, 30, 40) }), // green
      () => ({ h: range(rand, 170, 200), s: range(rand, 12, 25), l: range(rand, 42, 50) }), // blue-grey
      () => ({ h: range(rand, 345, 372), s: range(rand, 25, 40), l: range(rand, 26, 34) }), // burgundy
      () => ({ h: range(rand, 45, 58), s: range(rand, 45, 60), l: range(rand, 40, 48) }), // golden
    ])();
    return {
      name: pick(rand, ['Pampas grass', 'Fountain grass', 'Feather grass', 'Miscanthus', 'Muhly grass', 'Oat grass']),
      leaf,
      stem: { h: range(rand, 38, 50), s: range(rand, 25, 40), l: range(rand, 50, 60) },
      shape: 'blade',
      leaves: 14 + Math.floor(rand() * 9),
      leafLen: range(rand, 35, 60),
      leafWidth: range(rand, 0.5, 0.8),
      petiole: 0,
      fan: range(rand, 0.3, 0.55),
      curl: range(rand, 0.025, 0.06),
      crown: 3,
      stripe: null,
      bands: false,
      stalks: 2 + Math.floor(rand() * 4),
      stalkLen: range(rand, 1.1, 1.35),
      stalkCurl: range(rand, 0.02, 0.05),
      flower: {
        kind: 'plume',
        size: range(rand, 0.8, 1.3),
        color: pick(rand, [
          { h: 40, s: 40, l: 75 }, // buff
          { h: 45, s: 30, l: 85 }, // cream
          { h: 340, s: 45, l: 75 }, // pink
          { h: 290, s: 30, l: 58 }, // purple
          { h: 20, s: 45, l: 55 }, // rust
        ]),
      },
    };
  },
  // A rosette of arching striped leaves that sends out runners: they arch out and hang down with little white
  // flowers along them and a baby plant at the end.
  spider: (rand) => {
    const cream = { h: range(rand, 50, 60), s: range(rand, 35, 50), l: range(rand, 82, 90) };
    const r = rand();
    return {
      name: pick(rand, ['Spider plant', 'Chlorophytum', 'Airplane plant', 'Ribbon plant', 'Hen and chickens']),
      leaf: { h: range(rand, 90, 120), s: range(rand, 40, 60), l: range(rand, 34, 44) },
      stem: { h: range(rand, 60, 75), s: range(rand, 30, 45), l: range(rand, 58, 66) },
      shape: 'strap',
      leaves: 9 + Math.floor(rand() * 6),
      leafLen: range(rand, 18, 30),
      leafWidth: range(rand, 1, 1.5),
      petiole: 0,
      fan: range(rand, 0.5, 0.8),
      curl: range(rand, 0.12, 0.22),
      crown: 1.5,
      stripe: r < 0.55 ? { where: 'centre', ...cream } : r < 0.8 ? { where: 'edge', ...cream } : null,
      bands: false,
      stalks: 2 + Math.floor(rand() * 3),
      stalkLen: range(rand, 1.8, 2.8),
      stalkCurl: range(rand, 0.14, 0.22),
      flower: { kind: 'runner', size: range(rand, 0.8, 1.2), color: { h: 60, s: 20, l: 95 } },
    };
  },
  // Stiff upright sword leaves with wavy pale bands across them, sometimes yellow-edged.
  sword: (rand) => {
    const leaf = { h: range(rand, 100, 140), s: range(rand, 30, 50), l: range(rand, 22, 30) };
    return {
      name: pick(rand, ['Snake plant', 'Sansevieria', "Mother-in-law's tongue", 'Bowstring hemp']),
      leaf,
      stem: leaf,
      shape: 'sword',
      leaves: 5 + Math.floor(rand() * 5),
      leafLen: range(rand, 30, 52),
      leafWidth: range(rand, 1.4, 2.2),
      petiole: 0,
      fan: range(rand, 0.15, 0.35),
      curl: range(rand, 0, 0.02),
      crown: 3,
      stripe:
        rand() < 0.5 ? { where: 'edge', h: range(rand, 50, 60), s: range(rand, 60, 80), l: range(rand, 55, 65) } : null,
      bands: true,
      stalks: 0,
      stalkLen: 1,
      stalkCurl: 0,
      flower: null,
    };
  },

  // Common house plants. Each leaves out what it doesn't have (see CLUMP_DEFAULTS); shapes past the four above:
  // lance, heart, monstera (split heart) and coin blades on stalks, pinnate fronds (leaflets along a stalk), fleshy
  // succulent leaves, and cactus columns. pattern marks a blade: feather (dark bars), silver (patches), veins
  // (pale ones), spots (pale dots); teeth edge a fleshy leaf, tips colour its tip. premium adds to the price.

  // Glossy dark lance leaves on stalks, and white hooded flowers.
  peaceLily: (rand) => ({
    name: pick(rand, ['Peace lily', 'Spathiphyllum']),
    leaf: hsl(rand, [120, 145], [35, 50], [22, 30]),
    stem: hsl(rand, [100, 125], [30, 45], [28, 36]),
    shape: 'lance',
    leaves: 7 + Math.floor(rand() * 5),
    leafLen: range(rand, 28, 40),
    leafWidth: range(rand, 2.4, 3.2),
    petiole: range(rand, 0.35, 0.5),
    fan: range(rand, 0.4, 0.65),
    curl: range(rand, 0.03, 0.07),
    stalks: 1 + Math.floor(rand() * 3),
    stalkLen: range(rand, 1, 1.2),
    stalkCurl: 0.02,
    flower: {
      kind: 'spathe',
      hood: true,
      size: range(rand, 1, 1.4),
      spathe: { h: 60, s: 15, l: 94 },
      spadix: { h: 55, s: 45, l: 78 },
    },
  }),
  // Heart leaves on stalks, and glossy red (or pink, or white) hearts of flowers, each with a yellow spike.
  anthurium: (rand) => ({
    name: pick(rand, ['Anthurium', 'Flamingo flower', 'Laceleaf']),
    leaf: hsl(rand, [115, 140], [35, 50], [24, 32]),
    stem: hsl(rand, [100, 125], [30, 45], [30, 38]),
    shape: 'heart',
    leaves: 5 + Math.floor(rand() * 4),
    leafLen: range(rand, 26, 36),
    leafWidth: range(rand, 3, 4),
    petiole: range(rand, 0.4, 0.55),
    fan: range(rand, 0.45, 0.7),
    curl: range(rand, 0.03, 0.06),
    stalks: 1 + Math.floor(rand() * 3),
    stalkLen: range(rand, 0.9, 1.1),
    stalkCurl: 0.03,
    flower: {
      kind: 'spathe',
      hood: false,
      size: range(rand, 1.1, 1.5),
      spathe: pick(rand, [
        { h: 355, s: 80, l: 45 },
        { h: 340, s: 60, l: 65 },
        { h: 10, s: 85, l: 50 },
        { h: 60, s: 15, l: 92 },
      ]),
      spadix: { h: 50, s: 70, l: 62 },
    },
    premium: 6,
  }),
  // Big split hearts on long stalks.
  monstera: (rand) => ({
    name: pick(rand, ['Monstera', 'Swiss cheese plant', 'Split-leaf philodendron']),
    leaf: hsl(rand, [120, 145], [35, 50], [22, 30]),
    stem: hsl(rand, [100, 120], [30, 45], [30, 38]),
    shape: 'monstera',
    leaves: 4 + Math.floor(rand() * 4),
    leafLen: range(rand, 36, 50),
    leafWidth: range(rand, 6, 7.5),
    petiole: range(rand, 0.5, 0.58),
    fan: range(rand, 0.5, 0.8),
    curl: range(rand, 0.04, 0.08),
    premium: 8,
  }),
  // Arrow-shaped leaves held up on long stalks, with pale veins.
  alocasia: (rand) => ({
    name: pick(rand, ['Alocasia', 'Elephant ear', 'African mask']),
    leaf: hsl(rand, [125, 160], [30, 45], [16, 24]),
    stem: hsl(rand, [95, 120], [25, 40], [32, 40]),
    shape: 'heart',
    pattern: 'veins',
    leaves: 3 + Math.floor(rand() * 3),
    leafLen: range(rand, 34, 48),
    leafWidth: range(rand, 3.6, 4.8),
    petiole: range(rand, 0.5, 0.62),
    fan: range(rand, 0.3, 0.55),
    curl: range(rand, 0.01, 0.03),
    premium: 6,
  }),
  // Patterned paddles: dark feathered bars either side of the midrib.
  calathea: (rand) => ({
    name: pick(rand, ['Calathea', 'Prayer plant', 'Rattlesnake plant', 'Peacock plant']),
    leaf: hsl(rand, [95, 130], [30, 45], [36, 44]),
    stem: hsl(rand, [90, 120], [25, 40], [30, 38]),
    shape: 'lance',
    pattern: 'feather',
    leaves: 6 + Math.floor(rand() * 5),
    leafLen: range(rand, 24, 34),
    leafWidth: range(rand, 2.6, 3.4),
    petiole: range(rand, 0.35, 0.45),
    fan: range(rand, 0.4, 0.7),
    curl: range(rand, 0.02, 0.05),
    premium: 4,
  }),
  // Lance leaves splashed with silver.
  aglaonema: (rand) => ({
    name: pick(rand, ['Chinese evergreen', 'Aglaonema']),
    leaf: hsl(rand, [110, 140], [30, 45], [24, 32]),
    stem: hsl(rand, [95, 120], [20, 35], [40, 48]),
    shape: 'lance',
    pattern: 'silver',
    leaves: 6 + Math.floor(rand() * 4),
    leafLen: range(rand, 22, 32),
    leafWidth: range(rand, 2.2, 3),
    petiole: range(rand, 0.25, 0.35),
    fan: range(rand, 0.4, 0.65),
    curl: range(rand, 0.04, 0.08),
  }),
  // Round coin leaves on long thin stalks, every way out from the middle.
  pilea: (rand) => ({
    name: pick(rand, ['Chinese money plant', 'Pilea', 'Pancake plant']),
    leaf: hsl(rand, [95, 120], [40, 55], [34, 42]),
    stem: hsl(rand, [90, 110], [30, 45], [38, 46]),
    shape: 'coin',
    leaves: 8 + Math.floor(rand() * 6),
    leafLen: range(rand, 18, 24),
    leafWidth: range(rand, 3, 3.8),
    petiole: range(rand, 0.6, 0.68),
    fan: range(rand, 0.7, 1.1),
    curl: range(rand, 0.02, 0.05),
    crown: 1,
  }),
  // Upright stalks of paired glossy oval leaflets.
  zz: (rand) => ({
    name: pick(rand, ['ZZ plant', 'Zanzibar gem', 'Zamioculcas']),
    leaf: hsl(rand, [120, 145], [40, 55], [22, 30]),
    stem: hsl(rand, [100, 125], [35, 50], [26, 34]),
    shape: 'pinnate',
    leaflet: { len: range(rand, 3.5, 5), width: range(rand, 1.6, 2.2), spacing: range(rand, 4, 5), angle: 0.9 },
    leaves: 5 + Math.floor(rand() * 4),
    leafLen: range(rand, 26, 40),
    leafWidth: 1,
    petiole: range(rand, 0.15, 0.25),
    fan: range(rand, 0.25, 0.45),
    curl: range(rand, 0.01, 0.03),
  }),
  // Arching fronds thick with little leaflets.
  fern: (rand) => ({
    name: pick(rand, ['Boston fern', 'Sword fern', 'Bird\'s nest fern', 'Asparagus fern']),
    leaf: hsl(rand, [85, 115], [45, 60], [32, 42]),
    stem: hsl(rand, [85, 110], [35, 50], [28, 36]),
    shape: 'pinnate',
    leaflet: { len: range(rand, 2.5, 4), width: 1, spacing: 2, angle: range(rand, 0.9, 1.2), droop: 0.2 },
    leaves: 12 + Math.floor(rand() * 7),
    leafLen: range(rand, 22, 36),
    leafWidth: 1,
    petiole: 0.1,
    fan: range(rand, 0.6, 0.9),
    curl: range(rand, 0.1, 0.18),
  }),
  // A few long arching fronds on bare stems, the leaflets long and narrow and drooping.
  palm: (rand) => ({
    name: pick(rand, ['Parlor palm', 'Areca palm', 'Kentia palm', 'Majesty palm']),
    leaf: hsl(rand, [95, 130], [35, 50], [30, 38]),
    stem: hsl(rand, [80, 105], [30, 45], [32, 40]),
    shape: 'pinnate',
    leaflet: {
      len: range(rand, 5, 8),
      width: 1,
      spacing: range(rand, 2, 3),
      angle: range(rand, 0.5, 0.7),
      droop: 0.5,
    },
    leaves: 4 + Math.floor(rand() * 4),
    leafLen: range(rand, 38, 56),
    leafWidth: 1,
    petiole: range(rand, 0.25, 0.35),
    fan: range(rand, 0.3, 0.55),
    curl: range(rand, 0.05, 0.1),
    premium: 4,
  }),
  // Thick, fleshy, toothed leaves, often spotted, and now and then a tall spike of orange tubes.
  aloe: (rand) => ({
    name: pick(rand, ['Aloe vera', 'Aloe', 'Tiger aloe']),
    leaf: hsl(rand, [120, 150], [15, 30], [36, 46]),
    stem: hsl(rand, [100, 130], [15, 25], [40, 48]),
    shape: 'fleshy',
    pattern: rand() < 0.6 ? 'spots' : null,
    teeth: true,
    leaves: 7 + Math.floor(rand() * 5),
    leafLen: range(rand, 20, 30),
    leafWidth: range(rand, 2, 2.8),
    fan: range(rand, 0.4, 0.7),
    curl: range(rand, 0.03, 0.08),
    stalks: rand() < 0.6 ? 1 : 0,
    stalkLen: range(rand, 1.6, 2.1),
    stalkCurl: 0.01,
    flower: { kind: 'bells', size: 1, color: { h: range(rand, 15, 30), s: 85, l: 55 } },
  }),
  // A low rosette of plump pointed leaves, blue-grey and blushing at the tips, and an arching spray of coral bells.
  echeveria: (rand) => ({
    name: pick(rand, ['Echeveria', 'Mexican snowball', 'Painted lady']),
    leaf: hsl(rand, [150, 190], [15, 30], [52, 62]),
    stem: hsl(rand, [100, 140], [20, 30], [42, 50]),
    shape: 'fleshy',
    tips: hsl(rand, [330, 360], [40, 60], [60, 70]),
    leaves: 14 + Math.floor(rand() * 7),
    leafLen: range(rand, 7, 11),
    leafWidth: range(rand, 1.6, 2.2),
    fan: range(rand, 1, 1.35),
    curl: range(rand, 0.02, 0.06),
    crown: 1,
    stalks: 1 + Math.floor(rand() * 2),
    stalkLen: range(rand, 2.2, 3),
    stalkCurl: range(rand, 0.1, 0.16),
    flower: { kind: 'bells', size: 0.9, color: { h: range(rand, 5, 25), s: 75, l: 62 } },
  }),
  // A few broad leaves low down, and a tall arching spike of flowers.
  orchid: (rand) => {
    const h = pick(rand, [300, 320, 340, 60, 280]);
    return {
      name: pick(rand, ['Moth orchid', 'Phalaenopsis', 'Orchid']),
      leaf: hsl(rand, [110, 140], [30, 45], [26, 34]),
      stem: hsl(rand, [90, 120], [20, 35], [32, 40]),
      shape: 'strap',
      leaves: 3 + Math.floor(rand() * 3),
      leafLen: range(rand, 14, 20),
      leafWidth: range(rand, 2.6, 3.4),
      fan: range(rand, 0.9, 1.2),
      curl: range(rand, 0.12, 0.2),
      stalks: 1 + Math.floor(rand() * 2),
      stalkLen: range(rand, 2.4, 3.2),
      stalkCurl: range(rand, 0.06, 0.1),
      flower: {
        kind: 'orchid',
        size: range(rand, 1, 1.3),
        count: 4 + Math.floor(rand() * 4),
        petal: h === 60 ? { h: 60, s: 15, l: 94 } : { h, s: range(rand, 45, 70), l: range(rand, 72, 84) },
        lip: { h: h === 60 ? 330 : h, s: 60, l: 45 },
      },
      premium: 10,
    };
  },
  // A rosette of glossy straps around a bright cone of bracts.
  bromeliad: (rand) => ({
    name: pick(rand, ['Bromeliad', 'Guzmania', 'Urn plant']),
    leaf: hsl(rand, [110, 140], [40, 55], [28, 36]),
    stem: hsl(rand, [100, 130], [35, 50], [30, 38]),
    shape: 'strap',
    leaves: 10 + Math.floor(rand() * 6),
    leafLen: range(rand, 20, 28),
    leafWidth: range(rand, 1.3, 1.8),
    fan: range(rand, 0.6, 0.9),
    curl: range(rand, 0.08, 0.14),
    crown: 1,
    stalks: 1,
    stalkLen: range(rand, 0.7, 0.9),
    stalkCurl: 0,
    flower: {
      kind: 'bract',
      size: range(rand, 1, 1.3),
      color: pick(rand, [
        { h: 355, s: 80, l: 50 },
        { h: 25, s: 90, l: 55 },
        { h: 50, s: 90, l: 55 },
        { h: 330, s: 70, l: 60 },
      ]),
    },
    premium: 4,
  }),
  // A few thick ribbed columns, covered in spines.
  cactus: (rand) => ({
    name: pick(rand, ['Cactus', 'Fairy castle', 'Old man cactus', 'Totem pole cactus']),
    leaf: hsl(rand, [105, 140], [30, 45], [26, 34]),
    stem: hsl(rand, [100, 130], [25, 40], [30, 36]),
    shape: 'column',
    spines: hsl(rand, [40, 60], [20, 40], [75, 88]),
    leaves: 1 + Math.floor(rand() * 4),
    leafLen: range(rand, 18, 40),
    leafWidth: range(rand, 2.6, 3.6),
    fan: range(rand, 0.12, 0.3),
    curl: 0,
    crown: 2,
  }),
};

const CLUMP_KINDS = Object.keys(CLUMP_FORMS);

// What a clump plant has unless its form says otherwise.
const CLUMP_DEFAULTS = {
  petiole: 0,
  crown: 2,
  stripe: null,
  bands: false,
  pattern: null,
  teeth: false,
  tips: null,
  stalks: 0,
  stalkLen: 1,
  stalkCurl: 0,
  flower: null,
  premium: 0,
};

// A random clump plant species.
export const makeClump = (rand) => {
  const form = pick(rand, CLUMP_KINDS);
  const sp = { form, speed: range(rand, 0.012, 0.022), ...CLUMP_DEFAULTS, ...CLUMP_FORMS[form](rand) };
  return rareLeaves(rand, sp);
};

// Wallpaper styles: [key, label, detail (1..5, sets the price), smallest and largest pattern size in px]. Patterns
// first, then scenes.
const WALLPAPER_STYLES = [
  ['stripes', 'stripes', 1, 3, 7],
  ['dots', 'dots', 1, 6, 11],
  ['diagonal', 'diagonals', 1, 3, 6],
  ['gingham', 'gingham', 2, 4, 9],
  ['waves', 'waves', 2, 4, 8],
  ['scales', 'scales', 2, 6, 10],
  ['brick', 'brick', 3, 4, 7],
  ['plaid', 'plaid', 3, 4, 7],
  ['argyle', 'argyle', 3, 6, 10],
  ['herringbone', 'herringbone', 3, 4, 7],
  ['dusk', 'dusk', 4, 1, 1],
  ['hills', 'hills', 5, 1, 1],
  ['winter', 'winter', 5, 1, 1],
  ['forest', 'forest', 5, 1, 1],
  ['mountains', 'mountains', 5, 1, 1],
  ['desert', 'desert', 4, 1, 1],
  ['ocean', 'ocean', 4, 1, 1],
  ['aurora', 'aurora', 5, 1, 1],
  ['city', 'city', 5, 1, 1],
  ['space', 'space', 4, 1, 1],
  ['jungle', 'jungle', 5, 1, 1],
  ['fungal', 'fungal forest', 5, 1, 1],
];
const HUE_NAMES = [
  [20, 'Wine'], [45, 'Umber'], [70, 'Olive'], [150, 'Forest'], [190, 'Teal'], [240, 'Navy'], [280, 'Indigo'],
  [330, 'Plum'], [360, 'Wine'],
];

// Themed scenes have their own names and colours: base (the darkest of the sky), accent (lighter sky, hills,
// snow) and glow (a moon or sun, lit windows, a planet).
const hsl = (rand, [h0, h1], [s0, s1], [l0, l1]) => ({
  h: range(rand, h0, h1),
  s: range(rand, s0, s1),
  l: range(rand, l0, l1),
});
// c, a little lighter: hue within dh, lightness up by dl ([lo, hi]), saturation up by ds.
const lighter = (rand, c, dh, dl, ds = 0) => ({
  h: c.h + range(rand, -dh, dh),
  s: c.s + ds,
  l: c.l + range(rand, ...dl),
});
const THEMES = {
  winter: {
    names: ['Snowy night', 'Winter hills', 'First snow'],
    palette: (r) => {
      const base = hsl(r, [212, 230], [30, 45], [7, 11]);
      return { base, accent: lighter(r, base, 10, [9, 13], -10), glow: { h: 50, s: 30, l: 60 } };
    },
  },
  forest: {
    names: ['Pine forest', 'Evergreens', 'Woodland dusk'],
    palette: (r) => {
      const base = hsl(r, [150, 200], [25, 40], [8, 12]);
      return { base, accent: lighter(r, base, 10, [5, 8], 5), glow: hsl(r, [45, 55], [35, 50], [50, 60]) };
    },
  },
  mountains: {
    names: ['Mountain dusk', 'High peaks', 'Alpine night'],
    palette: (r) => {
      const base = hsl(r, [230, 280], [25, 40], [8, 12]);
      return { base, accent: lighter(r, base, 20, [6, 9]), glow: { h: 50, s: 40, l: 55 } };
    },
  },
  desert: {
    names: ['Desert dunes', 'Sand sea', 'Dune moon'],
    palette: (r) => {
      const base = hsl(r, [15, 35], [30, 45], [9, 13]);
      return { base, accent: lighter(r, base, 8, [6, 9], 8), glow: hsl(r, [38, 50], [50, 70], [42, 52]) };
    },
  },
  ocean: {
    names: ['Deep sea', 'Coral sea', 'Kelp forest'],
    palette: (r) => {
      const base = hsl(r, [192, 215], [45, 65], [8, 12]);
      return { base, accent: lighter(r, base, 10, [6, 9], 5), glow: hsl(r, [170, 190], [30, 45], [30, 40]) };
    },
  },
  aurora: {
    names: ['Aurora', 'Northern lights', 'Polar night'],
    palette: (r) => {
      const base = hsl(r, [220, 240], [30, 45], [6, 9]);
      const accent = r() < 0.7 ? hsl(r, [120, 170], [50, 70], [16, 20]) : hsl(r, [280, 320], [45, 65], [16, 20]);
      return { base, accent, glow: { h: 60, s: 20, l: 70 } };
    },
  },
  city: {
    names: ['City lights', 'Skyline', 'Night city'],
    palette: (r) => {
      const base = hsl(r, [228, 262], [25, 40], [8, 12]);
      return { base, accent: lighter(r, base, 10, [5, 8]), glow: hsl(r, [38, 52], [65, 85], [42, 52]) };
    },
  },
  space: {
    names: ['Starfield', 'Nebula', 'Ringed planet'],
    palette: (r) => {
      const base = hsl(r, [240, 290], [20, 35], [5, 8]);
      const accent = hsl(r, [0, 360], [40, 60], [13, 17]);
      return { base, accent, glow: hsl(r, [0, 360], [30, 50], [25, 35]) };
    },
  },
  jungle: {
    names: ['Jungle', 'Rainforest', 'Monstera'],
    palette: (r) => {
      const base = hsl(r, [118, 160], [30, 45], [7, 10]);
      return { base, accent: lighter(r, base, 15, [5, 8], 10), glow: { h: 70, s: 40, l: 30 } };
    },
  },
  fungal: {
    names: ['Fungal forest', 'Mushroom grove', 'Glowcap wood'],
    palette: (r) => {
      const base = hsl(r, [230, 290], [25, 40], [7, 10]);
      // The glow: blue-green, lime or magenta.
      const glow = [
        () => hsl(r, [165, 195], [55, 75], [40, 50]),
        () => hsl(r, [85, 120], [50, 70], [38, 48]),
        () => hsl(r, [290, 320], [45, 65], [45, 55]),
      ][Math.floor(r() * 3)]();
      return { base, accent: lighter(r, base, 15, [5, 8], 5), glow };
    },
  },
};

const VIVID_CHANCE = 0.07; // now and then a wallpaper comes in intense colours, and costs more

// A random wallpaper for the back of the tank: a style and its colours, kept dim so whatever is in the tank still
// stands out against it (unless it's a rare vivid one). seed places the stars, hills, trees and so on.
export const makeWallpaper = (rand) => {
  const [style, label, detail, lo, hi] = pick(rand, WALLPAPER_STYLES);
  const theme = THEMES[style];
  let { base, accent, glow } = theme?.palette(rand) ?? {};
  if (!theme) {
    const h = rand() * 360;
    base = { h, s: range(rand, 15, 45), l: range(rand, 7, 12) };
    accent = { h: h + range(rand, -40, 40), s: base.s + range(rand, 0, 15), l: base.l + range(rand, 4, 7) };
  }
  const name = theme ? pick(rand, theme.names) : `${HUE_NAMES.find(([upTo]) => base.h < upTo)[1]} ${label}`;
  const size = lo + Math.floor(rand() * (hi - lo + 1));
  const seed = Math.floor(rand() * 2 ** 31);
  const vivid = rand() < VIVID_CHANCE;
  if (vivid) {
    base = { ...base, s: Math.max(base.s, range(rand, 60, 85)), l: base.l + range(rand, 8, 13) };
    accent = { ...accent, s: range(rand, 70, 95), l: base.l + range(rand, 9, 14) };
    glow &&= { ...glow, s: Math.min(100, glow.s + 25), l: Math.min(80, glow.l + 10) };
  }
  return { style, name: vivid ? `Vivid ${name.toLowerCase()}` : name, detail, vivid, size, base, accent, glow, seed };
};

const GRASS_NAMES = ['Fescue', 'Bluegrass', 'Sedge', 'Clover', 'Ryegrass', 'Moss', 'Bent grass', 'Hair grass'];

// A grass genome: what its blades look like and how fast it spreads across dirt or sand, tuft by tuft. Some grasses
// carry seed heads, some little clover-like blossoms.
export const makeGrass = (rand) => {
  const autumn = rand() < 0.15;
  return {
    name: pick(rand, GRASS_NAMES),
    blade: { h: autumn ? range(rand, 35, 55) : range(rand, 80, 135), s: range(rand, 35, 70), l: range(rand, 26, 40) },
    tipLight: range(rand, 6, 22), // blades lighten toward the tip
    height: range(rand, 3, 10), // px
    blades: 2 + Math.floor(rand() * 4), // per tuft
    fan: range(rand, 0.15, 0.5), // radians between blades
    lean: (rand() - 0.5) * 0.6,
    spacing: range(rand, 2, 5), // px between tufts
    spread: range(rand, 0.002, 0.012), // chance per tick that a grown tuft seeds a neighbour
    seeds: rand() < 0.4 ? { h: range(rand, 30, 60), s: range(rand, 30, 60), l: range(rand, 55, 75) } : null,
    blossom: rand() < 0.25 ? { h: rand() * 360, s: range(rand, 50, 80), l: range(rand, 65, 85) } : null,
  };
};

const VINE_NAMES = ['Ivy', 'Pothos', 'String of pearls', 'Creeping jenny', 'Wisteria', 'Morning glory', 'Hoya'];

// A hanging vine genome: stem and leaves (sometimes variegated), how far apart its nodes are, how long it gets
// and how fast, how stiffly it hangs, and whether it flowers every few nodes.
export const makeVine = (rand) => ({
  name: pick(rand, VINE_NAMES),
  stem: { h: range(rand, 70, 120), s: range(rand, 25, 50), l: range(rand, 22, 34) },
  leaf: { h: range(rand, 80, 150), s: range(rand, 35, 70), l: range(rand, 28, 46) },
  variegated: rand() < 0.3,
  shape: pick(rand, ['round', 'heart', 'long', 'pearl', 'oak']),
  leafSize: range(rand, 0.6, 1.4),
  spacing: range(rand, 3, 6), // px between nodes
  maxNodes: 10 + Math.floor(rand() * 30),
  growTicks: range(rand, 60, 180), // per new node
  stiffness: range(rand, 0.3, 0.9), // how much it resists the breeze
  flower:
    rand() < 0.45
      ? { h: rand() * 360, s: range(rand, 55, 90), l: range(rand, 55, 78), every: 2 + Math.floor(rand() * 5) }
      : null,
});

