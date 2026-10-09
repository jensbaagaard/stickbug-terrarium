// The stickbug terrarium simulation: the world made (createWorld) and stepped a tick at a time (step), and what the
// panel sees of it (snapshot). Its parts live in their own modules (see ARCHITECTURE.md); everything they offer the
// app is exported from here. Pure data + functions: the drawing lives in render.js and draw/.
import { GENES, params } from './tuning.js';
import { mulberry32, project } from './geom.js';
import { DEFAULT_FOLIAGE } from './sticks.js';
import { makeTerrain, stepTerrain } from './terrain.js';
import { stepFish } from './fish.js';
import { stepLife } from './life.js';
import { stepVisitors } from './visitors.js';
import { biomeNow, stepBiomes } from './biomes.js';
import { stepFliers } from './fliers.js';
import { floorAt, growLeaves, rebuildOutline } from './surfaces.js';
import { placeBug, stepBugs } from './bugs.js';
import { growPlant, stepPlants } from './plants.js';
import { addDecor, checkFooting } from './objects.js';
import { build, FREE_REROLL_TICKS, freeRerollIn, rerollCost, rerollShop } from './shop.js';
import { paintAt } from './tools.js';
import { stepCrumbs, stepDebris, stepLitter } from './effects.js';

export { command, rerollGenes } from './bugs.js';
export { feedFish } from './fish.js';
export { exportWorld, importWorld, TANK_SIZES, tankSize } from './persist.js';
export {
  buyReroll,
  buyWallpaper,
  cancelPlacing,
  hangWallpaper,
  previewAt,
  PRICES,
  rerollCost,
  stageOffer,
  startPlacing,
} from './shop.js';
export { floorBelow } from './surfaces.js';
export {
  aimAt,
  pointerCancel,
  pointerDown,
  pointerMove,
  pointerUp,
  propagatable,
  release,
  relocationAt,
  setBrush,
  setTool,
} from './tools.js';

const START_COINS = 40;

// ---------- world ----------

export const createWorld = (W, H, { seed = Date.now(), scene = true } = {}) => {
  const world = {
    W,
    H,
    ground: { x0: 0, y0: H - 6, x1: W - 1, y1: H - 6, kind: 'ground', leaves: [] },
    branches: [], // every surface but the ground: sticks and the terrain's outline
    objects: [], // sticks (owning some of those surfaces), plants, grass and vines
    bugs: [],
    fish: [],
    flakes: [], // fish food
    fliers: [], // ladybugs and the other small flying bugs
    aphids: [], // on the plants, for the ladybugs
    junctions: [],
    time: 0,
    rand: mulberry32(seed),
    lifeRand: mulberry32(seed + 1), // for the tank's ambient life alone, so it never reshuffles what else happens
    biomeRand: mulberry32(seed + 2), // and for its biome's goings-on and wild flowers
    held: null,
    press: null,
    pointer: { x: 0, y: 0 },
    hover: false, // the pointer is over the tank, so what's under it can be marked
    touch: null, // where a press that caught no creature started, to tell taps from drags, and any plant there
    pull: null, // the plant, vine or grass being pulled about, and where it was grabbed
    cut: null,
    shop: null, // the showcased offers, by kind
    offers: 0,
    crumbs: [],
    debris: [],
    litter: [], // fallen leaves
    fireflies: [],
    visitors: [], // dragonflies, bees and gnats, come and gone
    happenings: [], // the biome's goings-on: tumbleweeds, embers, rain and so on (see biomes.js)
    found: [], // the wild flowers that have turned up, by key
    news: null, // something to tell: {text, at}
    bubbles: [],
    motes: [], // dust in the air
    ripples: [],
    popups: [],
    coins: START_COINS,
    placing: null, // the shop item waiting to be put down: {kind, offer, price, seed, at}
    tool: 'hand', // or 'paint', 'prune', 'move' or 'propagate'
    moving: null, // what's being relocated, or the plant picked to propagate, and where it was grabbed: {obj, x, y}
    demo: null, // the how-to animation for the tool just picked: {kind, at}
    selected: null,
    wallpaper: null, // the back of the tank: null for plain black
    wallpapers: [], // every wallpaper bought, to put back up for free
    terrain: makeTerrain(W, H - 6),
    brush: { material: 'sand', size: 3 }, // cells
    painting: false,
  };
  rebuildOutline(world); // the floor, to walk on
  if (scene) seedScene(world);
  rerollShop(world);
  return world;
};

const seedScene = (world) => {
  const { W, H } = world;
  // A small crooked stick leaning out of the bottom-left corner, with a twig off each joint. Offsets are in
  // tank heights, so it keeps its shape whatever the tank's proportions.
  const base = { x: W * 0.03, y: world.ground.y0 };
  const up = (dx, dy) => ({ x: base.x + dx * H, y: base.y - dy * H });
  const [j1, j2] = [up(0.06, 0.1), up(0.13, 0.18)];
  addDecor(world, {
    kind: 'stick',
    base,
    on: world.ground,
    pieces: [
      { a: base, b: j1, parent: -1, depth: 0 },
      { a: j1, b: j2, parent: 0, depth: 0 },
      { a: j2, b: up(0.22, 0.24), parent: 1, depth: 0 },
      { a: j1, b: up(0.14, 0.13), parent: 0, depth: 1 },
      { a: j2, b: up(0.18, 0.26), parent: 1, depth: 1 },
    ],
    style: 'branch',
    wood: { name: 'Oak', h: 28, s: 38, l: 27 },
    foliage: DEFAULT_FOLIAGE,
  });
  const plant = addDecor(world, build(world, 'plant', Math.floor(world.rand() * 2 ** 31), W * 0.84, H));
  for (let i = 0; i < 2400; i++) growPlant(world, plant, 1);
  // One bug to start with, always the plain default: no genetic offsets, so it is exactly the sliders.
  const floor = floorAt(world, W * 0.62);
  const genes = Object.fromEntries(GENES.map((g) => [g.key, 0]));
  const starter = placeBug(world, floor, project(floor, W * 0.62, world.ground.y0), -1, genes);
  starter.name = 'Stickbug';
};

// ---------- simulation step ----------

export const step = (world) => {
  world.time++;
  const ter = world.terrain;
  if (world.painting) paintAt(world, world.pointer); // holding still keeps pouring
  stepTerrain(ter, world.rand, world.time);
  if (ter.skyDirty && (world.time % 8 === 0 || !ter.active)) rebuildOutline(world);
  growLeaves(world);
  if (world.time % 10 === 0) checkFooting(world);
  stepPlants(world);
  stepBugs(world);
  stepFish(world);
  stepFliers(world);
  stepCrumbs(world);
  stepDebris(world);
  stepLitter(world);
  stepLife(world);
  stepVisitors(world);
  const wild = stepBiomes(world);
  if (wild) addDecor(world, wild);
  world.popups = world.popups.filter((p) => {
    p.y -= 0.25;
    return --p.life > 0;
  });
};

// What the panel shows: coins, the shop and tool state, and the selected bug, fish or flier.
export const snapshot = (world) => {
  const bug = world.bugs.includes(world.selected) ? world.selected : null;
  const fish = world.fish.includes(world.selected) ? world.selected : null;
  const flier = world.fliers.includes(world.selected) ? world.selected : null;
  return {
    W: world.W, // which size of tank it is
    H: world.H,
    wallpaper: world.wallpaper?.seed ?? null, // which wallpaper is up
    wallpapers: world.wallpapers,
    coins: world.coins,
    rerollCost: rerollCost(world),
    rerollWait: freeRerollIn(world) / FREE_REROLL_TICKS, // share of the minute left until rerolling is free
    placing: world.placing?.kind ?? null,
    placingOffer: world.placing?.offer?.id ?? null,
    shop: world.shop,
    tool: world.tool,
    brush: { ...world.brush },
    bugs: world.bugs.length,
    full: world.bugs.length >= params.maxBugs,
    fish: world.fish.length,
    fliers: world.fliers.length,
    fliersFull: world.fliers.length >= params.maxFliers,
    biome: biomeNow(world),
    selected:
      (bug && { kind: 'bug', name: bug.name, hunger: bug.hunger, genes: bug.genes, t: bug.t }) ||
      (fish && { kind: 'fish', name: fish.name, hunger: fish.hunger, genome: fish.genome }) ||
      (flier && { kind: 'flier', name: flier.name, hunger: flier.hunger, genome: flier.genome }),
  };
};
