// Random plant genomes for the shop: flowering species (how they grow node by node, their leaves and flowers), now and
// then with rare leaves (tinted or mutated); grasses; and hanging vines. Pure generators.
import { pick, range } from './geom.js';
import { LEAF_SHAPES } from './sticks.js';

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
export const rareLeaves = (rand, sp) => {
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
