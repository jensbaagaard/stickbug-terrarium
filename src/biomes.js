// Biomes: what kind of place the tank is, read from what it's made of. Mostly sand and sandstone is a desert, with a
// pond an oasis; snow and ice a tundra; basalt volcanic; dirt and water a wetland; and so on. Each biome has its own
// goings-on (tumbleweeds and dust devils, snow flurries, embers and steam, dripping overhangs, will-o'-the-wisps, rain,
// mushrooms, seed fluff, jellyfish), and very rarely a wild flower of its own seeds itself, one of a kind: a white
// lotus on the desert sand. The goings-on draw on their own random numbers, so they never reshuffle anything else, and
// like the visitors they aren't saved; a wild flower is a plant like any other, and which have turned up is kept.
// Pure data + functions, like the rest of the simulation.
import { pick } from './geom.js';
import {
  BASALT,
  BROWNSTONE,
  CELL,
  cellAt,
  DIRT,
  EMPTY,
  FOUNTAIN,
  ICE,
  SAND,
  SANDSTONE,
  SNOW,
  STONE,
  WATER,
  WOOD,
} from './terrain.js';
import { LET_UP, ripple, wind } from './life.js';
import { params } from './tuning.js';

const SURVEY_TICKS = 120; // how often the tank is looked over again
const LAND = 0.04; // share of the grid the ground must fill for the tank to take its character from it
const WILD_TICKS = 600; // how often a wild flower might seed itself
const WILD_CHANCE = 0.02; // then, with the slider in the middle: about once in eight minutes, where it can
const WILD_WORTH = 4; // a wild flower's clippings sell for this many times a common plant's
const NEWS_TICKS = 480; // how long news shows

// ---------- looking the tank over ----------

const ROCK = (m) => m === STONE || m === BASALT || m === SANDSTONE || m === BROWNSTONE;

// What the tank is made of: how many cells of each material (count), the ground (every cell but air, water and
// fountains), the share of its open space that's water (wet), its plants, grass and vines (green, grass) and sticks;
// and where things can happen: along the top of every column, the first water or ground going down (surface), the
// ground under any water (y), how deep the water there is (depth) and what the ground is (m, null for the tank
// floor); basalt open to the air (embers), water lapping at basalt (steam), and the undersides of overhanging rock
// (drips). Worked out afresh every couple of seconds.
const surveys = new WeakMap();
export const surveyOf = (world) => {
  const known = surveys.get(world);
  if (known && world.time >= known.at && world.time - known.at < SURVEY_TICKS) return known;
  const { cells, cols, rows, top } = world.terrain;
  const count = new Array(16).fill(0);
  for (const m of cells) count[m]++;
  const tops = [];
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows && cells[r * cols + c] === EMPTY) r++;
    const surface = top + r * CELL;
    while (r < rows && cells[r * cols + c] === WATER) r++;
    const y = top + r * CELL;
    tops.push({ x: c * CELL + CELL / 2, y, surface, depth: y - surface, m: r < rows ? cells[r * cols + c] : null });
  }
  const [embers, steam, drips] = [[], [], []];
  for (let r = 1; r < rows - 2; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c;
      const m = cells[i];
      const at = () => ({ x: c * CELL + CELL / 2, y: top + r * CELL });
      if (m === BASALT && cells[i - cols] === EMPTY) embers.push(at());
      if (m === WATER && cells[i - cols] === EMPTY && [cells[i - 1], cells[i + 1], cells[i + cols]].includes(BASALT)) {
        steam.push(at());
      }
      if (ROCK(m) && cells[i + cols] === EMPTY && cells[i + 2 * cols] === EMPTY) {
        drips.push({ ...at(), y: top + (r + 1) * CELL });
      }
    }
  }
  const kinds = { plant: 0, grass: 0, vine: 0, stick: 0 };
  for (const o of world.objects) kinds[o.kind]++;
  const ground = cells.length - count[EMPTY] - count[WATER] - count[FOUNTAIN];
  const s = {
    at: world.time,
    count,
    ground,
    land: ground >= cells.length * LAND,
    wet: count[WATER] / (count[WATER] + count[EMPTY] || 1),
    green: kinds.plant + kinds.grass + kinds.vine,
    grass: kinds.grass,
    sticks: kinds.stick,
    tops,
    embers,
    steam,
    drips,
  };
  s.biome = BIOMES.find((b) => b.test(s));
  surveys.set(world, s);
  return s;
};

// The share of the ground that's any of these materials.
const share = (s, ...ms) => ms.reduce((a, m) => a + s.count[m], 0) / (s.ground || 1);

// The first water or ground going down at x, the y of it.
const surfaceAt = (s, x) => s.tops[Math.min(s.tops.length - 1, Math.max(0, Math.floor(x / CELL)))].surface;

// ---------- the biomes ----------

// Tested in turn, the first that fits is the tank's: [key, name, test, goings-on, wild flower, what it's like].
const BIOMES = [
  {
    key: 'sea',
    name: 'Sea',
    test: (s) => s.wet >= 0.6,
    goings: ['jellyfish'],
    wild: null,
    about: 'Mostly water. Jellyfish drift about in it.',
  },
  {
    key: 'volcanic',
    name: 'Volcanic',
    test: (s) => s.land && share(s, BASALT) >= 0.35,
    goings: ['embers', 'steam'],
    wild: 'fireLily',
    about: 'Mostly basalt. Embers rise off it, and steam where water meets it.',
  },
  {
    key: 'tundra',
    name: 'Tundra',
    test: (s) => s.land && share(s, SNOW, ICE) >= 0.4,
    goings: ['flurry'],
    wild: 'snowLotus',
    about: 'Mostly snow and ice. Now and then a flurry blows in.',
  },
  {
    key: 'oasis',
    name: 'Oasis',
    test: (s) => s.land && share(s, SAND, SANDSTONE) >= 0.45 && s.wet >= 0.04,
    goings: ['tumbleweed', 'dustDevil'],
    wild: 'blueLotus',
    about: 'Sand and sandstone round a pond. Tumbleweeds roll by and dust devils whirl.',
  },
  {
    key: 'desert',
    name: 'Desert',
    test: (s) => s.land && share(s, SAND, SANDSTONE) >= 0.45,
    goings: ['tumbleweed', 'dustDevil'],
    wild: 'whiteLotus',
    about: 'Mostly sand and sandstone. Tumbleweeds roll by and dust devils whirl.',
  },
  {
    key: 'canyon',
    name: 'Canyon',
    test: (s) => s.land && share(s, BROWNSTONE) >= 0.15 && share(s, BROWNSTONE, SANDSTONE, SAND) >= 0.45,
    goings: ['dustDevil', 'tumbleweed'],
    wild: 'paintbrush',
    about: 'Brownstone and sandstone. Dust devils whirl, and a tumbleweed now and then.',
  },
  {
    key: 'rainforest',
    name: 'Rainforest',
    test: (s) => s.green >= 10 && s.wet >= 0.05,
    goings: ['rain', 'mushrooms'],
    wild: 'corpseLily',
    about: 'Thick with plants, with water. It rains now and then, and mushrooms come up.',
  },
  {
    key: 'crags',
    name: 'Rocky crags',
    test: (s) => s.land && share(s, STONE, BASALT, SANDSTONE, BROWNSTONE) >= 0.55,
    goings: ['drips'],
    wild: 'edelweiss',
    about: 'Mostly rock. Water drips from its overhangs.',
  },
  {
    key: 'wetland',
    name: 'Wetland',
    test: (s) => s.land && s.wet >= 0.08 && share(s, DIRT) >= 0.3,
    goings: ['wisps', 'rain'],
    wild: 'pinkLotus',
    about: 'Dirt and water. Will-o-the-wisps hang over the water, and now and then it rains.',
  },
  {
    key: 'woodland',
    name: 'Woodland',
    test: (s) => (s.land && share(s, WOOD) >= 0.2) || (s.sticks >= 2 && s.green >= 4),
    goings: ['mushrooms'],
    wild: 'ghostOrchid',
    about: 'Wood, or sticks among the plants. Mushrooms come up.',
  },
  {
    key: 'meadow',
    name: 'Meadow',
    test: (s) => s.grass >= 2 || (s.land && share(s, DIRT) >= 0.35 && s.green >= 3),
    goings: ['fluff', 'mushrooms'],
    wild: 'goldenPoppy',
    about: 'Grass, or dirt and plants. Seed fluff drifts on the breeze, and a ring of mushrooms comes up now and then.',
  },
  { key: 'garden', name: 'Garden', test: (s) => s.green >= 1, goings: [], wild: null, about: 'A few plants.' },
  { key: 'bare', name: 'Bare tank', test: () => true, goings: [], wild: null, about: 'Nothing much yet.' },
];

// ---------- wild flowers ----------

const dry = (...ms) => (t) => !t.depth && ms.includes(t.m);
const shallows = (t) => t.depth >= 4 && t.depth <= 30; // rooted under the water, to grow up out of it
const soil = (t) => !t.depth && (t.m === DIRT || t.m === null);

// A lotus: a bowl of pointed petals round a seed pod, on a long stem with round leaves.
const lotus = (petal, tip, centre = { h: 52, s: 80, l: 55 }) => ({
  stem: { h: 92, s: 35, l: 34 },
  leaf: { h: 108, s: 40, l: 36 },
  shape: 'round',
  leafSize: 1.5,
  internode: 8,
  maxNodes: 6,
  branchChance: 0.04,
  flower: { form: 'lotus', petals: 9, size: 1.6, petalLen: 3.6, petalWidth: 1.8, petal, tip, centre, centreSize: 1.3 },
});

// Each biome's wild flower: where it can seed itself, and its look (a flowering plant's, with defaults filled in).
const WILD = {
  whiteLotus: {
    name: 'White lotus',
    where: dry(SAND, SANDSTONE),
    ...lotus({ h: 40, s: 25, l: 94 }, { h: 335, l: -10 }),
  },
  blueLotus: { name: 'Blue lotus', where: shallows, ...lotus({ h: 218, s: 70, l: 72 }, { h: 232, l: 8 }) },
  pinkLotus: { name: 'Pink lotus', where: shallows, ...lotus({ h: 338, s: 65, l: 82 }, { h: 330, l: -14 }) },
  snowLotus: {
    name: 'Snow lotus',
    where: dry(SNOW, ICE),
    ...lotus({ h: 75, s: 22, l: 86 }, { h: 60, l: 4 }, { h: 285, s: 45, l: 42 }),
    leaf: { h: 150, s: 12, l: 62 },
    maxNodes: 4,
  },
  fireLily: {
    name: 'Fire lily',
    where: dry(BASALT),
    flower: { form: 'star', petals: 6, size: 1.7, petalLen: 3.8, petalWidth: 1.6, petal: { h: 46, s: 95, l: 55 } },
    tip: { h: 2, l: -6 },
  },
  edelweiss: {
    name: 'Edelweiss',
    where: dry(STONE, BASALT, SANDSTONE, BROWNSTONE),
    flower: { form: 'star', petals: 9, size: 1.1, petalLen: 3, petalWidth: 1.6, petal: { h: 70, s: 12, l: 92 } },
    centre: { h: 52, s: 70, l: 62 },
    leaf: { h: 95, s: 14, l: 58 },
    shape: 'long',
    internode: 5,
    maxNodes: 4,
  },
  paintbrush: {
    name: 'Paintbrush',
    where: dry(BROWNSTONE, SANDSTONE, SAND),
    flower: { form: 'spike', petals: 8, size: 1.4, petalLen: 2.5, petalWidth: 1.8, petal: { h: 20, s: 85, l: 50 } },
    tip: { h: 0, l: 4 },
    leaf: { h: 100, s: 18, l: 44 },
    shape: 'long',
  },
  ghostOrchid: {
    name: 'Ghost orchid',
    where: dry(WOOD, DIRT),
    flower: { form: 'star', petals: 5, size: 1.8, petalLen: 5, petalWidth: 1, petal: { h: 90, s: 18, l: 93 } },
    centre: { h: 90, s: 25, l: 80 },
    leafSize: 0.5,
  },
  goldenPoppy: {
    name: 'Golden poppy',
    where: soil,
    flower: { form: 'tulip', petals: 4, size: 1.6, petalLen: 3, petalWidth: 2.2, petal: { h: 34, s: 95, l: 52 } },
    tip: { h: 46, l: 10 },
    leaf: { h: 150, s: 20, l: 46 },
    shape: 'fan',
  },
  corpseLily: {
    name: 'Corpse lily',
    where: soil,
    flower: { form: 'daisy', petals: 5, size: 2.4, petalLen: 3.5, petalWidth: 2.6, petal: { h: 4, s: 65, l: 36 } },
    tip: { h: 10, l: 8 },
    centre: { h: 15, s: 35, l: 20 },
    ring: { h: 30, s: 25, l: 78 },
    centreSize: 2.4,
    leafSize: 1.4,
  },
};

// A wild flower's species, ready to plant: one of a kind, worth more in clippings.
const wildSpecies = (world, key) => {
  const w = WILD[key];
  const r = world.biomeRand;
  const { tip = { h: w.flower.petal.h, l: -8 }, centre = { h: 50, s: 80, l: 50 }, ring = null } = w;
  return {
    name: w.name,
    wild: key,
    worth: WILD_WORTH,
    stem: w.stem ?? { h: 100, s: 40, l: 32 },
    leaf: w.leaf ?? { h: 112, s: 45, l: 38 },
    shape: w.shape ?? 'round',
    leafSize: w.leafSize ?? 1.1,
    internode: w.internode ?? 7,
    maxNodes: w.maxNodes ?? 6,
    branchChance: w.branchChance ?? 0.1,
    wobble: 0.2,
    lean: (r() - 0.5) * 0.3,
    speed: 0.014,
    flower: { tip, centre, ring, centreSize: 1.2, nodeBloom: 0, ...w.flower },
    leafLife: 200000,
  };
};

// The name of the wild flower of biome b, or ??? if it's not turned up yet.
const wildName = (world, b) => (world.found.includes(b.wild) ? WILD[b.wild].name : '???');

// Seed the biome's wild flower somewhere it can grow, unless there's one already (planted from a cutting counts):
// what to plant, for the simulation to put in, or null.
const sow = (world, s, key) => {
  const w = WILD[key];
  if (world.objects.some((o) => o.species?.wild === key)) return null;
  const clear = (t) => !world.objects.some((o) => Math.abs(o.base.x - t.x) < 10 && Math.abs(o.base.y - t.y) < 12);
  const spots = s.tops.filter((t) => w.where(t) && t.x > 6 && t.x < world.W - 6 && clear(t));
  if (!spots.length) return null;
  const t = pick(world.biomeRand, spots);
  if (!world.found.includes(key)) world.found.push(key);
  world.news = { text: `A ${w.name.toLowerCase()} is coming up!`, at: world.time };
  const stand = t.m === null ? { on: world.ground } : { on: null, hold: { x: t.x, y: t.y + CELL / 2 } };
  return { kind: 'plant', base: { x: t.x, y: t.y }, ...stand, species: wildSpecies(world, key) };
};

// ---------- goings-on ----------

const open = (world, x, y) => {
  const i = cellAt(world.terrain, x, y);
  return y < world.ground.y0 && (i < 0 || world.terrain.cells[i] === EMPTY);
};
const wetAt = (world, x, y) => world.terrain.cells[cellAt(world.terrain, x, y)] === WATER;
const fade = (h, inTicks = 60, outTicks = 120) => Math.min(1, h.age / inTicks, (h.life - h.age) / outTicks);

// Each kind: how often it might start (every, in ticks), the chance it does then (with the slider in the middle),
// how many can be on at once (most), how to start one (start: its own fields, or null if it can't) and how it goes on
// each tick (step: false once it's over).
const GOINGS = {
  // A ball of dry twigs blown along the ground, bouncing, hopping now and then, until it rolls off out of the tank.
  tumbleweed: {
    every: 240,
    chance: 0.08,
    most: 1,
    start: (world, s) => {
      const r = world.biomeRand;
      const dir = Math.sign(wind(world, world.W / 2)) || (r() < 0.5 ? -1 : 1);
      const x = dir > 0 ? -5 : world.W + 5;
      const size = 3 + r() * 2;
      return { x, y: surfaceAt(s, x) - size, vx: dir * 0.3, vy: 0, dir, size, spin: 0, life: 3600, seed: r() * 100 };
    },
    step: (world, h, s) => {
      h.vx += (h.dir * 0.35 + wind(world, h.x) * 0.25 - h.vx) * 0.02;
      h.vy += 0.08;
      const ground = surfaceAt(s, h.x + h.vx) - h.size;
      if (ground < h.y - 6) [h.vx, h.vy] = [-h.vx * 0.5, -1.2]; // a wall: back off, and hop
      h.x += h.vx;
      h.y += h.vy;
      const under = surfaceAt(s, h.x) - h.size;
      if (h.y >= under) {
        h.y = under;
        h.vy = h.vy > 0.6 ? -h.vy * 0.45 : world.biomeRand() < 0.01 ? -0.8 - world.biomeRand() * 0.6 : 0;
      }
      h.spin += h.vx / h.size;
      return h.x > -12 && h.x < world.W + 12 && ++h.age < h.life;
    },
  },
  // A whirl of dust spinning up off the ground, wandering across it a while.
  dustDevil: {
    every: 300,
    chance: 0.06,
    most: 1,
    start: (world, s) => {
      const r = world.biomeRand;
      const x = world.W * (0.15 + 0.7 * r());
      if (s.tops[Math.floor(x / CELL)].depth) return null; // not over water
      return { x, vx: (r() - 0.5) * 0.3, height: 30 + r() * 25, life: 600 + r() * 900, seed: r() * 100 };
    },
    step: (world, h, s) => {
      h.x += h.vx + wind(world, h.x) * 0.1;
      h.y = surfaceAt(s, h.x);
      return h.x > 0 && h.x < world.W && ++h.age < h.life;
    },
  },
  // A flurry: it snows in the tank for half a minute or a minute (see life.js's snowing).
  flurry: {
    every: 600,
    chance: 0.12,
    most: 1,
    start: (world) => {
      if (world.time < (world.flurry ?? -Infinity) + LET_UP) return null;
      world.flurry = world.time + 1800 + world.biomeRand() * 1800;
      return null;
    },
    step: () => false,
  },
  // Sparks rising off the basalt, glowing yellow, then orange, then red, and going out.
  embers: {
    every: 15,
    chance: 0.5,
    most: 24,
    start: (world, s) => {
      if (!s.embers.length) return null;
      const r = world.biomeRand;
      const at = pick(r, s.embers);
      return { x: at.x, y: at.y - 1, vy: -0.15 - 0.2 * r(), life: 120 + r() * 160, seed: r() * 100 };
    },
    step: (world, h) => {
      h.vy -= 0.002;
      h.x += wind(world, h.x) * 0.3 + Math.sin(world.time * 0.1 + h.seed) * 0.15;
      h.y += h.vy;
      return h.y > 0 && ++h.age < h.life;
    },
  },
  // Puffs of steam off water lapping at the basalt, swelling as they rise and thinning away.
  steam: {
    every: 20,
    chance: 0.4,
    most: 10,
    start: (world, s) => {
      if (!s.steam.length) return null;
      const r = world.biomeRand;
      const at = pick(r, s.steam);
      return { x: at.x, y: at.y - 2, life: 120 + r() * 100, seed: r() * 100 };
    },
    step: (world, h) => {
      h.x += wind(world, h.x) * 0.2 + Math.sin(world.time * 0.05 + h.seed) * 0.1;
      h.y -= 0.15;
      return ++h.age < h.life;
    },
  },
  // A drop of water gathering under an overhang, falling, and splashing where it lands (rippling, on water).
  drips: {
    every: 60,
    chance: 0.5,
    most: 6,
    start: (world, s) => {
      if (!s.drips.length) return null;
      const r = world.biomeRand;
      const at = pick(r, s.drips);
      return { x: at.x, y: at.y, vy: 0, state: 'gather', life: 60 + r() * 90, splash: 0 };
    },
    step: (world, h) => {
      h.age++;
      if (h.state === 'gather') {
        if (h.age >= h.life) h.state = 'fall';
        return open(world, h.x, h.y); // the overhang's gone
      }
      if (h.state === 'splash') return ++h.splash < 14;
      h.vy = Math.min(h.vy + 0.08, 3);
      h.y += h.vy;
      if (open(world, h.x, h.y)) return true;
      if (wetAt(world, h.x, h.y)) ripple(world, h.x, h.y);
      Object.assign(h, { state: 'splash', y: Math.min(h.y, world.ground.y0) - 1 });
      return true;
    },
  },
  // Pale lights hanging over the water, drifting about a spot and fading in and out.
  wisps: {
    every: 240,
    chance: 0.3,
    most: 3,
    start: (world, s) => {
      const water = s.tops.filter((t) => t.depth >= 4);
      if (!water.length) return null;
      const r = world.biomeRand;
      const t = pick(r, water);
      const home = { x: t.x, y: t.surface - 5 - r() * 12 };
      return { ...home, home, life: 1200 + r() * 1800, seed: r() * 100 };
    },
    step: (world, h) => {
      const t = world.time * 0.01 + h.seed;
      h.x = h.home.x + Math.sin(t) * 10 + Math.sin(t * 2.3) * 3;
      h.y = h.home.y + Math.sin(t * 1.7) * 3;
      return ++h.age < h.life;
    },
  },
  // A shower of rain: drops slanting down on the breeze, splashing where they land and rippling the water.
  rain: {
    every: 600,
    chance: 0.08,
    most: 1,
    start: (world) => ({ life: 1800 + world.biomeRand() * 1800, drops: [], splashes: [] }),
    step: (world, h) => {
      const r = world.biomeRand;
      const heavy = fade(h, 300, 300); // it comes on, and eases off
      for (let k = 0; k < 3; k++) {
        if (r() < heavy) h.drops.push({ x: r() * (world.W + 40) - 20, y: -2 - r() * 4, vy: 2.5 + r() });
      }
      h.drops = h.drops.filter((d) => {
        d.x += wind(world, d.x) * 0.5;
        d.y += d.vy;
        if (open(world, d.x, d.y)) return d.x > -20 && d.x < world.W + 20;
        if (wetAt(world, d.x, d.y)) {
          if (r() < 0.15) ripple(world, d.x, d.y);
        } else h.splashes.push({ x: d.x, y: Math.min(d.y, world.ground.y0) - 1, age: 0 });
        return false;
      });
      h.splashes = h.splashes.filter((p) => ++p.age < 6);
      return ++h.age < h.life || h.drops.length > 0;
    },
  },
  // A clump of mushrooms coming up on dirt, wood or the tank floor, now and then in a ring: they grow, stand a
  // minute or two, and wither away. One whose ground goes is gone.
  mushrooms: {
    every: 600,
    chance: 0.15,
    most: 2,
    start: (world, s) => {
      const r = world.biomeRand;
      const spots = s.tops.filter((t) => !t.depth && (t.m === DIRT || t.m === WOOD || t.m === null));
      if (!spots.length) return null;
      const at = pick(r, spots);
      const ring = r() < 0.3;
      const look = pick(r, ['agaric', 'agaric', 'brown', 'brown', 'pale', 'glow']);
      const caps = [];
      for (let k = 0, n = ring ? 7 + Math.floor(r() * 4) : 3 + Math.floor(r() * 3); k < n; k++) {
        const x = Math.round(at.x + (ring ? (k / (n - 1) - 0.5) * 30 : (r() - 0.5) * 12));
        const t = s.tops[Math.floor(x / CELL)];
        if (!t || t.depth || Math.abs(t.y - at.y) > 4) continue;
        caps.push({ x, y: t.y, size: 1.5 + r() * 2, delay: r() * 200 });
      }
      return caps.length ? { caps, look, life: 3600 + r() * 3600 } : null;
    },
    step: (world, h, s) => {
      const standing = (c) => Math.abs(s.tops[Math.floor(c.x / CELL)].surface - c.y) < 2;
      if (world.time % 60 === 0) h.caps = h.caps.filter(standing);
      return h.caps.length > 0 && ++h.age < h.life;
    },
  },
  // Dandelion fluff drifting through the air on the breeze, bobbing, then gone.
  fluff: {
    every: 120,
    chance: 0.25,
    most: 6,
    start: (world, s) => {
      const r = world.biomeRand;
      const x = r() * world.W;
      const y = surfaceAt(s, x) - 6 - r() * 20;
      return y > 10 ? { x, y, life: 1200 + r() * 1200, seed: r() * 100 } : null;
    },
    step: (world, h) => {
      h.x += wind(world, h.x) * 0.4 + Math.sin(world.time * 0.013 + h.seed) * 0.05;
      h.y += Math.sin(world.time * 0.02 + h.seed) * 0.06 - 0.01;
      if (!open(world, h.x, h.y)) h.y -= 1;
      return h.x > -5 && h.x < world.W + 5 && h.y > 0 && ++h.age < h.life;
    },
  },
  // Jellyfish in deep water: each beat of the bell lifts it, then it sinks slowly, its tentacles trailing; kept in the
  // water, and gone if that drains away. Now and then a glowing one.
  jellyfish: {
    every: 600,
    chance: 0.3,
    most: 3,
    start: (world, s) => {
      const deep = s.tops.filter((t) => t.depth >= 24);
      if (!deep.length) return null;
      const r = world.biomeRand;
      const t = pick(r, deep);
      const glow = r() < 0.08;
      const hue = glow ? 175 : pick(r, [330, 290, 210, 20]);
      const y = t.surface + 8 + r() * (t.depth - 16);
      const size = 2 + Math.floor(r() * 2);
      return { x: t.x, y, vx: (r() - 0.5) * 0.1, vy: 0, size, hue, glow, life: 3600 + r() * 5400 };
    },
    step: (world, h) => {
      const r = world.biomeRand;
      h.beat = Math.max(0, (h.beat ?? 0) - 1);
      if (!h.beat && r() < 0.012) [h.beat, h.vy] = [30, h.vy - 0.25];
      h.vy = Math.min(h.vy + 0.004, 0.08);
      h.vx += (r() - 0.5) * 0.004;
      const [x, y] = [h.x + h.vx, h.y + h.vy - h.size];
      if (wetAt(world, x, y) && wetAt(world, x, h.y + h.vy + 4)) [h.x, h.y] = [x, h.y + h.vy];
      else [h.vx, h.vy] = [-h.vx, -h.vy * 0.5];
      if (!wetAt(world, h.x, h.y)) h.life = Math.min(h.life, h.age + 60); // stranded: it fades
      return ++h.age < h.life;
    },
  },
};

// How far in a goings-on is (0..1 coming on, 1, and back down going off), for drawing.
export const strength = fade;

// ---------- each tick ----------

// What kind of place the tank is now: its biome's key, name, what it's like, and its wild flower's name (??? until
// it's turned up), plus any news to show.
export const biomeNow = (world) => {
  const b = surveyOf(world).biome;
  const news = world.news && world.time - world.news.at < NEWS_TICKS ? world.news.text : null;
  return { key: b.key, name: b.name, about: b.about, wild: b.wild && wildName(world, b), news };
};

// Look the tank over, start and run its goings-on, and now and then seed its wild flower: returns that, for the
// simulation to plant, or null.
export const stepBiomes = (world) => {
  const s = surveyOf(world);
  const b = s.biome;
  const r = world.biomeRand;
  for (const kind of b.goings) {
    const g = GOINGS[kind];
    if (world.time % g.every || world.happenings.filter((h) => h.kind === kind).length >= g.most) continue;
    if (r() >= g.chance * params.biomeLife) continue;
    const h = g.start(world, s);
    if (h) world.happenings.push({ kind, age: 0, ...h });
  }
  world.happenings = world.happenings.filter((h) => GOINGS[h.kind].step(world, h, s));
  if (!b.wild || world.time % WILD_TICKS || r() >= WILD_CHANCE * params.wildFlowers) return null;
  return sow(world, s, b.wild);
};
