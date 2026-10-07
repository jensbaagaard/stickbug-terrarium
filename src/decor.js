// Random decorations for the shop: sticks, plant genomes and wallpapers. Pure generators; sim.js turns their
// shapes into surfaces. Colours are {h, s, l}.
import { add, pick } from './geom.js';

const range = (rand, lo, hi) => lo + rand() * (hi - lo);
const dirOf = (a) => ({ x: Math.cos(a), y: Math.sin(a) });

const WOODS = [
  ['Oak', (r) => ({ h: range(r, 22, 34), s: range(r, 30, 45), l: range(r, 22, 32) })],
  ['Driftwood', (r) => ({ h: range(r, 28, 40), s: range(r, 8, 15), l: range(r, 45, 58) })],
  ['Birch', (r) => ({ h: 40, s: range(r, 6, 10), l: range(r, 70, 80) })],
  ['Redbark', (r) => ({ h: range(r, 10, 20), s: range(r, 35, 45), l: range(r, 24, 32) })],
];

// A random wood: its name and colour.
export const makeWood = (rand) => {
  const [name, color] = pick(rand, WOODS);
  return { name, ...color(rand) };
};

export const LEAF_SHAPES = ['round', 'long', 'needle', 'heart', 'oak', 'fan'];

// The leaves on the drawn-in branches.
export const DEFAULT_FOLIAGE = { shape: 'round', size: 1.4, color: { h: 135, s: 39, l: 40 }, moss: false, knots: true };

// A stick's foliage: what its leaves look like (now and then in autumn colours), and whether its bark has
// knots or moss.
export const makeFoliage = (rand) => {
  const autumn = rand() < 0.15;
  return {
    shape: pick(rand, ['round', 'long', 'heart', 'oak', 'fan']),
    size: range(rand, 1.1, 2.2),
    color: { h: autumn ? range(rand, 8, 48) : range(rand, 75, 150), s: range(rand, 35, 70), l: range(rand, 28, 48) },
    moss: rand() < 0.35,
    knots: rand() < 0.6,
  };
};

// Keep a direction leaning between lo and hi radians above horizontal, on the same side (left or right):
// steep enough to look like a stick, shallow enough for a bug to walk up.
const lean = (a, lo, hi) => {
  const side = Math.cos(a) < 0 ? -1 : 1;
  const rise = Math.min(Math.max(Math.atan2(-Math.sin(a), Math.abs(Math.cos(a))), lo), hi);
  return Math.atan2(-Math.sin(rise), side * Math.cos(rise));
};
const DEG = Math.PI / 180;

// A random stick standing on base: a crooked main limb in a few pieces, leaning toward the roomier side, with
// twigs forking off its joints. Pieces are {a, b, parent} with parent an index into pieces (-1 for the base).
// The whole stick shrinks toward its base if it would poke out of the tank (W by H).
export const makeStick = (rand, base, W, H) => {
  const pieces = [];
  const twig = (from, angle, len, parent, depth) => {
    const a = lean(angle + (rand() < 0.5 ? -1 : 1) * range(rand, 0.35, 0.7), 10 * DEG, 60 * DEG);
    const l = len * range(rand, 0.5, 0.9);
    const b = add(from, dirOf(a), l);
    pieces.push({ a: from, b, parent, depth });
    if (depth < 2 && rand() < 0.35) twig(b, a, l * 0.7, pieces.length - 1, depth + 1);
  };
  // Mostly lean into the open; near a wall, always.
  const roomy = W - base.x > base.x ? 1 : -1;
  const side = Math.min(base.x, W - base.x) > W * 0.3 && rand() < 0.2 ? -roomy : roomy;
  const rise = range(rand, 28, 55) * DEG;
  let angle = Math.atan2(-Math.sin(rise), side * Math.cos(rise));
  const n = 3 + Math.floor(rand() * 3);
  const total = H * range(rand, 0.3, 0.55);
  const bushy = range(rand, 0.4, 0.9); // how keen it is to fork
  let at = base;
  let parent = -1;
  for (let i = 0; i < n; i++) {
    const len = (total / n) * range(rand, 0.8, 1.2);
    const b = add(at, dirOf(angle), len);
    pieces.push({ a: at, b, parent, depth: 0 });
    parent = pieces.length - 1;
    // Twigs off the joints (sometimes a pair), and usually a little fork at the very end.
    const last = i === n - 1;
    const twigs = rand() < (last ? 0.7 : bushy) ? (rand() < (last ? 0.6 : 0.3) ? 2 : 1) : 0;
    for (let k = 0; k < twigs; k++) twig(b, angle, len * (last ? 0.8 : 1.1), parent, 1);
    at = b;
    angle = lean(angle + (rand() - 0.5) * 0.4, 15 * DEG, 60 * DEG);
  }
  // Shrink toward the base until every point is inside the tank.
  let k = 1;
  for (const p of pieces) {
    const { x, y } = p.b;
    if (x < 2) k = Math.min(k, (base.x - 2) / (base.x - x));
    if (x > W - 3) k = Math.min(k, (W - 3 - base.x) / (x - base.x));
    if (y < 4) k = Math.min(k, (base.y - 4) / (base.y - y));
  }
  const fit = (p) => ({ x: base.x + (p.x - base.x) * k, y: base.y + (p.y - base.y) * k });
  return {
    pieces: pieces.map((p) => ({ ...p, a: fit(p.a), b: fit(p.b) })),
    wood: makeWood(rand),
    foliage: makeFoliage(rand),
  };
};

const PLANT_NAMES = [
  'Rotala', 'Ludwigia', 'Pilea', 'Fittonia', 'Peperomia', 'Hygrophila', 'Bacopa', 'Tradescantia',
  'Selaginella', 'Creeping fig', 'Pothos', 'Begonia', 'Cosmos', 'Campanula', 'Primula', 'Lavender',
];
export const FLOWER_FORMS = ['daisy', 'star', 'bell', 'tulip', 'cluster', 'spike', 'pom'];

// A flower genome: its form, how many petals and how big, colours from petal base to tip, the centre, and
// sometimes a second ring of petals inside the first. nodeBloom is the chance a node flowers too, not just
// the tips.
export const makeFlower = (rand) => {
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

// A random plant species: how it grows node by node and what its leaves and flowers look like.
export const makeSpecies = (rand) => {
  const red = rand() < 0.2;
  return {
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
  };
};

// Wallpaper styles: [key, label, detail (1..5, sets the price), smallest and largest pattern size in px].
export const WALLPAPER_STYLES = [
  ['stripes', 'stripes', 1, 3, 7],
  ['dots', 'dots', 1, 6, 11],
  ['gingham', 'gingham', 2, 4, 9],
  ['waves', 'waves', 2, 4, 8],
  ['brick', 'brick', 3, 4, 7],
  ['dusk', 'dusk', 4, 1, 1],
  ['hills', 'hills', 5, 1, 1],
];
const HUE_NAMES = [
  [20, 'Wine'], [45, 'Umber'], [70, 'Olive'], [150, 'Forest'], [190, 'Teal'], [240, 'Navy'], [280, 'Indigo'],
  [330, 'Plum'], [360, 'Wine'],
];

// A random wallpaper for the back of the tank: a style and two dark colours, kept dim so whatever is in the
// tank still stands out against it. seed places the stars and hills.
export const makeWallpaper = (rand) => {
  const [style, label, detail, lo, hi] = pick(rand, WALLPAPER_STYLES);
  const h = rand() * 360;
  const base = { h, s: range(rand, 15, 45), l: range(rand, 7, 12) };
  const accent = { h: h + range(rand, -40, 40), s: base.s + range(rand, 0, 15), l: base.l + range(rand, 4, 7) };
  const hue = HUE_NAMES.find(([upTo]) => h < upTo)[1];
  return {
    style,
    name: `${hue} ${label}`,
    detail,
    size: lo + Math.floor(rand() * (hi - lo + 1)),
    base,
    accent,
    seed: Math.floor(rand() * 2 ** 31),
  };
};

const GRASS_NAMES = ['Fescue', 'Bluegrass', 'Sedge', 'Clover', 'Ryegrass', 'Moss', 'Bent grass', 'Hair grass'];

// A grass genome: what its blades look like and how fast it spreads across dirt, tuft by tuft. Some grasses
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

