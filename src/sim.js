// Stickbug terrarium simulation: world, surfaces, bugs and their behaviour, decorations and the shop.
// Everything here is pure data + functions; rendering lives in render.js.
import { GENES, params } from './tuning.js';
import { patternRarity, randomGenes, randomName, traitsOf } from './genome.js';
import {
  FOOT_CLEAR,
  MID,
  SEGMENTS,
  bodySegLen,
  idealFoot,
  legLayout,
  sampleBody,
  standHeight,
  strideLen,
} from './anatomy.js';
import {
  add,
  clamp,
  closestApproach,
  distToSeg,
  dot,
  lerp,
  mulberry32,
  pointAt,
  project,
  segDir,
  segIntersect,
  segLength,
  segNormal,
  smoothstep,
} from './geom.js';
import {
  DEFAULT_FOLIAGE,
  makeClump,
  makeGrass,
  rarePrice,
  makeSpecies,
  makeStick,
  makeVine,
  makeWallpaper,
} from './decor.js';
import {
  CELL,
  cellAt,
  DIRT,
  EMPTY,
  fountainAt,
  makeTerrain,
  paintTerrain,
  placeFountain,
  resizeTerrain,
  SAND,
  stepTerrain,
  WATER,
} from './terrain.js';
import { feedFish, fishAt, fishShape, guppyName, guppyPrice, makeGuppy, newFish, startle, stepFish } from './fish.js';
import { ripple, stepLife, wind } from './life.js';
import { startleVisitors, stepVisitors } from './visitors.js';
import { biomeNow, stepBiomes } from './biomes.js';
import {
  addFlier,
  flierAt,
  flierName,
  flierPrice,
  flierShape,
  letGo,
  makeFlier,
  newFlier,
  startleFliers,
  stepFliers,
} from './fliers.js';

export { feedFish };

const GRAB_RADIUS = 16;
const PRESS_SLOP = 3; // a press on a bug that moves further than this picks it up; otherwise it selects it
const JUNCTION_DIST = 6; // surfaces closer than this connect
const FLOOR_SLOPE = 1.2; // surfaces flatter than this catch falling things
const TAP_SLOP = 8; // a press that moves less than this is a tap
const OUTLINE_TOLERANCE = 2.5; // px the walkable outline may stray from the terrain's edge
const ARRIVE = 0.5; // close enough to a walk target to stop stepping
const HUNGER_RATE = 1 / 2700;
const LEAF_GROWTH = 1 / 1200;
const LEAF_SPAWN_CHANCE = 1 / 360;
const LEAF_SPACING = 16;
const MAX_CRUMBS = 200;
const MAX_DEBRIS = 80;
const MAX_LITTER = 60; // fallen leaves and petals
const LEAF_LIFE = 180000; // ticks a plant leaf lasts, for species from before leaves aged
const LEAF_FADE = 1200; // ticks an old leaf takes to yellow before it drops
const LITTER_ROT = 1 / 3600; // how fast a fallen leaf lying on the ground browns and curls up, per tick
const PETAL_ROT = 4; // times as fast as a leaf, a fallen petal shrivels
const FLOAT_TICKS = 600; // a leaf fallen on the water floats this long before it sinks
const BLOOM_LIFE = 12000; // ticks a flower stays open, give or take half
const WILT_TICKS = 1800; // ticks a flower takes to wilt, dropping its petals as it goes
const REST_TICKS = 3600; // ticks a bare tip rests, give or take half, before it buds again
const SPROUT_TICKS = 120; // a pruned stem waits this long before sprouting new shoots
const CHAIN_SEG = 5; // px per segment of a clump plant's leaf, flower stalk or runner
const CROWN_CHANCE = 1 / 200; // chance a tick that a clump plant with room for it starts a new leaf, stalk or runner
const QUIRKS = [
  ['wave', 0.4],
  ['twig', 0.33],
  ['groom', 0.27],
];
const START_COINS = 40;
const MAX_TUFTS = 400; // per grass patch
const GRASS_CLIMB = 12; // px: grass spreads up or down the face of a pile this tall in one go
const GRASS_STUB = 0.25; // grass cut down to less than this share of its full height dies
const VINE_REACH = 14; // px: a vine hangs from anything this close to where you tap
const PLACE_REACH = 50; // px: plants and sticks land on the first thing at most this far below where you tap
const CLIPPING_LEN = 6; // px of pruned plant stem per coin; clippings are the only income
const BEND_STIFFNESS = 0.06; // how hard a bent stem springs back
const BEND_DAMPING = 0.9;
const CURRENT = 0.0015; // how hard the water rocks a stem, radians per tick per tick
const VINE_CURRENT = 0.04; // and a vine's nodes, px per tick per tick
const PLANT_WIND = 0.001; // how hard the breeze pushes a stem in the air, radians per tick per tick
const VINE_WIND = 0.015; // and a vine's nodes, px per tick per tick
const FLEX = 0.15; // how hard pulled grass springs back
export const PRICES = { fountain: 15 }; // fixed prices for anything not showcased; showcased kinds are priced per offer
const SHOP_KINDS = ['bug', 'fish', 'plant', 'stick', 'wallpaper']; // showcased in the shop, OFFERS of each
const OFFERS = 4;

const dirOf = (a) => ({ x: Math.cos(a), y: Math.sin(a) });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- surfaces ----------

const isFloorLike = (g) => Math.abs(g.y1 - g.y0) <= Math.abs(g.x1 - g.x0) * FLOOR_SLOPE;
const yAt = (g, x) => g.y0 + ((g.y1 - g.y0) * (x - g.x0)) / (g.x1 - g.x0 || 1);

// Highest floor-like surface at x that is at or below y. The terrain's outline (the open floor included) counts at
// any slope short of a wall: it's the ground. Below everything, the tank floor itself.
export const floorBelow = (world, x, y) => {
  let best = null;
  for (const g of world.branches) {
    if (!(g.kind === 'terrain' ? g.x1 > g.x0 : isFloorLike(g)) || x < g.x0 || x > g.x1) continue;
    const gy = yAt(g, x);
    if (gy >= y && (!best || gy < best.y)) best = { y: gy, g };
  }
  return best ?? { y: world.ground.y0, g: world.ground };
};

// The outline of the open floor at x, or of the terrain over it there.
const floorAt = (world, x) => floorBelow(world, x, world.ground.y0 - 1).g;

// A surface under water all along it: no way for a bug to go.
const submerged = (world, g) => {
  const n = segNormal(g);
  return [0.1, 0.5, 0.9].every((k) => wetAt(world.terrain, add(pointAt(g, k * segLength(g)), n, 1)));
};

const rebuildJunctions = (world) => {
  const all = world.branches;
  world.junctions = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const c = closestApproach(all[i], all[j]);
      if (c.d <= JUNCTION_DIST) world.junctions.push({ a: all[i], sa: c.sa, b: all[j], sb: c.sb });
    }
  }
};

// BFS over junctions, keeping out of the water. Returns a list of hops ([] if from === to) or null.
const findRoute = (world, from, to) => {
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length && !prev.has(to)) {
    const cur = queue.shift();
    for (const j of world.junctions) {
      for (const [a, sa, b, sb] of [[j.a, j.sa, j.b, j.sb], [j.b, j.sb, j.a, j.sa]]) {
        if (a !== cur || prev.has(b) || submerged(world, b)) continue;
        prev.set(b, { from: a, sFrom: sa, to: b, sTo: sb });
        queue.push(b);
      }
    }
  }
  if (!prev.has(to)) return null;
  const route = [];
  for (let hop = prev.get(to); hop; hop = prev.get(hop.from)) route.unshift(hop);
  return route;
};

// Every surface reachable from `from` without going through water, in one flood fill.
const reachable = (world, from) => {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const j of world.junctions) {
      const next = j.a === cur ? j.b : j.b === cur ? j.a : null;
      if (next && !seen.has(next) && !submerged(world, next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
};

// ---------- segments ----------

// Surfaces run left to right so their normal points up. They also remember their root and tip, which way
// they were drawn or grew, for pruning.
const setEnds = (seg, root, tip) => {
  const [a, b] = tip.x < root.x ? [tip, root] : [root, tip];
  return Object.assign(seg, { root, tip, x0: a.x, y0: a.y, x1: b.x, y1: b.y });
};

const makeSeg = (world, a, b, extra) => {
  const fit = (p) => ({ x: clamp(p.x, 0, world.W - 1), y: clamp(p.y, 1, world.ground.y0) });
  return setEnds({ leaves: [], obj: null, parent: null, ...extra }, fit(a), fit(b));
};

const maxLeaves = (g) => Math.floor(segLength(g) / LEAF_SPACING);

const sprinkleLeaves = (world, g, share = 0.5) => {
  for (let i = 0; i < maxLeaves(g) * share; i++) {
    g.leaves.push({ t: 0.1 + 0.8 * world.rand(), size: 0.6 + 0.4 * world.rand(), lean: world.rand() < 0.5 ? -1 : 1 });
  }
};

// Take surfaces out of the world: bugs standing on them fall, and bugs heading for them give up.
const removeSegments = (world, segs) => {
  const gone = new Set(segs);
  world.branches = world.branches.filter((g) => !gone.has(g));
  for (const obj of world.objects) if (obj.segs) obj.segs = obj.segs.filter((g) => !gone.has(g));
  world.objects = world.objects.filter((obj) => !(obj.segs ?? obj.stems) || (obj.segs ?? obj.stems).length);
  rebuildJunctions(world);
  for (const bug of world.bugs) if (gone.has(bug.surf) || gone.has(bug.transfer?.from)) detach(bug, 'fall');
  replan(world);
  // Whatever stood on a surface that's gone, or that was cut back from under it, comes down too. (The terrain's
  // outline is never cut: rebuildOutline looks after what stands on it.)
  for (const obj of [...world.objects]) {
    const on = obj.on;
    if (!on || on === world.ground || on.kind === 'terrain' || !world.objects.includes(obj)) continue;
    if (gone.has(on) || distToSeg(on, obj.base.x, obj.base.y) > 2) removeObject(world, obj, true);
  }
};

// Surfaces changed shape, so junctions moved: work out every walking bug's route again, or give up if its
// goal is gone or out of reach.
const replan = (world) => {
  for (const bug of world.bugs) {
    if (!bug.goal || !bug.surf) continue;
    const route = world.branches.includes(bug.goal.surf) ? findRoute(world, bug.surf, bug.goal.surf) : null;
    if (route) {
      bug.route = route;
      continue;
    }
    bug.goal = null;
    bug.route = [];
    if (bug.state === 'walk' || bug.state === 'eat') setState(bug, 'idle', 30);
  }
};

// Everything growing out of seg within its stick.
const descendants = (seg) => {
  const out = [];
  const visit = (s) => {
    for (const c of seg.obj?.segs ?? []) {
      if (c.parent !== s) continue;
      out.push(c);
      visit(c);
    }
  };
  visit(seg);
  return out;
};

// Cut seg back to p, keeping the root side and the leaves on it.
const shorten = (seg, p) => {
  const leaves = seg.leaves.map((leaf) => ({ leaf, at: pointAt(seg, leaf.t * segLength(seg)) }));
  setEnds(seg, seg.root, p);
  seg.leaves = leaves
    .filter(({ at }) => distToSeg(seg, at.x, at.y) < 1)
    .map(({ leaf, at }) => ({ ...leaf, t: project(seg, at.x, at.y) / segLength(seg) }));
};

// ---------- bodies and feet ----------

// Keep a bug's centre far enough from the ends that its body fits.
const clampS = (surf, s, t) => {
  const len = segLength(surf);
  const half = MID * bodySegLen(t);
  return len < 2 * half ? len / 2 : clamp(s, half, len - half);
};

// Target body points for a bug standing on surf at s, facing dir, lifted off it by lift.
const bodyPose = (surf, s, dir, squash, t, lift = 0) => {
  const d = segDir(surf);
  const n = segNormal(surf);
  const h = standHeight(t) + lift;
  const step = bodySegLen(t) * squash;
  return Array.from({ length: SEGMENTS }, (_, i) => {
    const along = s + dir * (MID - i) * step;
    return { x: surf.x0 + d.x * along + n.x * h, y: surf.y0 + d.y * along + n.y * h };
  });
};

// Crossing a junction, the body slides along a path like a train: along the old surface up to the
// junction, then along the new one, rounding the corner over about a stand height. p is the distance along
// that path, negative before the junction.
const crossPoint = (tr, h, p) => {
  const onOld = add(pointAt(tr.from, tr.sFrom + tr.dirFrom * p), segNormal(tr.from), h);
  const onNew = add(pointAt(tr.to, tr.sTo + tr.dirTo * p), segNormal(tr.to), h);
  return lerp(onOld, onNew, smoothstep(clamp((p + h) / (2 * h), 0, 1)));
};

const crossingPose = (bug, d) => {
  const h = standHeight(bug.t);
  const seg = bodySegLen(bug.t);
  return Array.from({ length: SEGMENTS }, (_, i) => crossPoint(bug.transfer, h, bug.transfer.p0 + (MID - i) * seg + d));
};

// Where the body will be once it has moved len further.
const poseAhead = (bug, len) =>
  bug.transfer
    ? crossingPose(bug, bug.transfer.d + len)
    : bodyPose(bug.surf, bug.s + bug.dir * len, bug.dir, bug.squash, bug.t);

const downOf = (bug) => {
  const n = segNormal(bug.surf);
  return { x: -n.x, y: -n.y };
};

// Put a foot on the nearest surface to where it wants to be, on the same side as its hip, or leave it
// hanging if nothing is in reach. Near a junction the front feet find the next surface first.
const snapFoot = (world, bug, p, hip) => {
  const reach = standHeight(bug.t) * 0.75 + 2;
  let best = null;
  for (const g of world.branches) {
    const q = pointAt(g, project(g, p.x, p.y));
    const d = dist(p, q);
    if (d < reach && (!best || d < best.d)) best = { d, q, g };
  }
  if (!best) return p;
  const n = segNormal(best.g);
  return add(best.q, n, dot({ x: hip.x - best.q.x, y: hip.y - best.q.y }, n) < 0 ? -FOOT_CLEAR : FOOT_CLEAR);
};

const footFor = (world, bug, pose, leg, ahead) =>
  snapFoot(world, bug, idealFoot(bug.t, pose, leg, bug.squash, downOf(bug), ahead), sampleBody(pose, leg.at));

const swingLeg = (leg, to, dur) => {
  leg.swing = { from: leg.foot ?? to, to, t: 0, dur };
};

const resetLegs = (bug) => {
  for (const leg of bug.legs) Object.assign(leg, { foot: null, swing: null });
  bug.feet = [0, 0];
};

// Planted feet stay put in the world while swinging ones arc to their target. A bug that has drifted off
// its footholds (turning, getting up) re-plants one tripod at a time.
const moveFeet = (world, bug) => {
  const t = bug.t;
  const layout = legLayout(t);
  const up = segNormal(bug.surf);
  const lift = t.footLift * t.size;
  bug.legs.forEach((leg, k) => {
    if (!leg.foot) leg.foot = footFor(world, bug, bug.pose, layout[k], bug.feet[layout[k].tripod]);
    const sw = leg.swing;
    if (!sw) return;
    sw.t = Math.min(1, sw.t + 1 / sw.dur);
    leg.foot = add(lerp(sw.from, sw.to, 1 - (1 - sw.t) ** 3), up, lift * Math.sin(Math.PI * sw.t));
    if (sw.t >= 1) {
      leg.foot = sw.to;
      leg.swing = null;
    }
  });
  if (bug.step || bug.legs.some((l) => l.swing)) return;
  if ((world.time + Math.floor(bug.seed)) % 6) return;
  let worst = { err: 0 };
  for (const tripod of [0, 1]) {
    let err = 0;
    layout.forEach((L, k) => {
      if (L.tripod !== tripod) return;
      err = Math.max(err, dist(footFor(world, bug, bug.pose, L, bug.feet[tripod]), bug.legs[k].foot));
    });
    if (err > worst.err) worst = { tripod, err };
  }
  if (worst.err < Math.max(2, strideLen(t) * 1.5)) return;
  bug.feet[worst.tripod] = 0;
  layout.forEach((L, k) => {
    if (L.tripod === worst.tripod) {
      swingLeg(bug.legs[k], footFor(world, bug, bug.pose, L, 0), Math.max(8, t.stepTicks / 2));
    }
  });
};

// ---------- bugs ----------

const newBug = (world, x, y, genes = randomGenes(world.rand, params.variety)) => {
  const t = traitsOf(genes);
  return {
    name: randomName(world.rand),
    genes,
    t, // traits: the sliders plus this bug's genes, refreshed every tick
    pts: Array.from({ length: SEGMENTS }, (_, i) => {
      const px = x + (i - MID) * bodySegLen(t);
      return { x: px, y, px, py: y };
    }),
    surf: null,
    s: 0,
    dir: 1,
    squash: 1,
    state: 'fall',
    timer: 0,
    turnTo: 1,
    next: 'idle',
    nextTimer: 0,
    hunger: 0.2 + world.rand() * 0.3,
    goal: null,
    route: [],
    transfer: null, // crossing a junction: the path round the corner and how far along it the body is
    partner: null,
    cooldown: 0,
    // Legs move as two alternating tripods. feet[k] is how far tripod k's feet sit ahead of their hips
    // along the heading (the walking plan); legs hold each foot's place in the world and any swing.
    feet: [0, 0],
    legs: Array.from({ length: 6 }, () => ({ foot: null, swing: null })),
    step: null,
    pose: null, // where the body should be this tick, before springing
    beat: 0, // dance phase in radians; the dance ends after bops full rocks
    bops: 0,
    tempo: 0,
    groove: 0, // eases to 1 while dancing
    calm: 0, // eases to 1 while resting
    munch: 0, // eases to 1 while eating
    chew: 0, // chewing phase in radians; the head is lowest at odd multiples of pi
    quirk: null, // the latest quirk; raise eases to 1 while it holds the front legs up
    raise: 0,
    rest: 0,
    seed: world.rand() * 1000,
  };
};

const setState = (bug, state, timer) => {
  bug.state = state;
  bug.timer = timer;
  if (state !== 'walk' && bug.step) {
    // An interrupted step stops the body; feet already in the air still land.
    bug.feet[1 - bug.step.stance] = bug.step.len - bug.step.from;
    bug.step = null;
  }
};

const land = (world, bug, surf, s, facing) => {
  Object.assign(bug, {
    surf,
    s: clampS(surf, s, bug.t),
    dir: facing < 0 ? -1 : 1,
    squash: 1,
    rest: 0,
    goal: null,
    route: [],
    transfer: null,
  });
  resetLegs(bug);
  setState(bug, 'idle', 30 + world.rand() * 90);
};

const detach = (bug, state) => {
  if (bug.partner) bug.partner.partner = null;
  Object.assign(bug, {
    surf: null,
    partner: null,
    goal: null,
    route: [],
    transfer: null,
    squash: 1,
    rest: 0,
    pose: null,
  });
  resetLegs(bug);
  setState(bug, state, 0);
};

const addBug = (world, x, y, genes, name) => {
  if (world.bugs.length >= params.maxBugs) return null;
  const bug = newBug(world, x, y, genes);
  if (name) bug.name = name;
  world.bugs.push(bug);
  return bug;
};

const placeBug = (world, surf, s, facing, genes) => {
  const bug = newBug(world, 0, 0, genes);
  land(world, bug, surf, s, facing);
  bodyPose(surf, bug.s, bug.dir, 1, bug.t).forEach((p, i) =>
    Object.assign(bug.pts[i], { x: p.x, y: p.y, px: p.x, py: p.y }),
  );
  world.bugs.push(bug);
  return bug;
};

// ---------- world ----------

export const createWorld = (W, H, { seed = Date.now(), scene = true } = {}) => {
  const world = {
    W,
    H,
    ground: { x0: 0, y0: H - 6, x1: W - 1, y1: H - 6, kind: 'ground', leaves: [] },
    branches: [], // every surface but the ground: sticks and the terrain's outline
    objects: [], // sticks (owning some of those surfaces) and plants
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
    touch: null, // where a press on empty space started, to tell taps from drags, and any plant there
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
    placing: null, // the shop item waiting to be put down: {kind, seed}
    tool: 'hand', // or 'paint', 'prune' or 'move'
    moving: null, // the plant or stick being dragged somewhere else, and where it was grabbed: {obj, x, y}
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

// ---------- terrain ----------

export const setBrush = (world, brush) => Object.assign(world.brush, brush);

const paintAt = (world, p) => paintTerrain(world.terrain, p.x, p.y, world.brush.material, world.brush.size, world.rand);

// Ramer-Douglas-Peucker: keep only the points that stray more than tol from a straight run.
const simplify = (pts, tol) => {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const line = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  let worst = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSeg(line, pts[i].x, pts[i].y);
    if (d > worst) [worst, at] = [d, i];
  }
  if (worst <= tol) return [a, b];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
};

// The terrain's outline, as walkable surfaces: wherever open space (air or water) meets solid ground (the terrain,
// or the tank floor under it). It's traced cell edge by cell edge with the open side on the left, so each run's
// normal points out into the open (and it only ever goes right, up or down), then simplified into a few straight
// runs. Floors, slopes and walls are kept; undersides, which nothing could stand on, are dropped, as are walls with
// no room beside them (in a crack, or up against the tank's side). Unchanged runs keep their old objects, so bugs on
// them don't notice a rebuild.
const outlineSegs = (world, old) => {
  const ter = world.terrain;
  const { cols, rows } = ter;
  const solid = (c, r) => {
    if (r >= rows) return true;
    const m = r >= 0 && c >= 0 && c < cols ? ter.cells[r * cols + c] : EMPTY;
    return m !== EMPTY && m !== WATER;
  };
  const next = new Map(); // corner "c,r" -> the corners its edges lead on to
  const into = new Set(); // corners some edge leads to
  const edge = (c0, r0, c1, r1) => {
    const k = `${c0},${r0}`;
    if (!next.has(k)) next.set(k, []);
    next.get(k).push(`${c1},${r1}`);
    into.add(`${c1},${r1}`);
  };
  // Room beside a wall to stand out from it: a few open cells, inside the tank.
  const room = (c, r, dc) => [1, 2, 3].every((k) => c + dc * k >= 0 && c + dc * k < cols && !solid(c + dc * k, r));
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!solid(c, r)) continue;
      if (!solid(c, r - 1)) edge(c, r, c + 1, r); // a top, going right
      if (room(c, r, -1)) edge(c, r + 1, c, r); // a wall facing left, going up
      if (room(c, r, 1)) edge(c + 1, r, c + 1, r + 1); // a wall facing right, going down
    }
  }
  const follow = (k) => {
    const pts = [];
    for (;;) {
      const [c, r] = k.split(',').map(Number);
      pts.push({ x: Math.min(c * CELL, world.W - 1), y: ter.top + r * CELL });
      if (!next.get(k)?.length) return pts;
      k = next.get(k).pop();
    }
  };
  // Runs from where they start, then whatever's left where two meet corner to corner.
  const runs = [...next.keys()].filter((k) => !into.has(k)).map(follow);
  for (const k of next.keys()) while (next.get(k).length) runs.push(follow(k));
  const reuse = new Map([...old].map((g) => [`${g.root.x},${g.root.y},${g.tip.x},${g.tip.y}`, g]));
  const segs = [];
  for (const run of runs) {
    const pts = simplify(run, OUTLINE_TOLERANCE);
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      if (dist(a, b) < 1) continue;
      segs.push(reuse.get(`${a.x},${a.y},${b.x},${b.y}`) ?? makeSeg(world, a, b, { kind: 'terrain' }));
    }
  }
  return segs;
};

// The terrain moved: redo its outline. Bugs and things planted on outline that changed move onto the new outline
// where they were, or let go and come down if it's gone from under them.
const rebuildOutline = (world) => {
  const ter = world.terrain;
  ter.skyDirty = false;
  const old = new Set(world.branches.filter((g) => g.kind === 'terrain'));
  const fresh = outlineSegs(world, old);
  const added = fresh.filter((g) => !old.has(g));
  for (const g of fresh) old.delete(g);
  if (!old.size && !added.length) return;
  world.branches = world.branches.filter((g) => g.kind !== 'terrain').concat(fresh);
  rebuildJunctions(world);
  // The new outline nearest p, if it's close enough to be what was there.
  const near = (p) => {
    let best = null;
    for (const g of added) {
      const d = distToSeg(g, p.x, p.y);
      if (d < 3 && (!best || d < best.d)) best = { d, g };
    }
    return best?.g;
  };
  for (const bug of world.bugs) {
    if (!bug.surf || !(old.has(bug.surf) || old.has(bug.transfer?.from))) continue;
    const at = pointAt(bug.surf, bug.s);
    const g = !bug.transfer && near(at);
    if (!g) {
      detach(bug, 'fall');
      continue;
    }
    const facing = dot(segDir(bug.surf), segDir(g)) * bug.dir;
    Object.assign(bug, { surf: g, s: clampS(g, project(g, at.x, at.y), bug.t), dir: facing < 0 ? -1 : 1, step: null });
    resetLegs(bug);
  }
  for (const obj of [...world.objects]) {
    if (!old.has(obj.on)) continue;
    const g = near(obj.base);
    if (g) obj.on = g;
    else removeObject(world, obj, true);
  }
  replan(world);
};

// ---------- decorations and the shop ----------

// What a shop item becomes if put down at (x, y). Bugs drop from there, vines hang from it; everything else
// stands on the floor below, remembering what it stands on (on).
const build = (world, kind, seed, x, y, genes) => {
  const rand = mulberry32(seed);
  if (kind === 'bug') return { kind, base: { x, y }, genes };
  if (kind === 'fish') return { kind, base: { x, y }, genome: genes }; // let go where you tap, in water or not
  if (kind === 'flier') return { kind, base: { x, y }, genome: genes }; // let go where you tap, to fly off
  // A fountain goes where you tap, mid-air or not; base is under the middle of the block.
  if (kind === 'fountain') {
    const box = fountainAt(world.terrain, x, y);
    return { kind, box, base: { x: box.x + box.size / 2, y: box.y + box.size } };
  }
  if (kind === 'vine') return { kind, ...vineAnchor(world, x, y), genome: makeVine(rand) };
  // Plants and sticks need something to stand on not far below; null if there's nothing.
  const at = kind === 'grass' ? sowAt(world, x, y) : standAt(world, x, y);
  if (!at) return null;
  if (kind === 'grass') return { kind, ...at, genome: makeGrass(rand) };
  if (kind === 'stick') return { kind, ...at, ...makeStick(rand, at.base, world.W, world.H) };
  if (kind === 'clump') return { kind: 'plant', ...at, species: makeClump(rand) };
  return { kind, ...at, species: makeSpecies(rand) };
};

// Where a vine hung near (x, y) hangs from: the nearest branch or stick, or underside or face of the terrain,
// or else the top of the tank. The top of the terrain is no place to hang from: the vine would just lie on it.
const vineAnchor = (world, x, y) => {
  let best = null;
  for (const g of world.branches) {
    if (g.kind === 'terrain') continue;
    const q = pointAt(g, project(g, x, y));
    const d = dist(q, { x, y });
    if (d < VINE_REACH && (!best || d < best.d)) best = { d, q, g };
  }
  const hook = terrainHook(world, x, y);
  if (hook && (!best || hook.d < best.d)) return { base: hook.at, hold: hook.hold, on: null };
  // Hang from just under a branch, so the vine trails down rather than resting on top of it.
  const base = best ? { x: best.q.x, y: best.q.y + 1.5 } : { x: clamp(x, 2, world.W - 3), y: 1 };
  return { base, on: best?.g ?? null };
};

// Where something put down at (x, y) stands: straight down from there, the first of the top of a stick, the
// terrain (to the cell, so caves and ledges count; from inside it, its top) or the tank floor, if that's within
// PLACE_REACH. On the terrain it remembers the cell holding it up (hold) and comes down if that goes. Null if
// there's nothing near enough. A stick being moved doesn't stand on itself: skip is its surfaces.
const standAt = (world, x, y, skip = null) => {
  const gx = clamp(x, 3, world.W - 4);
  const top = groundTop(world, gx, y);
  let best = { y: top, on: top >= world.ground.y0 ? world.ground : null };
  for (const g of world.branches) {
    if (g.kind === 'terrain' || skip?.has(g) || !isFloorLike(g) || gx < g.x0 || gx > g.x1) continue;
    const gy = yAt(g, gx);
    if (gy >= y && gy < best.y) best = { y: gy, on: g };
  }
  if (best.y - y > PLACE_REACH) return null;
  const base = { x: gx, y: best.y };
  return best.on ? { base, on: best.on } : { base, on: null, hold: { x: gx, y: best.y + CELL / 2 } };
};

// The item being placed, following the pointer (or, for its how-to, wherever that is).
export const previewAt = (world, x = world.pointer.x, y = world.pointer.y) => {
  const pl = world.placing;
  return pl && build(world, pl.kind, pl.seed, x, y, pl.offer?.genes ?? pl.offer?.genome);
};

const addDecor = (world, spec) => {
  const obj = { kind: spec.kind, base: spec.base, on: spec.on, hold: spec.hold };
  if (spec.kind === 'stick') {
    Object.assign(obj, { style: spec.style ?? 'branch', wood: spec.wood, foliage: spec.foliage });
    const segs = [];
    for (const p of spec.pieces) {
      segs.push(makeSeg(world, p.a, p.b, { kind: 'stick', obj, parent: segs[p.parent] ?? null, depth: p.depth }));
    }
    obj.segs = segs.filter((g) => dist(g.root, g.tip) >= 3);
    for (const g of obj.segs) sprinkleLeaves(world, g, 0.6);
  } else if (spec.kind === 'grass') {
    const tuft = { x: spec.base.x, y: spec.base.y, size: 0.3, seed: world.rand() * 1000, dying: false };
    Object.assign(obj, { genome: spec.genome, tufts: [tuft] });
  } else if (spec.kind === 'vine') {
    const { x, y } = spec.base;
    Object.assign(obj, { genome: spec.genome, hold: spec.hold, nodes: [{ x, y, px: x, py: y }], growth: 0 });
  } else {
    obj.species = spec.species;
    obj.stems = [];
    obj.stems.push(seedling(world, obj));
  }
  world.objects.push(obj);
  if (obj.segs) {
    world.branches.push(...obj.segs);
    rebuildJunctions(world);
  }
  return obj;
};

// Take an object out. Knocked-down sticks and plants tumble to the floor as debris.
const removeObject = (world, obj, knocked = false) => {
  world.objects = world.objects.filter((o) => o !== obj);
  if (knocked && obj.kind === 'stick') {
    for (const g of obj.segs) fling(world, g.root, g.tip, { kind: 'stick', wood: obj.wood });
  }
  if (knocked && obj.kind === 'plant') {
    for (const st of obj.stems) fling(world, st.root, st.tip, { kind: 'stem', plant: obj });
  }
  if (knocked && obj.kind === 'vine') {
    const look = { kind: 'vine', vine: obj };
    for (let i = 2; i < obj.nodes.length; i += 2) fling(world, obj.nodes[i - 2], obj.nodes[i], look);
  }
  if (obj.segs) removeSegments(world, obj.segs);
};

// Pick something to buy: an offer from the showcase, or a fixed-price item. Picking it again puts it back.
export const startPlacing = (world, kind, offer = null) => {
  kind = offer?.type ?? kind; // a plant offer may be grass or a vine
  const price = offer ? offer.price : PRICES[kind];
  const same = world.placing?.kind === kind && world.placing.offer === offer;
  const full =
    (kind === 'bug' && world.bugs.length >= params.maxBugs) ||
    (kind === 'flier' && world.fliers.length >= params.maxFliers);
  const ok = !same && !full && !offer?.sold && world.coins >= price;
  const seed = offer?.seed ?? Math.floor(world.rand() * 2 ** 31);
  world.placing = ok ? { kind, offer, price, seed, at: world.time } : null;
  if (world.placing) Object.assign(world, { tool: 'hand', demo: null });
};

// Esc: put down whatever is waiting to go somewhere, a shop item or a plant picked to propagate.
export const cancelPlacing = (world) => {
  Object.assign(world, { placing: null, moving: null });
};

export const setTool = (world, tool) => {
  if (tool !== world.tool) world.demo = tool === 'hand' ? null : { kind: tool, at: world.time };
  Object.assign(world, { tool, placing: null, painting: false, moving: null });
};

// Wallpaper goes straight up when bought, over whatever was there before, and is kept to put back up any time.
export const buyWallpaper = (world, offer) => {
  if (offer.sold || world.coins < offer.price) return;
  world.wallpaper = makeWallpaper(mulberry32(offer.seed));
  world.wallpapers.push(world.wallpaper);
  world.coins -= offer.price;
  offer.sold = true;
  world.placing = null;
};

// Put a wallpaper bought before back up, or none (null) for plain black. Free.
export const hangWallpaper = (world, wp) => {
  world.wallpaper = wp;
};

const placeItem = (world, x, y) => {
  const { kind, seed, offer, price } = world.placing;
  const decor = !['bug', 'fish', 'flier', 'fountain'].includes(kind) && build(world, kind, seed, x, y);
  if (decor === null) return; // nothing to stand on near there: keep holding it
  world.placing = null;
  if (world.coins < price || offer?.sold) return;
  if (kind === 'bug') {
    if (!addBug(world, x, y, offer.genes, offer.name)) return; // the tank is full
  } else if (kind === 'fish') {
    world.fish.push(newFish(world, x, y, offer.genome, offer.name));
  } else if (kind === 'flier') {
    if (world.fliers.length >= params.maxFliers) return;
    addFlier(world, x, y, offer.genome, offer.name);
  } else if (kind === 'fountain') {
    placeFountain(world.terrain, x, y, world.rand);
  } else {
    addDecor(world, decor);
  }
  world.coins -= price;
  if (offer) offer.sold = true;
};

// A showcased offer: a particular bug, plant, stick or wallpaper, priced by how special it is.
const makeOffer = (world, kind) => {
  const offer = { id: ++world.offers, kind, seed: Math.floor(world.rand() * 2 ** 31), sold: false };
  if (kind === 'bug') {
    // Bugs come as stick insects or one of the fliers (ladybugs, shield bugs and soldier beetles), each with its own
    // genome.
    const type = world.rand();
    if (type < 0.55) {
      const kind = type < 0.25 ? 'ladybug' : type < 0.4 ? 'shieldbug' : 'soldier';
      const genome = makeFlier(mulberry32(offer.seed), kind);
      return { ...offer, type: 'flier', genome, name: flierName(world.rand, kind), price: flierPrice(genome) };
    }
    const genes = randomGenes(world.rand, params.variety);
    const rarity = GENES.reduce((n, g) => n + Math.abs(genes[g.key]) / g.spread, 0) / GENES.length;
    const pattern = [0, 15, 40][patternRarity(genes)]; // a rare pattern, or a rarer one
    return { ...offer, genes, name: randomName(world.rand), price: 10 + Math.round(rarity * 60) + pattern };
  }
  if (kind === 'fish') {
    const genome = makeGuppy(mulberry32(offer.seed));
    return { ...offer, genome, name: guppyName(world.rand), price: guppyPrice(genome) };
  }
  if (kind === 'plant') {
    // Plants come in four types, each with its own genome: flowering plants, clump plants (a crown of leaves
    // with flower stalks or runners), grass and hanging vines.
    const type = world.rand();
    if (type < 0.2) {
      const g = makeGrass(mulberry32(offer.seed));
      return { ...offer, type: 'grass', name: g.name, price: 6 + Math.round(g.height) + (g.blossom ? 3 : 0) };
    }
    if (type < 0.4) {
      const g = makeVine(mulberry32(offer.seed));
      return { ...offer, type: 'vine', name: g.name, price: 8 + Math.round(g.maxNodes / 3) + (g.flower ? 3 : 0) };
    }
    if (type < 0.65) {
      const sp = makeClump(mulberry32(offer.seed));
      const showy = sp.form === 'strelitzia' ? 8 : sp.flower ? 4 : 0;
      const price = 8 + Math.round(sp.leafLen / 4) + showy + (sp.premium ?? 0) + rarePrice(sp);
      return { ...offer, type: 'clump', name: sp.name, price };
    }
    const sp = makeSpecies(mulberry32(offer.seed));
    return { ...offer, name: sp.name, price: 6 + sp.maxNodes + Math.round(sp.flower.size * 3) + rarePrice(sp) };
  }
  if (kind === 'wallpaper') {
    const wp = makeWallpaper(mulberry32(offer.seed));
    return { ...offer, name: wp.name, price: 6 + 2 * wp.detail + (wp.vivid ? 15 : 0) };
  }
  const stick = makeStick(mulberry32(offer.seed), { x: world.W, y: world.ground.y0 }, 2 * world.W, world.H); // whole
  return { ...offer, name: stick.name, price: 4 + 2 * Math.min(stick.pieces.length, 12) };
};

// Fill the showcase with fresh offers.
const rerollShop = (world) => {
  const offers = (kind) => Array.from({ length: OFFERS }, () => makeOffer(world, kind));
  world.shop = Object.fromEntries(SHOP_KINDS.map((kind) => [kind, offers(kind)]));
  if (world.placing?.offer) world.placing = null;
};

// Rerolling: the first reroll in a minute is free, then each one after it that minute costs REROLL_STEP more
// than the last (10, 20, 30...). A minute after the free one, the next is free again and the prices start over.
const FREE_REROLL_TICKS = 3600;
const REROLL_STEP = 10;

const freshRerolls = (world) => !world.rerolls || world.time - world.rerolls.since >= FREE_REROLL_TICKS;

export const rerollCost = (world) => (freshRerolls(world) ? 0 : world.rerolls.count * REROLL_STEP);

// Ticks until the next free reroll; 0 when it's free now.
const freeRerollIn = (world) =>
  freshRerolls(world) ? 0 : world.rerolls.since + FREE_REROLL_TICKS - world.time;

export const buyReroll = (world) => {
  const cost = rerollCost(world);
  if (world.coins < cost) return;
  world.coins -= cost;
  if (cost === 0) world.rerolls = { since: world.time, count: 1 };
  else world.rerolls.count++;
  rerollShop(world);
};

// Put an offer into a scratch world, fully grown (or for wallpaper, hung), for its picture. Returns the box
// around it.
export const stageOffer = (world, offer) => {
  const x = world.W / 2;
  const box = (pts, pad) => {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      x0: Math.min(...xs) - pad,
      y0: Math.min(...ys) - pad,
      x1: Math.max(...xs) + pad,
      y1: Math.max(...ys) + pad,
    };
  };
  if ((offer.type ?? offer.kind) === 'flier') {
    // On the floor, facing right.
    const b = Object.assign(newFlier(world, x, world.ground.y0, offer.genome), { mode: 'ground', dir: 1 });
    world.fliers.push(b);
    const { len, high } = flierShape(offer.genome);
    return { x0: x - len / 2 - 1, x1: x + len / 2 + 2, y0: b.y - high - 2, y1: b.y + 1 };
  }
  if (offer.kind === 'bug') {
    const bug = newBug(world, x, 0, offer.genes);
    const floor = floorAt(world, x);
    land(world, bug, floor, project(floor, x, world.ground.y0), 1);
    bodyPose(floor, bug.s, bug.dir, 1, bug.t).forEach((p, i) =>
      Object.assign(bug.pts[i], { x: p.x, y: p.y, px: p.x, py: p.y }),
    );
    world.bugs.push(bug);
    for (let i = 0; i < 6; i++) step(world);
    const reach = bug.t.antenna * bug.t.size;
    const b = box([...bug.pts, ...bug.legs.map((l) => l.foot).filter(Boolean)], 3);
    return { x0: b.x0 - reach, x1: b.x1 + reach, y0: b.y0 - reach * 0.5, y1: world.ground.y0 + 2 };
  }
  if (offer.kind === 'fish') {
    // Side on, facing right, mid-stroke.
    const fish = Object.assign(newFish(world, x, world.H / 2, offer.genome), { facing: 1, tail: 1 });
    world.fish.push(fish);
    const { len, tail, spread, dorsal } = fishShape(offer.genome);
    return { x0: x - len / 2 - tail - 2, x1: x + len / 2 + 2, y0: fish.y - spread - dorsal, y1: fish.y + spread + 1 };
  }
  if (offer.kind === 'wallpaper') {
    world.wallpaper = offer.wallpaper ?? makeWallpaper(mulberry32(offer.seed)); // one already bought, or on offer
    return { x0: 0, y0: 0, x1: world.W, y1: world.H };
  }
  const kind = offer.type ?? offer.kind;
  if (kind === 'vine') {
    // Nothing to hang from in a scratch world, so it hangs from the top, fully grown.
    const vine = addDecor(world, build(world, kind, offer.seed, x, 30));
    while (vine.nodes.length < vine.genome.maxNodes) growVine(world, vine, vine.genome.growTicks);
    for (let i = 0; i < 300; i++) growVine(world, vine, 0);
    return { ...box(vine.nodes, 4 + 5 * vine.genome.leafSize), y0: 0 };
  }
  if (kind === 'grass') {
    const patch = addDecor(world, build(world, kind, offer.seed, x, world.H));
    for (let i = 0; i < 8000 && patch.tufts.length < 10; i++) growGrass(world, patch, 4); // a small sample patch
    for (let i = 0; i < 400; i++) growGrass(world, patch, 4);
    const tops = patch.tufts.map((t) => ({ x: t.x, y: t.y - patch.genome.height }));
    return { ...box(tops, 4), y1: world.ground.y0 + 2 };
  }
  const obj = addDecor(world, build(world, kind, offer.seed, x, world.H));
  if (obj.kind === 'plant') {
    const sp = obj.species;
    const growing = () => obj.stems.some((st) => st.growing || st.sprout > 0 || (st.bud && st.flower < 1));
    const busy = () => growing() || (sp.form && !crownFull(obj));
    for (let i = 0; i < 20000 && busy(); i++) growPlant(world, obj, sp.form ? 10 : 4);
    const pad = sp.form ? 3 + sp.leafWidth + 6 * (sp.flower?.size ?? 0) : 8 + sp.flower.size * 6;
    const b = box(obj.stems.flatMap((st) => [st.root, st.tip]), pad);
    return { ...b, y1: world.ground.y0 + 2 };
  }
  const b = box(obj.segs.flatMap((g) => [g.root, g.tip]), 6 * obj.foliage.size);
  return { ...b, y1: world.ground.y0 + 2 };
};

// ---------- plants ----------

// Plants grow node by node from their base: each stem lengthens to its internode, grows a pair of leaves
// at the node, and carries on with one shoot (sometimes two). Fully grown tips flower. They sway and are
// decoration, not something to walk on.
const newStem = (world, plant, parent, from, angle) => ({
  root: from,
  tip: from,
  angle,
  parent,
  depth: parent ? parent.depth + 1 : 0,
  target: plant.species.internode * (0.8 + world.rand() * 0.4),
  len: 0,
  growing: true,
  bend: 0, // radians it's bent off the way it grew, at its root
  spin: 0, // how fast the bend is changing
  turn: 0, // how far it's turned in all: its bend and the turn of the stem it grows from
  sprout: 0, // ticks until a pruned stem sprouts new shoots
  bud: false, // it flowers (out of the water)
  flower: 0, // bloom, 0..1
  sideBloom: false, // a flower part way up the stem rather than at a tip
  leaves: [], // {at: 0..1 along the stem, side: +-1, size}
});

const sprout = (world, plant, stem, n) => {
  const sp = plant.species;
  const upright = (-Math.PI / 2 - stem.angle) * 0.35;
  const angles =
    n === 1
      ? [stem.angle + upright + (world.rand() - 0.5) * sp.wobble]
      : [-1, 1].map((s) => stem.angle + upright + s * (0.45 + world.rand() * 0.4));
  for (const angle of angles) plant.stems.push(newStem(world, plant, stem, stem.tip, angle));
};

const growPlant = (world, plant, rate) => {
  const sp = plant.species;
  if (sp.form) return growClump(world, plant, rate);
  for (const stem of [...plant.stems]) {
    for (const leaf of stem.leaves) leaf.size = Math.min(1, leaf.size + LEAF_GROWTH * 2 * rate);
    openFlower(world, stem, rate);
    if (stem.sprout > 0) {
      stem.sprout -= rate;
      if (stem.sprout <= 0) {
        stem.sprout = 0;
        sprout(world, plant, stem, 2); // pruned stems bush out
      }
    }
    if (!stem.growing) continue;
    stem.len += sp.speed * rate;
    if (stem.len < stem.target && stem.tip.y > 3 && stem.tip.x > 1 && stem.tip.x < world.W - 2) continue;
    stem.growing = false;
    stem.leaves.push({ at: 1, side: 1, size: 0 }, { at: 1, side: -1, size: 0 });
    if (stem.depth + 1 >= sp.maxNodes || stem.tip.y <= 3) {
      stem.bud = true;
    } else {
      // Flowering along the stem: smaller than the flowers at the tips.
      if (world.rand() < sp.flower.nodeBloom) Object.assign(stem, { bud: true, sideBloom: true });
      sprout(world, plant, stem, world.rand() < sp.branchChance ? 2 : 1);
    }
  }
  bendPlant(world, plant);
};

// A bud swells and opens into a flower, but only in the air: under water it closes up again, until the water's gone.
// A bare tip doesn't bud while it rests after its last flower.
const openFlower = (world, stem, rate) => {
  if (!stem.bud || stem.rest > 0) return;
  stem.flower = clamp(stem.flower + (wetAt(world.terrain, stem.tip) ? -0.01 : 0.002 * rate), 0, 1);
};

// Something a plant drops, to flutter down: a leaf or a petal.
const shed = (world, at, look) => {
  if (world.litter.length >= MAX_LITTER) world.litter.shift();
  world.litter.push({
    ...at,
    look,
    state: 'fall',
    phase: world.lifeRand() * 6, // of its flutter
    rot: 0, // lying on the ground it browns and curls up as this goes to 1, and is gone
    size: 1, // fish bite it smaller
    life: 1, // eaten, like crumbs and flakes, when a fish takes it to 0
  });
};

// Leaves get old (sooner on a plant with aphids on it). One past its time yellows and drops, and its node buds a new
// one in its place: one leaf at a time, so a plant never looks poorly.
const ageLeaves = (world, plant) => {
  const life = ((plant.species.leafLife ?? LEAF_LIFE) * params.leafLife) / (1 + 0.1 * (plant.pests ?? 0));
  let fading = null;
  let due = null; // the leaf longest past its time
  for (const stem of plant.stems) {
    for (const leaf of stem.leaves) {
      leaf.age = (leaf.age ?? Math.floor(world.lifeRand() * life)) + 1; // new ones start part way, not all together
      if (leaf.fade) fading = { stem, leaf };
      else if (leaf.age > life && !(due?.leaf.age > leaf.age)) due = { stem, leaf };
    }
  }
  if (!fading) {
    if (due) due.leaf.fade = 1 / LEAF_FADE;
    return;
  }
  const { stem, leaf } = fading;
  leaf.fade += 1 / LEAF_FADE;
  if (leaf.fade < 1) return;
  const sp = plant.species;
  const look = { shape: sp.shape, color: sp.leaf, grown: leaf.size, scale: sp.leafSize, flip: leaf.side };
  shed(world, lerp(stem.root, stem.tip, leaf.at), look);
  Object.assign(leaf, { size: 0, age: 0, fade: 0 });
};

// Flowers come and go. An open flower lasts a while (its age counts up to the bloom life from somewhere either side
// of 0, so no two last quite as long), then wilts, dropping its petals one by one, and the bare tip rests before it
// buds and opens again. Not the baby plants at the ends of runners.
const ageFlowers = (world, plant) => {
  const r = world.lifeRand;
  const life = BLOOM_LIFE * params.bloomLife;
  const f = plant.species.flower;
  for (const stem of plant.stems) {
    if (stem.rest > 0) stem.rest--;
    if (!stem.bud || stem.flower < 1 || (stem.role === 'runner' && !stem.sideBloom)) continue;
    stem.age ??= Math.floor((r() - 0.5) * life);
    if (++stem.age < life) continue;
    const petals = f.petals ?? 4;
    const fallen = Math.floor((stem.wilt ?? 0) * petals);
    stem.wilt = (stem.wilt ?? 0) + 1 / WILT_TICKS;
    if (Math.floor(stem.wilt * petals) > fallen) {
      const at = { x: stem.tip.x + (r() - 0.5) * 4, y: stem.tip.y + (r() - 0.5) * 2 };
      shed(world, at, { petal: true, color: f.petal ?? f.crest ?? f.spathe ?? f.color });
    }
    if (stem.wilt >= 1) {
      Object.assign(stem, { flower: 0, wilt: 0, age: Math.floor((r() - 0.5) * life), rest: REST_TICKS * (0.5 + r()) });
    }
  }
};

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Each stem points the way it grew, turned as far as the stem it grows from, and bent at its root. Bent, it springs
// back, so a plant pulled about bends along its length and wobbles back when let go, the breeze sways it, and
// under water the current rocks it.
const bendPlant = (world, plant) => {
  const pull = world.pull?.obj === plant && plant.stems.includes(world.pull.stem) ? world.pull : null;
  const goals = pull ? reachFor(plant, pull.stem, add(world.pointer, pull.off)) : null;
  for (const stem of plant.stems) {
    // A clump plant's leaves come up across its crown, dx either side of the middle.
    const root = stem.parent ? stem.parent.tip : stem.dx ? { x: plant.base.x + stem.dx, y: plant.base.y } : plant.base;
    const rest = stem.angle + (stem.parent?.turn ?? 0); // the way it points unbent
    const goal = goals?.get(stem);
    if (goal) {
      const bend = wrapAngle(Math.atan2(goal.y - root.y, goal.x - root.x) - rest);
      [stem.spin, stem.bend] = [wrapAngle(bend - stem.bend), bend];
    } else {
      const wet = wetAt(world.terrain, stem.tip);
      const push = wet
        ? CURRENT * Math.sin(world.time * 0.03 - stem.depth * 0.5 + plant.base.x)
        : PLANT_WIND * wind(world, stem.tip.x);
      stem.spin = (stem.spin - stem.bend * BEND_STIFFNESS - push * Math.sin(rest + stem.bend)) * BEND_DAMPING;
      stem.bend += stem.spin;
    }
    stem.turn = (stem.parent?.turn ?? 0) + stem.bend;
    Object.assign(stem, { root, tip: add(root, dirOf(rest + stem.bend), stem.len) });
  }
};

// Where each stem from the base up to the one pulled should point for that one's tip to reach goal, or get as near
// as it can: a pass of FABRIK a tick, plenty to keep up with the pointer.
const reachFor = (plant, pulled, goal) => {
  const chain = [];
  for (let s = pulled; s; s = s.parent) chain.unshift(s);
  const toward = (a, b, len) => lerp(a, b, len / (dist(a, b) || 1));
  const n = chain.length;
  const pts = [plant.base, ...chain.map((s) => s.tip)];
  const total = chain.reduce((sum, s) => sum + s.len, 0);
  pts[n] = toward(plant.base, goal, Math.min(total, dist(plant.base, goal)));
  for (let i = n - 1; i > 0; i--) pts[i] = toward(pts[i + 1], pts[i], chain[i].len);
  for (let i = 1; i <= n; i++) pts[i] = toward(pts[i - 1], pts[i], chain[i - 1].len);
  return new Map(chain.map((s, i) => [s, pts[i + 1]]));
};

const stemDescendants = (plant, stem) => {
  const out = [];
  const visit = (s) => {
    for (const c of plant.stems) {
      if (c.parent !== s) continue;
      out.push(c);
      visit(c);
    }
  };
  visit(stem);
  return out;
};

// Cut a stem at p: everything above falls off and sells as clippings, and the stump bushes out again. On a clump
// plant the stump of a leaf, stalk or runner stays as it is, trimmed, until the crown grows a new one to replace it.
const prunePlant = (world, plant, stem, p) => {
  const clump = !!plant.species.form;
  const look = { kind: 'stem', plant, leaf: stem.role === 'leaf' };
  const doomed = stemDescendants(plant, stem);
  let clipped = dist(p, stem.tip);
  for (const s of doomed) {
    clipped += dist(s.root, s.tip);
    fling(world, s.root, s.tip, look);
  }
  fling(world, p, stem.tip, look);
  const kept = dist(stem.root, p);
  if (kept < 2) {
    doomed.push(stem);
    if (stem.parent && !clump) stem.parent.sprout = SPROUT_TICKS;
  } else {
    const was = dist(stem.root, stem.tip);
    stem.leaves = stem.leaves.filter((l) => l.at * was <= kept).map((l) => ({ ...l, at: (l.at * was) / kept }));
    const sprout = clump ? 0 : SPROUT_TICKS;
    Object.assign(stem, { tip: p, len: kept, growing: false, bud: false, flower: 0, sprout });
  }
  if (clump) chainRoot(stem).trimmed = true;
  plant.stems = plant.stems.filter((s) => !doomed.includes(s));
  if (!plant.stems.length) world.objects = world.objects.filter((o) => o !== plant);
  earn(world, Math.max(1, Math.round((clipped / CLIPPING_LEN) * (plant.species.worth ?? 1))), p.x, p.y);
};

// ---------- clump plants ----------

// A plant's first shoot: a stem, or for a clump plant its first leaf.
const seedling = (world, plant) =>
  plant.species.form
    ? newChain(world, plant, 'leaf')
    : newStem(world, plant, null, plant.base, -Math.PI / 2 + plant.species.lean);

const chainRoot = (stem) => {
  let root = stem;
  while (root.parent) root = root.parent;
  return root;
};

// Start a new leaf, flower stalk or runner in a clump plant's crown: a chain of short stems, grown one after
// another, each turned a little further (curl) toward hanging down on the side it leans to. Leaves fan out by the
// golden ratio, so they spread evenly however many there are, the middle ones standing up and the outer ones
// arching over; stalks come up nearer the middle, and runners lean well out.
const newChain = (world, plant, role) => {
  const sp = plant.species;
  plant.chains = (plant.chains ?? 0) + 1;
  const spread = ((plant.chains * 0.618034 + plant.base.x * 0.137) % 1) * 2 - 1;
  const side = Math.sign(spread) || 1;
  const lean =
    role === 'runner' ? side * (0.9 + 0.3 * Math.abs(spread)) : spread * sp.fan * (role === 'stalk' ? 0.4 : 1);
  const full = sp.leafLen * (role === 'leaf' ? 1 : sp.stalkLen) * (0.8 + 0.4 * world.rand());
  const n = Math.max(2, Math.round(full / CHAIN_SEG));
  return Object.assign(newStem(world, plant, null, plant.base, -Math.PI / 2 + lean), {
    role,
    left: n - 1, // stems still to grow after this one
    curl: (role === 'leaf' ? sp.curl : sp.stalkCurl) * (role === 'runner' ? 1 : 0.3 + 0.7 * Math.abs(spread)),
    side,
    full, // px it'll be, grown
    target: full / n,
    seed: world.rand() * 1000,
    dx: spread * sp.crown * (role === 'leaf' ? 1 : 0.5),
  });
};

// A clump plant's crown: whole leaves and stalks (or runners), not counting trimmed stumps, and how many are still
// growing.
const crownOf = (plant) => {
  const c = { leaves: 0, stalks: 0, growing: 0 };
  for (const st of plant.stems) {
    if (st.growing) c.growing++;
    if (!st.parent && !st.trimmed) c[st.role === 'leaf' ? 'leaves' : 'stalks']++;
  }
  return c;
};
const crownFull = (plant) => {
  const c = crownOf(plant);
  return c.leaves >= plant.species.leaves && c.stalks >= plant.species.stalks;
};

// A trimmed stump drops off when a new leaf (or stalk) comes up to replace it.
const dropChain = (world, plant, root) => {
  const chain = [root, ...stemDescendants(plant, root)];
  for (const s of chain) fling(world, s.root, s.tip, { kind: 'stem', plant, leaf: s.role === 'leaf' });
  plant.stems = plant.stems.filter((s) => !chain.includes(s));
};

// A clump plant grows a few leaves at a time until its crown is full, then its flower stalks or runners. Each leaf
// grows a stem at a time; a stalk flowers at its end. A runner arches out and hangs down, with a little flower
// here and there, until it reaches its length or touches down, and grows a baby plant at its end.
const growClump = (world, plant, rate) => {
  const sp = plant.species;
  const ter = world.terrain;
  for (const stem of [...plant.stems]) {
    openFlower(world, stem, rate);
    if (!stem.growing) continue;
    stem.len += sp.speed * rate;
    const { x, y } = stem.tip;
    const roomy = y > 3 && x > 1 && x < world.W - 2;
    // A runner lands once it's hanging lower than the crown it came from and touches something.
    const low = stem.role === 'runner' && y > plant.base.y + 2;
    const landed = low && (y >= world.ground.y0 - 1 || solidAt(ter, x, y + 1.5));
    if (stem.len < stem.target && roomy && !landed) continue;
    stem.growing = false;
    if (stem.left > 0 && roomy && !landed) {
      const toward = stem.side > 0 ? Math.PI / 2 : -1.5 * Math.PI; // straight down, coming round on its side
      const next = newStem(world, plant, stem, stem.tip, stem.angle + (toward - stem.angle) * stem.curl);
      const bloom = stem.role === 'runner' && world.rand() < 0.3;
      const { role, curl, side, full, target, seed } = stem;
      plant.stems.push(Object.assign(next, { role, left: stem.left - 1, curl, side, full, target, seed }));
      Object.assign(next, { bud: bloom, sideBloom: bloom });
    } else if (stem.role !== 'leaf') {
      Object.assign(stem, { bud: true, sideBloom: false });
    }
  }
  const c = crownOf(plant);
  if (c.growing < Math.max(2, Math.ceil(sp.leaves / 5)) && world.rand() < CROWN_CHANCE * rate) {
    const stalk = sp.flower?.kind === 'runner' ? 'runner' : 'stalk';
    const role = c.leaves < sp.leaves ? 'leaf' : c.stalks < sp.stalks ? stalk : null;
    if (role) {
      const stump = plant.stems.find((st) => !st.parent && st.trimmed && (st.role === 'leaf') === (role === 'leaf'));
      if (stump) dropChain(world, plant, stump);
      plant.stems.push(newChain(world, plant, role));
    }
  }
  bendPlant(world, plant);
};

// ---------- grass and vines ----------

// Is (x, y) ground that grass can grow in: painted dirt or sand, or the bare tank floor?
const isSoil = (world, x, y) => {
  const ter = world.terrain;
  const i = cellAt(ter, x, y + 1);
  if (i >= 0 && ter.cells[i] !== EMPTY) return ter.cells[i] === DIRT || ter.cells[i] === SAND;
  return Math.abs(y - world.ground.y0) < 1;
};

// The top of the ground at x, at or below y, to the cell: the first solid cell going down, or the tank floor.
// From inside the terrain or the floor strip under it, the top of that solid stretch instead. Grass needs this
// rather than the walkable outline, which smooths over bumps and can float a cell above the dirt.
const groundTop = (world, x, y) => {
  const ter = world.terrain;
  const c = clamp(Math.floor(x / CELL), 0, ter.cols - 1);
  const solid = (r) => ter.cells[r * ter.cols + c] !== EMPTY && ter.cells[r * ter.cols + c] !== WATER;
  let r = clamp(Math.floor((y - ter.top) / CELL), 0, ter.rows - 1);
  if (solid(r)) {
    while (r > 0 && solid(r - 1)) r--;
  } else {
    while (r < ter.rows && !solid(r)) r++;
  }
  return ter.top + r * CELL; // ter.rows down is the floor
};

// Is the column at x solid (terrain or the floor) all the way down from y0 to y1? Then grass at one end can
// spread to the other: it's the face of a pile, not a ledge with a gap under it.
const faceAt = (world, x, y0, y1) => {
  for (let y = y0 + CELL / 2; y < Math.min(y1, world.ground.y0); y += CELL) {
    if (!solidAt(world.terrain, x, y)) return false;
  }
  return true;
};

// Where grass sown near (x, y) takes root: whatever ground is below, within PLACE_REACH, whether or not it's
// soil. Null if there's none.
const sowAt = (world, x, y) => {
  const gx = clamp(x, 3, world.W - 4);
  const gy = groundTop(world, gx, y);
  return gy - y > PLACE_REACH ? null : { base: { x: gx, y: gy }, on: null }; // tufts mind their own soil
};

const solidAt = (ter, x, y) => {
  const i = cellAt(ter, x, y);
  return i >= 0 && ter.cells[i] !== EMPTY && ter.cells[i] !== WATER;
};

const wetAt = (ter, p) => ter.cells[cellAt(ter, p.x, p.y)] === WATER;

// Where to hang a vine off the terrain near (x, y): under a solid cell with open space below it (an overhang
// or a ledge), or against the face of one with open space beside and below it. at is where it hangs from,
// hold the middle of the cell holding it.
const terrainHook = (world, x, y) => {
  const ter = world.terrain;
  const reach = Math.ceil(VINE_REACH / CELL);
  const c0 = Math.floor(x / CELL);
  const r0 = Math.floor((y - ter.top) / CELL);
  const solid = (c, r) =>
    c >= 0 && c < ter.cols && r >= 0 && r < ter.rows && solidAt(ter, (c + 0.5) * CELL, ter.top + (r + 0.5) * CELL);
  let best = null;
  for (let r = Math.max(0, r0 - reach); r <= Math.min(ter.rows - 2, r0 + reach); r++) {
    for (let c = c0 - reach; c <= c0 + reach; c++) {
      if (!solid(c, r)) continue;
      const hold = { x: (c + 0.5) * CELL, y: ter.top + (r + 0.5) * CELL };
      const spots = [];
      if (!solid(c, r + 1)) spots.push({ x: hold.x, y: ter.top + (r + 1) * CELL + 0.5 });
      for (const dc of [-1, 1]) {
        if (solid(c + dc, r) || solid(c + dc, r + 1)) continue;
        spots.push({ x: dc < 0 ? c * CELL - 0.5 : (c + 1) * CELL + 0.5, y: hold.y });
      }
      for (const at of spots) {
        const d = dist(at, { x, y });
        if (d < VINE_REACH && (!best || d < best.d)) best = { d, at, hold };
      }
    }
  }
  return best;
};

// Grass grows tuft by tuft. Grown tufts seed neighbours a few px along the same dirt or sand, over bumps and up
// and down the faces of piles (but not cliffs, or onto a ledge with a gap under it); tufts that get buried or
// lose their soil (sand slides away, say) wither away. Under water they grow on (wet), but don't blossom.
const growGrass = (world, patch, rate) => {
  const g = patch.genome;
  const ter = world.terrain;
  const check = (world.time + Math.floor(patch.base.x)) % 10 === 0;
  for (const tuft of [...patch.tufts]) {
    if (check) {
      const above = ter.cells[cellAt(ter, tuft.x, tuft.y - 1)];
      const y = groundTop(world, tuft.x, tuft.y - 1);
      tuft.wet = above === WATER;
      const buried = above !== undefined && above !== EMPTY && above !== WATER;
      if (buried || Math.abs(y - tuft.y) > 3 || !isSoil(world, tuft.x, y)) {
        tuft.dying = true;
      } else {
        tuft.y = y;
      }
    }
    if (tuft.dying) {
      tuft.size -= 0.01 * rate;
      if (tuft.size <= 0) patch.tufts.splice(patch.tufts.indexOf(tuft), 1);
      continue;
    }
    tuft.size = Math.min(1, tuft.size + 0.002 * rate);
    if (tuft.size < 0.7 || patch.tufts.length >= MAX_TUFTS || world.rand() > g.spread * rate) continue;
    const x = tuft.x + (world.rand() < 0.5 ? -1 : 1) * g.spacing * (0.7 + world.rand() * 0.6);
    if (x < 1 || x > world.W - 2) continue;
    const y = groundTop(world, x, tuft.y - 1); // level with this tuft, then up the face or down to the ground
    const crowded = patch.tufts.some((o) => Math.abs(o.x - x) < g.spacing * 0.6 && Math.abs(o.y - y) < 4);
    const face = y < tuft.y ? faceAt(world, x, y, tuft.y) : faceAt(world, tuft.x, tuft.y, y);
    if (Math.abs(y - tuft.y) > GRASS_CLIMB || !face || crowded || !isSoil(world, x, y)) continue;
    patch.tufts.push({ x, y, size: 0.05, seed: world.rand() * 1000, dying: false });
  }
  if (!patch.tufts.length) world.objects = world.objects.filter((o) => o !== patch);
  // Pulled, the tufts near where it was grabbed bend over toward the pointer; let go, they spring back.
  const pull = world.pull?.obj === patch ? world.pull : null;
  if (pull) patch.flex = { dx: 0, v: 0, ...patch.flex, x: pull.x };
  const flex = patch.flex;
  if (!flex) return;
  const to = pull && clamp(world.pointer.x - pull.x, -g.height, g.height);
  flex.v = pull ? to - flex.dx : (flex.v - flex.dx * FLEX) * 0.85;
  flex.dx += flex.v;
  if (!pull && Math.abs(flex.dx) + Math.abs(flex.v) < 0.05) patch.flex = null;
};

// A vine is a rope of nodes hanging from its anchor: it grows a node at a time, sways in the breeze, and
// drapes onto whatever floor it reaches. Under water it floats and rocks in the current; pulled, the node
// grabbed follows the pointer as far as the rope reaches.
const growVine = (world, vine, rate) => {
  const g = vine.genome;
  const nodes = vine.nodes;
  // A vine hanging off the terrain comes down if the cell holding it is erased or slides away.
  const check = (world.time + Math.floor(vine.base.x)) % 10 === 0;
  if (vine.hold && check && !solidAt(world.terrain, vine.hold.x, vine.hold.y)) return removeObject(world, vine, true);
  vine.growth += rate;
  if (vine.growth >= g.growTicks && nodes.length < g.maxNodes) {
    vine.growth = 0;
    const last = nodes[nodes.length - 1];
    nodes.push({ x: last.x, y: last.y + 1, px: last.x, py: last.y + 1 });
  }
  const give = VINE_WIND * (1 - g.stiffness * 0.7); // how far the breeze moves it
  Object.assign(nodes[0], { x: vine.base.x, y: vine.base.y });
  nodes.forEach((p, i) => {
    if (i === 0) return;
    p.wet = wetAt(world.terrain, p);
    const vx = (p.x - p.px) * 0.95;
    const vy = (p.y - p.py) * 0.95;
    p.px = p.x;
    p.py = p.y;
    p.x += vx + (p.wet ? VINE_CURRENT * Math.sin(world.time * 0.03 - i * 0.4) : wind(world, p.x) * give);
    p.y += vy + params.gravity * (p.wet ? 0.1 : 0.4);
  });
  const held = world.pull?.obj === vine && world.pull.i < nodes.length ? world.pull.i : 0;
  if (held) {
    const goal = add(world.pointer, world.pull.off);
    Object.assign(nodes[held], lerp(nodes[0], goal, Math.min(1, (held * g.spacing) / (dist(nodes[0], goal) || 1))));
  }
  for (let it = 0; it < 4; it++) {
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1];
      const b = nodes[i];
      const [wa, wb] = [i - 1 === 0 || i - 1 === held ? 0 : 1, i === held ? 0 : 1]; // the anchor and held node stay
      if (!wa && !wb) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const k = (Math.hypot(dx, dy) - g.spacing) / (Math.hypot(dx, dy) || 1) / (wa + wb);
      b.x -= dx * k * wb;
      b.y -= dy * k * wb;
      a.x += dx * k * wa;
      a.y += dy * k * wa;
    }
  }
  for (const p of nodes.slice(1)) {
    const floor = floorBelow(world, p.x, p.py - 1).y - 1;
    if (p.y > floor) {
      p.y = floor;
      p.px = p.x - (p.x - p.px) * 0.5;
    }
  }
};

// Pruned grass and vines sell like plant clippings, by the px.
const sellClippings = (world, px, x, y) => {
  world.clippings = (world.clippings ?? 0) + px / CLIPPING_LEN;
  const coins = Math.floor(world.clippings);
  if (coins < 1) return;
  world.clippings -= coins;
  earn(world, coins, x, y);
};

// Mow grass around (x, y): tufts there are cut down to that height and grow back, unless that leaves only a
// stub, which dies.
const mow = (world, patch, x, y, r = 6) => {
  let cut = 0;
  for (const tuft of patch.tufts) {
    if (Math.abs(tuft.x - x) > r || tuft.y < y - 2 || tuft.y - patch.genome.height > y + r) continue;
    // It keeps what's below the cut; cut down to a stub, it dies.
    const kept = clamp((tuft.y - y) / patch.genome.height, 0, tuft.size);
    if (kept >= tuft.size) continue;
    cut += (tuft.size - kept) * patch.genome.height;
    tuft.size = kept;
    if (kept < GRASS_STUB) tuft.dying = true;
  }
  sellClippings(world, cut, x, y);
};

// Cut a vine above node i: everything below falls off and it grows back from the cut.
const pruneVine = (world, vine, i) => {
  const cut = vine.nodes.slice(i - 1);
  for (let k = 2; k < cut.length; k += 2) fling(world, cut[k - 2], cut[k], { kind: 'vine', vine });
  vine.nodes = vine.nodes.slice(0, i);
  vine.growth = 0;
  sellClippings(world, (cut.length - 1) * vine.genome.spacing, cut[0].x, cut[0].y);
};

// ---------- pruning ----------

// Prune a stick's seg at p: it's cut back to p, and everything growing out of it beyond the cut falls.
const pruneSegment = (world, seg, p) => {
  const look = { kind: 'stick', wood: seg.obj.wood };
  const doomed = descendants(seg);
  for (const g of doomed) fling(world, g.root, g.tip, look);
  fling(world, p, seg.tip, look);
  // Bugs standing on the part that's cut off fall with it; the rest shuffle onto what's left.
  const keep = dist(seg.root, p);
  const riders = world.bugs.filter((bug) => bug.surf === seg);
  for (const bug of riders) if (dist(seg.root, pointAt(seg, bug.s)) > keep) detach(bug, 'fall');
  if (keep < 3) doomed.push(seg);
  else shorten(seg, p);
  removeSegments(world, doomed);
  for (const bug of riders) {
    if (bug.surf !== seg) continue;
    const s = clampS(seg, bug.s, bug.t);
    if (Math.abs(s - bug.s) > 1) resetLegs(bug);
    bug.s = s;
  }
};

// The closest prunable thing within reach of (x, y).
const prunableAt = (world, x, y, plantsOnly = false) => {
  let best = null;
  const consider = (d, hit) => {
    if (!best || d < best.d) best = { d, ...hit };
  };
  for (const seg of world.branches) {
    if (seg.kind === 'terrain' || plantsOnly) continue;
    const d = distToSeg(seg, x, y);
    if (d < 5) consider(d, { seg, p: pointAt(seg, project(seg, x, y)) });
  }
  for (const obj of world.objects) {
    if (obj.kind === 'grass') {
      for (const tuft of obj.tufts) {
        const top = tuft.y - obj.genome.height * tuft.size;
        const d = Math.hypot(tuft.x - x, Math.max(0, top - y, y - tuft.y));
        if (d < 4) consider(d + 0.5, { grass: obj, p: { x, y } });
      }
    }
    if (obj.kind === 'vine') {
      for (let i = 1; i < obj.nodes.length; i++) {
        const [a, b] = [obj.nodes[i - 1], obj.nodes[i]];
        const d = distToSeg({ x0: a.x, y0: a.y, x1: b.x, y1: b.y }, x, y);
        if (d < 4) consider(d, { vine: obj, at: i, p: { x, y } });
      }
    }
    if (obj.kind !== 'plant') continue;
    for (const stem of obj.stems) {
      const g = { x0: stem.root.x, y0: stem.root.y, x1: stem.tip.x, y1: stem.tip.y };
      const d = distToSeg(g, x, y);
      const wide = stem.role === 'leaf' ? obj.species.leafWidth * 0.6 : 0; // a clump plant's broad leaves
      if (d < 4 + wide) consider(d, { plant: obj, stem, p: pointAt(g, project(g, x, y)) });
    }
  }
  return best;
};

const pruneHit = (world, hit) => {
  if (hit.grass) return mow(world, hit.grass, hit.p.x, hit.p.y);
  if (hit.vine) return pruneVine(world, hit.vine, hit.at);
  return hit.plant ? prunePlant(world, hit.plant, hit.stem, hit.p) : pruneSegment(world, hit.seg, hit.p);
};

// Cut everything a dragged line crosses, like trimming a hedge.
const cutAlong = (world, line) => {
  for (const seg of [...world.branches]) {
    if (seg.kind === 'terrain' || !world.branches.includes(seg)) continue;
    const p = segIntersect(seg, line);
    if (p) pruneSegment(world, seg, p);
  }
  for (const obj of world.objects.filter((o) => o.kind === 'grass' || o.kind === 'vine')) {
    if (obj.kind === 'vine') {
      const link = (a, b) => ({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
      const i = obj.nodes.findIndex((b, k) => k > 0 && segIntersect(link(obj.nodes[k - 1], b), line));
      if (i > 0) pruneVine(world, obj, i);
      continue;
    }
    for (const tuft of obj.tufts) {
      const blade = { x0: tuft.x, y0: tuft.y, x1: tuft.x, y1: tuft.y - obj.genome.height * tuft.size };
      const p = segIntersect(blade, line);
      if (p) mow(world, obj, p.x, p.y, 1);
    }
  }
  for (const plant of world.objects.filter((o) => o.kind === 'plant')) {
    for (const stem of [...plant.stems]) {
      if (!plant.stems.includes(stem)) continue;
      const p = segIntersect({ x0: stem.root.x, y0: stem.root.y, x1: stem.tip.x, y1: stem.tip.y }, line);
      if (p) prunePlant(world, plant, stem, p);
    }
  }
};

// ---------- input ----------

const bugAt = (world, x, y) => {
  let best = GRAB_RADIUS ** 2;
  let hit = null;
  for (const bug of world.bugs) {
    for (let i = 0; i < SEGMENTS; i++) {
      const d2 = (bug.pts[i].x - x) ** 2 + (bug.pts[i].y - y) ** 2;
      if (d2 < best) [best, hit] = [d2, { bug, i, d: Math.sqrt(d2) }];
    }
  }
  return hit;
};

// The bug, fish or flier nearest (x, y), within reach.
const creatureAt = (world, x, y) => {
  const hits = [bugAt(world, x, y), fishAt(world, x, y), flierAt(world, x, y)].filter(Boolean);
  return hits.reduce((a, h) => (!a || h.d < a.d ? h : a), null);
};

export const pointerDown = (world, x, y) => {
  world.pointer = { x, y };
  world.demo = null; // they've got the idea
  if (world.tool === 'paint') {
    world.painting = true;
    return paintAt(world, world.pointer);
  }
  if (world.placing) return placeItem(world, x, y);
  if (world.tool === 'move') {
    const obj = liftable(prunableAt(world, x, y));
    if (obj) world.moving = { obj, x, y };
    return;
  }
  if (world.tool === 'propagate') {
    // Two taps: one on a grown plant to take a cutting from, one where its seedling goes. Tapping the plant
    // again puts it back.
    const plant = prunableAt(world, x, y, true)?.plant;
    const picked = world.moving?.obj;
    if (!picked) {
      if (plant && propagatable(plant)) world.moving = { obj: plant, x, y };
    } else if (plant === picked) {
      world.moving = null;
    } else {
      const to = standAt(world, x, y);
      if (!to) return; // nowhere to plant it there: keep it picked
      world.moving = null;
      if (world.objects.includes(picked) && propagatable(picked)) propagate(world, picked, to);
    }
    return;
  }
  if (world.tool === 'prune') {
    world.cut = { x0: x, y0: y, x1: x, y1: y };
    return;
  }
  const hit = creatureAt(world, x, y);
  if (hit) world.press = { ...hit, x, y };
  else world.touch = { x, y, hit: prunableAt(world, x, y, true) }; // a plant there, to pull if it's dragged
  if (!hit?.fish) startle(world, x, y); // a tap on the glass
  if (!hit?.flier) startleFliers(world, x, y);
  startleVisitors(world, x, y);
};

// Take hold of a plant, vine or grass where it was pressed (hit, as prunableAt gives it), to pull it about: a
// plant by the stem, a vine by the node below, grass where it was grabbed.
const grab = (hit) => {
  const off = (p) => ({ x: p.x - hit.p.x, y: p.y - hit.p.y });
  if (hit.plant) return { obj: hit.plant, stem: hit.stem, off: off(hit.stem.tip) };
  if (hit.vine) return { obj: hit.vine, i: hit.at, off: off(hit.vine.nodes[hit.at]) };
  return { obj: hit.grass, x: hit.p.x };
};

export const pointerMove = (world, x, y) => {
  const last = world.pointer;
  world.pointer = { x, y };
  if (world.painting) {
    // Paint along the way so a quick stroke leaves no gaps.
    const n = Math.ceil(dist(last, world.pointer) / CELL);
    for (let i = 1; i <= n; i++) paintAt(world, lerp(last, world.pointer, i / n));
    return;
  }
  const press = world.press;
  if (press && Math.hypot(x - press.x, y - press.y) > PRESS_SLOP) {
    world.press = null;
    if (press.fish) {
      world.held = { fish: press.fish };
    } else if (press.flier) {
      world.held = { flier: press.flier };
    } else {
      detach(press.bug, 'held');
      world.held = { bug: press.bug, i: press.i };
    }
  }
  const touch = world.touch;
  if (touch?.hit && Math.hypot(x - touch.x, y - touch.y) > PRESS_SLOP) {
    world.touch = null;
    world.pull = grab(touch.hit);
  }
  if (world.cut) Object.assign(world.cut, { x1: x, y1: y });
};

export const pointerUp = (world, x, y) => {
  pointerMove(world, x, y);
  if (world.painting) {
    world.painting = false;
    return;
  }
  const moving = world.moving;
  if (moving && world.tool === 'move') {
    world.moving = null;
    const [dx, dy] = [x - moving.x, y - moving.y];
    const to = Math.hypot(dx, dy) >= TAP_SLOP && destination(world, moving.obj, dx, dy);
    if (to && world.objects.includes(moving.obj)) relocate(world, moving.obj, to);
    return;
  }
  if (world.press) {
    world.selected = world.press.bug ?? world.press.fish ?? world.press.flier;
    world.press = null;
    return;
  }
  if (world.held) {
    const { bug, fish, flier } = world.held;
    world.held = null;
    if (bug) setState(bug, 'fall', 0);
    if (flier) letGo(world, flier);
    if (fish) Object.assign(fish, { fear: 40, fearDelay: 0, from: { x, y: y - 5 } }); // let go, it shoots off
  }
  if (world.pull) {
    world.pull = null; // let go, it springs back
    return;
  }
  const cut = world.cut;
  world.cut = null;
  if (cut) {
    if (Math.hypot(cut.x1 - cut.x0, cut.y1 - cut.y0) >= TAP_SLOP) cutAlong(world, cut);
    else tap(world, x, y);
    return;
  }
  const touch = world.touch;
  world.touch = null;
  if (touch && Math.hypot(x - touch.x, y - touch.y) < TAP_SLOP) tap(world, x, y);
};

export const pointerCancel = (world) => {
  if (world.held?.bug) setState(world.held.bug, 'fall', 0);
  Object.assign(world, { held: null, press: null, touch: null, pull: null, cut: null, painting: false, moving: null });
};

// What a press at the pointer would do, to show it before it's done: grab a bug or fish, cut something there (hit, as
// prunableAt gives it), lift a plant to move it, pick a plant to take a cutting from, or put down the plant
// lifted or picked. Null if nothing, or the pointer isn't over the tank.
export const aimAt = (world) => {
  if (!world.hover || world.placing || world.held || world.pull || world.cut || world.painting) return null;
  const { x, y } = world.pointer;
  const tool = world.tool;
  const who = tool === 'hand' && creatureAt(world, x, y);
  if (who) return { kind: who.bug ? 'bug' : who.fish ? 'fish' : 'flier' };
  if (tool === 'hand' || tool === 'prune') {
    const hit = prunableAt(world, x, y);
    return hit && { kind: 'cut', hit };
  }
  if (tool !== 'move' && tool !== 'propagate') return null;
  if (world.moving) return { kind: 'drop' };
  const hit = prunableAt(world, x, y, tool === 'propagate');
  if (tool === 'move' && hit) return { kind: 'lift', obj: liftable(hit) };
  return hit?.plant && tool === 'propagate' && propagatable(hit.plant) ? { kind: 'pick', obj: hit.plant } : null;
};

// Tap something to prune it; tap empty space to deselect.
const tap = (world, x, y) => {
  const hit = prunableAt(world, x, y);
  if (hit) pruneHit(world, hit);
  else world.selected = null;
};

// ---------- relocating plants and sticks ----------

const LID = 4; // px from the top of the tank: a stick moved up so far it would poke out is cut off here

// What Relocate would lift, of what a press there hit: a plant, grass patch, vine or stick.
const liftable = (hit) => hit && (hit.plant ?? hit.grass ?? hit.vine ?? hit.seg?.obj);

// A stick and everything that stands on it or hangs from it: plants, vines, other sticks and whatever is on those.
const carried = (world, stick) => {
  const out = [stick];
  for (let i = 0; i < out.length; i++) {
    const segs = out[i].segs ?? [];
    for (const o of world.objects) if (!out.includes(o) && segs.includes(o.on)) out.push(o);
  }
  return out;
};

// Where a plant, grass patch, vine or stick dragged by (dx, dy) ends up: its base moves as far as the pointer did,
// then lands the way a new one would. A stick keeps clear of the glass at the sides, and doesn't land on itself or
// anything it carries.
const destination = (world, obj, dx, dy) => {
  const [x, y] = [obj.base.x + dx, obj.base.y + dy];
  if (obj.kind === 'vine') return vineAnchor(world, x, y);
  if (obj.kind === 'grass') return sowAt(world, x, y);
  if (obj.kind !== 'stick') return standAt(world, x, y);
  const segs = new Set(carried(world, obj).flatMap((o) => o.segs ?? []));
  const xs = [...segs].flatMap((g) => [g.x0, g.x1]);
  const fit = clamp(x, obj.base.x + 2 - Math.min(...xs), obj.base.x + world.W - 3 - Math.max(...xs));
  return standAt(world, fit, y, segs);
};

// What's being dragged (with everything it carries, for a stick) and where it would land (or, propagating, where
// its seedling would go), for drawing.
export const relocationAt = (world) => {
  const m = world.moving;
  if (!m || !world.objects.includes(m.obj)) return null;
  const { x, y } = world.pointer;
  const to = world.tool === 'propagate' ? standAt(world, x, y) : destination(world, m.obj, x - m.x, y - m.y);
  if (!to) return null;
  const loads = m.obj.kind === 'stick' ? carried(world, m.obj) : [m.obj];
  return { obj: m.obj, loads, base: to.base, dx: to.base.x - m.obj.base.x, dy: to.base.y - m.obj.base.y };
};

// Move a stick so its base is at to.base, and everything it carries with it: what stands on it or hangs from it,
// and the bugs walking on any of that (one rounding a corner just then lets go). Then any of it moved up so far
// that it would poke out of the top of the tank is cut off there, as if it met the lid.
const moveStick = (world, stick, to) => {
  const [dx, dy] = [to.base.x - stick.base.x, to.base.y - stick.base.y];
  const loads = carried(world, stick);
  const segs = new Set(loads.flatMap((o) => o.segs ?? []));
  const by = (p) => p && { x: p.x + dx, y: p.y + dy };
  for (const o of loads) {
    if (o.kind !== 'stick') relocate(world, o, { base: by(o.base), on: o.on, hold: by(o.hold) });
    else {
      for (const g of o.segs) setEnds(g, by(g.root), by(g.tip));
      Object.assign(o, { base: by(o.base), hold: by(o.hold) });
    }
  }
  Object.assign(stick, { base: to.base, on: to.on, hold: to.hold });
  for (const bug of world.bugs) {
    if (bug.transfer && (segs.has(bug.surf) || segs.has(bug.transfer.from))) detach(bug, 'fall');
    if (!segs.has(bug.surf)) continue;
    for (const p of bug.pts) Object.assign(p, { x: p.x + dx, y: p.y + dy, px: p.px + dx, py: p.py + dy });
    resetLegs(bug);
    bug.step = null;
  }
  rebuildJunctions(world);
  replan(world);
  for (const g of segs) {
    if (!world.branches.includes(g) || Math.min(g.root.y, g.tip.y) >= LID) continue;
    const t = g.root.y < LID ? 0 : (g.root.y - LID) / (g.root.y - g.tip.y);
    pruneSegment(world, g, { x: g.root.x + (g.tip.x - g.root.x) * t, y: g.root.y + (g.tip.y - g.root.y) * t });
  }
};

// Move a plant, grass patch, vine or stick so its base is at to.base.
const relocate = (world, obj, to) => {
  if (obj.kind === 'stick') return moveStick(world, obj, to);
  const [dx, dy] = [to.base.x - obj.base.x, to.base.y - obj.base.y];
  if (obj.kind === 'plant') {
    // Stems share their joints (and the first one its root with the base), so move each point once.
    const moved = new Map([[obj.base, to.base]]);
    const at = (p) => {
      if (!moved.has(p)) moved.set(p, { x: p.x + dx, y: p.y + dy });
      return moved.get(p);
    };
    for (const stem of obj.stems) Object.assign(stem, { root: at(stem.root), tip: at(stem.tip) });
  } else if (obj.kind === 'vine') {
    obj.nodes = obj.nodes.map((p) => ({ x: p.x + dx, y: p.y + dy, px: p.px + dx, py: p.py + dy }));
  } else {
    // Each tuft settles onto whatever is below it; any that land off dirt or sand wither.
    for (const tuft of obj.tufts) {
      tuft.x = clamp(tuft.x + dx, 1, world.W - 2);
      tuft.y = groundTop(world, tuft.x, tuft.y + dy - 3);
    }
  }
  Object.assign(obj, { base: to.base, on: to.on, hold: to.hold });
};

// A flowering plant that has finished growing: nothing still growing or about to sprout, and its flowers out (or
// come and gone, to come again). A clump plant once its crown is full, flowers (or baby plants) and all.
export const propagatable = (obj) => {
  if (obj.kind !== 'plant') return false;
  const flowered = (st) => st.bud && (st.flower >= 1 || st.age !== undefined);
  const settled = obj.stems.every((st) => !st.growing && st.sprout <= 0 && (!st.bud || flowered(st)));
  if (obj.species.form) return settled && crownFull(obj);
  return settled && obj.stems.some(flowered);
};

// Take a cutting: a seedling of the same species goes in at to, and the parent is cut right back to a seedling
// too, so both start again.
const propagate = (world, plant, to) => {
  for (const st of plant.stems) fling(world, st.root, st.tip, { kind: 'stem', plant, leaf: st.role === 'leaf' });
  plant.stems = [seedling(world, plant)];
  addDecor(world, { kind: 'plant', base: to.base, on: to.on, species: structuredClone(plant.species) });
};

// ---------- simulation step ----------

export const step = (world) => {
  world.time++;
  const ter = world.terrain;
  if (world.painting) paintAt(world, world.pointer); // holding still keeps pouring
  stepTerrain(ter, world.rand, world.time);
  if (ter.skyDirty && (world.time % 8 === 0 || !ter.active)) rebuildOutline(world);
  growLeaves(world);
  // Plants and sticks standing on the terrain come down if the cell holding them goes, or they're buried.
  if (world.time % 10 === 0) {
    for (const obj of [...world.objects]) {
      if (!obj.hold || obj.kind === 'vine' || !world.objects.includes(obj)) continue;
      const ter = world.terrain;
      const buried = solidAt(ter, obj.base.x, obj.base.y - 3);
      if (buried || !solidAt(ter, obj.hold.x, obj.hold.y)) removeObject(world, obj, true);
    }
  }
  for (const obj of [...world.objects]) {
    if (obj.kind === 'plant') {
      growPlant(world, obj, params.plantGrowth);
      ageLeaves(world, obj);
      ageFlowers(world, obj);
    } else if (obj.kind === 'grass') growGrass(world, obj, params.plantGrowth);
    else if (obj.kind === 'vine') growVine(world, obj, params.plantGrowth);
  }
  for (const bug of world.bugs) {
    bug.t = traitsOf(bug.genes);
    const t = bug.t;
    bug.hunger = Math.min(1, bug.hunger + HUNGER_RATE * t.appetite);
    bug.cooldown = Math.max(0, bug.cooldown - 1);
    bug.groove += ((bug.state === 'dance' ? 1 : 0) - bug.groove) * 0.06;
    const still = bug.state === 'idle' || (bug.state === 'quirk' && bug.quirk === 'twig');
    bug.calm += ((still ? 1 : 0) - bug.calm) * 0.03;
    bug.munch += ((bug.state === 'eat' ? 1 : 0) - bug.munch) * 0.1;
    bug.raise += ((bug.state === 'quirk' ? 1 : 0) - bug.raise) * 0.08;
    if (bug.surf && wetAt(ter, standingAt(bug.surf, bug.s, bug.t))) detach(bug, 'swim'); // in over its back: it floats
    if (bug.surf) think(world, bug);
    if (bug.surf) followSurface(world, bug);
    else simulateLoose(world, bug);
  }
  matchDancers(world);
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

const growLeaves = (world) => {
  for (const g of world.branches) {
    if (g.kind === 'terrain') continue;
    for (const leaf of g.leaves) leaf.size = Math.min(1, leaf.size + LEAF_GROWTH * params.leafGrowth);
    if (g.leaves.length < maxLeaves(g) && world.rand() < LEAF_SPAWN_CHANCE * params.leafGrowth) {
      g.leaves.push({ t: 0.1 + 0.8 * world.rand(), size: 0, lean: world.rand() < 0.5 ? -1 : 1 });
    }
  }
};

// Spring the body toward its pose and move the feet. Turns are little hops, and steps bob the body but not
// the feet.
const followSurface = (world, bug) => {
  const t = bug.t;
  const h = standHeight(t);
  const turn = bug.state === 'turn' ? t.turnHop * Math.sin(Math.PI * clamp(1 - bug.timer / t.turnTicks, 0, 1)) : 0;
  bug.pose = bug.transfer
    ? crossingPose(bug, bug.transfer.d)
    : bodyPose(bug.surf, bug.s, bug.dir, bug.squash, t, turn * h);
  moveFeet(world, bug);
  const n = segNormal(bug.surf);
  const bob = bug.step ? t.stepBob * t.size * Math.sin(Math.PI * bug.step.t) : 0;
  bug.pts.forEach((p, i) => {
    const vx = (p.x - p.px) * t.bodyDamp + (bug.pose[i].x + n.x * bob - p.x) * t.bodySpring;
    const vy = (p.y - p.py) * t.bodyDamp + (bug.pose[i].y + n.y * bob - p.y) * t.bodySpring;
    p.px = p.x;
    p.py = p.y;
    p.x += vx;
    p.y += vy;
  });
};

const constrain = (a, b, len, stiffness) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const k = ((d - len) / d) * 0.5 * stiffness;
  a.x += dx * k;
  a.y += dy * k;
  b.x -= dx * k;
  b.y -= dy * k;
};

// Where the body of a bug standing on surf at s is: its height off the surface.
const standingAt = (surf, s, t) => add(pointAt(surf, s), segNormal(surf), standHeight(t));

// Which way the nearest bank is from p, along the water: -1, 1, or 0 if there's none in sight.
const bankSide = (world, p) => {
  for (let d = CELL; d < world.W; d += CELL) {
    for (const side of [-1, 1]) if (solidAt(world.terrain, p.x + side * d, p.y)) return side;
  }
  return 0;
};

// A bug in the water hauls itself out onto the nearest spot it can reach, from whichever end is nearer the bank,
// where it can stand out of the water (up a bank, onto a stick), facing up and away from the water. Returns whether
// it did.
const climbOut = (world, bug, side) => {
  const [a, b] = [bug.pts[0], bug.pts[SEGMENTS - 1]];
  const head = (a.x - b.x) * side >= 0 ? a : b;
  const reach = standHeight(bug.t) * 2 + 4;
  let best = null;
  for (const g of world.branches) {
    const s0 = project(g, head.x, head.y);
    if (dist(pointAt(g, s0), head) > reach) continue;
    for (let along = 0; along < reach; along += 2) {
      for (const s of [clampS(g, s0 - along, bug.t), clampS(g, s0 + along, bug.t)]) {
        const d = dist(pointAt(g, s), head);
        if (d > reach || wetAt(world.terrain, standingAt(g, s, bug.t))) continue;
        if (!best || d < best.d) best = { d, g, s };
      }
    }
  }
  if (!best) return false;
  land(world, bug, best.g, best.s, dot(segDir(best.g), { x: side, y: -1 }));
  return true;
};

// Verlet physics for falling, floating or held bugs; settles onto a surface when at rest. In the water a bug is
// buoyed up to ride at the surface, and paddles head first for the nearest bank, then climbs out. It never ends up
// inside the terrain: it's pushed back out the way it came, or up out of anything poured over it.
const simulateLoose = (world, bug) => {
  const isHeld = world.held?.bug === bug;
  const ter = world.terrain;
  const pin = () => {
    if (!isHeld) return;
    const p = bug.pts[world.held.i];
    p.x = world.pointer.x;
    p.y = world.pointer.y;
  };
  // Floating, bobbing at the surface, with the water just under it.
  const swimming = !isHeld && bug.pts.some((p) => wetAt(ter, p) || wetAt(ter, { x: p.x, y: p.y + 3 }));
  if (!isHeld) bug.state = swimming ? 'swim' : 'fall';
  const side = swimming ? bankSide(world, bug.pts[MID]) : 0;
  if (swimming && (world.time + Math.floor(bug.seed)) % 6 === 0 && climbOut(world, bug, side)) return;
  bug.pts.forEach((p, i) => {
    const wet = wetAt(ter, p);
    const vx = (p.x - p.px) * (wet ? 0.85 : 0.99);
    const vy = (p.y - p.py) * (wet ? 0.85 : 0.99);
    p.px = p.x;
    p.py = p.y;
    p.x += vx + (wet && i < MID ? side * 0.03 : 0);
    p.y += vy + params.gravity * (wet ? -0.6 : 1);
  });
  const h = standHeight(bug.t);
  const len = bodySegLen(bug.t);
  // The floor holding up the body point nearest its middle: a bug draped over a bump or across two
  // branches rests on its ends, so its middle may never touch anything.
  let landed = null;
  let nearest = Infinity;
  for (let iter = 0; iter < 6; iter++) {
    pin();
    for (let i = 0; i < SEGMENTS - 1; i++) constrain(bug.pts[i], bug.pts[i + 1], len, 1);
    for (let i = 0; i < SEGMENTS - 2; i++) constrain(bug.pts[i], bug.pts[i + 2], len * 2, 0.3);
    for (let i = 0; i < SEGMENTS; i++) {
      const p = bug.pts[i];
      p.x = clamp(p.x, 0, world.W - 1);
      p.y = Math.max(p.y, 0);
      if (solidAt(ter, p.x, p.y) && !solidAt(ter, p.px, p.y)) p.x = p.px;
      while (p.y > 0 && solidAt(ter, p.x, p.y)) p.y -= 1;
      const floor = isHeld ? { y: world.ground.y0, g: world.ground } : floorBelow(world, p.x, p.py + h - 2);
      if (p.y > floor.y - h) {
        p.y = floor.y - h;
        p.px = p.x - (p.x - p.px) * 0.7; // friction
        if (Math.abs(i - MID) <= nearest) [nearest, landed] = [Math.abs(i - MID), floor.g];
      }
    }
  }
  pin();
  if (isHeld) return;
  const c = bug.pts[MID];
  bug.rest = landed && Math.hypot(c.x - c.px, c.y - c.py) < 0.3 ? bug.rest + 1 : 0;
  if (landed && bug.rest > 20) {
    const d = segDir(landed);
    const head = bug.pts[0];
    const tail = bug.pts[SEGMENTS - 1];
    land(world, bug, landed, project(landed, c.x, c.y), (head.x - tail.x) * d.x + (head.y - tail.y) * d.y);
  }
};

// ---------- behaviour ----------

const startTurn = (bug, dir, next, nextTimer) => {
  bug.turnTo = dir;
  bug.next = next;
  bug.nextTimer = nextTimer;
  setState(bug, 'turn', bug.t.turnTicks);
};

const think = (world, bug) => {
  const t = bug.t;
  bug.timer--;
  switch (bug.state) {
    case 'turn': {
      const k = clamp(1 - bug.timer / t.turnTicks, 0, 1);
      bug.squash = 0.2 + 0.8 * Math.abs(Math.cos(Math.PI * k));
      if (k >= 0.5 && bug.dir !== bug.turnTo) {
        bug.dir = bug.turnTo;
        bug.feet = bug.feet.map((f) => -f); // same footholds, measured along the new heading
      }
      if (bug.timer <= 0) {
        bug.squash = 1;
        setState(bug, bug.next, bug.nextTimer);
      }
      return;
    }
    case 'idle':
      if (bug.timer <= 0) decide(world, bug);
      return;
    case 'quirk':
      if (bug.timer <= 0) setState(bug, 'idle', 60 + world.rand() * 60);
      return;
    case 'dance':
      if (bug.partner && bug.partner.partner !== bug) bug.partner = null;
      if (bug.partner && bug.partner.state !== 'dance') return; // wait for them to finish turning
      bug.beat += bug.tempo;
      if (bug.beat >= bug.bops * 2 * Math.PI) {
        bug.partner = null;
        setState(bug, 'idle', 60 + world.rand() * 60);
      }
      return;
    case 'eat':
      return eat(world, bug);
    case 'walk':
      return walk(world, bug);
  }
};

const decide = (world, bug) => {
  const t = bug.t;
  bug.goal = null;
  bug.route = [];
  if (bug.hunger > t.hungryAt && seekFood(world, bug)) return;
  let r = world.rand();
  if ((r -= t.danceChance) < 0) return startDance(world, bug, danceBops(world, t.danceBops), t.danceTempo);
  if ((r -= t.quirkChance) < 0) return startQuirk(world, bug, randomQuirk(world));
  if ((r -= t.restChance) < 0) return setState(bug, 'idle', restTicks(world, bug));
  wander(world, bug);
};

const restTicks = (world, bug) => bug.t.idleTicks * (0.5 + world.rand());

// Walk to a random spot on any surface the bug can reach, out of the water and not inside the terrain (where a
// stick goes into it).
const wander = (world, bug) => {
  const options = [...reachable(world, bug.surf)];
  for (let tries = 0; tries < 5; tries++) {
    const surf = options[Math.floor(world.rand() * options.length)];
    const s = world.rand() * segLength(surf);
    const body = add(pointAt(surf, s), segNormal(surf), standHeight(bug.t));
    if (!wetAt(world.terrain, body) && !solidAt(world.terrain, body.x, body.y)) return goTo(world, bug, surf, s);
  }
  setState(bug, 'idle', 60);
};

const goTo = (world, bug, surf, s, leaf) => {
  const route = findRoute(world, bug.surf, surf);
  if (!route) return false;
  bug.goal = { surf, s, leaf };
  bug.route = route;
  setState(bug, 'walk', 0);
  return true;
};

const seekFood = (world, bug) => {
  const c = bug.pts[MID];
  const within = reachable(world, bug.surf);
  let best = null;
  for (const g of world.branches) {
    if (!g.leaves.length || !within.has(g)) continue;
    for (const leaf of g.leaves) {
      const p = pointAt(g, leaf.t * segLength(g));
      if (leaf.size < 0.4 || wetAt(world.terrain, p)) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (!best || d < best.d) best = { g, leaf, d };
    }
  }
  return best ? goTo(world, bug, best.g, best.leaf.t * segLength(best.g), best.leaf) : false;
};

// Where to stand so the head reaches s, preferring not to turn around.
const eatingSpot = (bug, s) => {
  const reach = MID * bodySegLen(bug.t);
  const behind = s - bug.dir * reach;
  return (behind - bug.s) * bug.dir >= -ARRIVE ? behind : s + bug.dir * reach;
};

// The forward tripod stays planted and the body travels over it until those feet are a stride behind their
// hips (or the target is reached). The other tripod swings to where it should land once the body has moved:
// planted on whatever surface is under it then, so around a corner the front feet reach the next surface
// first.
const startStep = (world, bug, remaining) => {
  const t = bug.t;
  const stance = bug.feet[0] >= bug.feet[1] ? 0 : 1;
  const from = bug.feet[stance];
  const len = Math.min(from + strideLen(t), remaining);
  const end = poseAhead(bug, len);
  // A stick can run into the terrain (through a ledge, say), and there the way on is blocked: give up and think
  // again. The head leads, so if its way is clear, so is the rest of the body's. (The terrain's outline only ever
  // goes round it.)
  const head = bug.pts[0];
  const n = Math.ceil(dist(head, end[0])) || 1;
  const inTerrain = (k) => {
    const p = lerp(head, end[0], k / n);
    return solidAt(world.terrain, p.x, p.y);
  };
  if (bug.surf.kind === 'stick' && [...Array(n + 1).keys()].some(inTerrain)) {
    Object.assign(bug, { goal: null, route: [] });
    return setState(bug, 'idle', 30);
  }
  legLayout(t).forEach((L, k) => {
    if (L.tripod !== stance) swingLeg(bug.legs[k], footFor(world, bug, end, L, len - from), t.stepTicks);
  });
  bug.step = { base: bug.transfer ? bug.transfer.d : bug.s, len, t: 0, stance, from };
  takeStep(bug);
};

// Kicked off hard, coasting in: the body lurches after the swinging feet.
const takeStep = (bug) => {
  const st = bug.step;
  st.t = Math.min(1, st.t + 1 / bug.t.stepTicks);
  const moved = st.len * (1 - (1 - st.t) ** 3);
  if (bug.transfer) bug.transfer.d = st.base + moved;
  else bug.s = st.base + bug.dir * moved;
  bug.feet[st.stance] = st.from - moved;
  if (st.t >= 1) {
    bug.feet[1 - st.stance] = st.len - st.from;
    bug.step = null;
  }
};

const walk = (world, bug) => {
  if (bug.step) return takeStep(bug);
  if (bug.legs.some((l) => l.swing)) return; // let the feet settle first
  const goal = bug.goal;
  if (!goal) return setState(bug, 'idle', 30);
  const t = bug.t;
  const tr = bug.transfer;
  if (tr) {
    if (tr.D - tr.d > ARRIVE) return startStep(world, bug, tr.D - tr.d);
    bug.transfer = null; // across: carry on along the new surface
  }
  const hop = bug.route[0];
  if (hop) {
    // Walk until the head reaches the junction, then cross.
    const toward = Math.sign(hop.sFrom - bug.s) || bug.dir;
    if (toward !== bug.dir) return startTurn(bug, toward, 'walk', 0);
    const ahead = (clampS(bug.surf, hop.sFrom - toward * MID * bodySegLen(t), t) - bug.s) * toward;
    return ahead > ARRIVE ? startStep(world, bug, ahead) : cross(world, bug, hop);
  }
  const target = clampS(bug.surf, goal.leaf ? eatingSpot(bug, goal.s) : goal.s, t);
  const delta = target - bug.s;
  if (Math.abs(delta) > ARRIVE) {
    const dir = Math.sign(delta);
    return dir !== bug.dir ? startTurn(bug, dir, 'walk', 0) : startStep(world, bug, Math.abs(delta));
  }
  if (goal.leaf) setState(bug, 'eat', 0);
  else setState(bug, 'idle', restTicks(world, bug));
};

// Start crossing a junction: the body will slide round the corner, a step at a time, until its tail
// reaches the junction.
const cross = (world, bug, hop) => {
  const t = bug.t;
  if (hop.from !== bug.surf || dist(pointAt(bug.surf, hop.sFrom), pointAt(hop.to, hop.sTo)) > JUNCTION_DIST + 1) {
    return replan(world); // the junction has moved since the route was planned
  }
  bug.route.shift();
  const next = bug.route[0] ? bug.route[0].sFrom : bug.goal.s;
  const dirTo = Math.sign(next - hop.sTo) || 1;
  const sNew = clampS(hop.to, hop.sTo + dirTo * MID * bodySegLen(t), t);
  const p0 = (bug.s - hop.sFrom) * bug.dir;
  const D = (sNew - hop.sTo) * dirTo - p0;
  // A surface too short for the body leaves nothing to slide along: just step across.
  if (D > ARRIVE) {
    bug.transfer = { from: bug.surf, sFrom: hop.sFrom, dirFrom: bug.dir, to: hop.to, sTo: hop.sTo, dirTo, p0, D, d: 0 };
  }
  Object.assign(bug, { surf: hop.to, s: sNew, dir: dirTo });
};

const eat = (world, bug) => {
  const t = bug.t;
  const leaf = bug.goal?.leaf;
  const g = bug.goal?.surf;
  if (!leaf || !g?.leaves.includes(leaf)) return setState(bug, 'idle', 30);
  const chews = Math.floor(bug.chew / (2 * Math.PI) + 0.5);
  bug.chew += t.chewSpeed;
  if (Math.floor(bug.chew / (2 * Math.PI) + 0.5) > chews) dropCrumbs(world, bug);
  leaf.size -= t.bite;
  bug.hunger = Math.max(0, bug.hunger - t.bite * 1.5);
  if (leaf.size <= 0.05) g.leaves.splice(g.leaves.indexOf(leaf), 1);
  if (leaf.size <= 0.05 || bug.hunger <= 0.02) setState(bug, 'idle', 60 + world.rand() * 60);
};

// How many full rocks a dance gets: bops, with a fractional part as the chance of one more.
const danceBops = (world, bops) => Math.max(1, Math.floor(bops + world.rand()));
const danceTicks = (bops, tempo) => (bops * 2 * Math.PI) / tempo;

const startDance = (world, bug, bops, tempo) => {
  Object.assign(bug, { beat: 0, bops, tempo });
  setState(bug, 'dance', 0);
};

const canDance = (bug) =>
  bug.surf && !bug.transfer && bug.cooldown === 0 && (bug.state === 'idle' || bug.state === 'walk');

// Two free bugs close together on the same surface turn to face each other and dance, to a shared beat.
const matchDancers = (world) => {
  for (const a of world.bugs) {
    for (const b of world.bugs) {
      if (a === b || !canDance(a) || !canDance(b) || a.surf !== b.surf) continue;
      const range = (SEGMENTS - 1) * ((bodySegLen(a.t) + bodySegLen(b.t)) / 2) * 1.3;
      if (Math.abs(a.s - b.s) > range) continue;
      const bops = danceBops(world, (a.t.danceBops + b.t.danceBops) / 2);
      const tempo = (a.t.danceTempo + b.t.danceTempo) / 2;
      for (const [me, other] of [[a, b], [b, a]]) {
        Object.assign(me, { partner: other, goal: null, route: [], beat: 0, bops, tempo });
        me.cooldown = me.t.turnTicks + danceTicks(bops, tempo) + me.t.danceCooldown;
        const face = Math.sign(other.s - me.s) || 1;
        if (face !== me.dir) startTurn(me, face, 'dance', 0);
        else setState(me, 'dance', 0);
      }
    }
  }
};

const randomQuirk = (world) => {
  let r = world.rand();
  for (const [kind, weight] of QUIRKS) if ((r -= weight) < 0) return kind;
  return QUIRKS[0][0];
};

// Rare stick insect things: waving the front legs, posing as a twig, grooming an antenna.
const startQuirk = (world, bug, kind) => {
  bug.quirk = kind;
  setState(bug, 'quirk', bug.t.quirkTicks * (0.6 + 0.8 * world.rand()));
};

// ---------- effects and coins ----------

// A few leaf crumbs fall from the mouth at the bottom of each chew.
const dropCrumbs = (world, bug) => {
  const t = bug.t;
  const n = segNormal(bug.surf);
  const drop = (t.headDown + t.chewBop) * t.size;
  const count = Math.floor(t.crumbs * (0.5 + world.rand()) + 0.5);
  for (let i = 0; i < count && world.crumbs.length < MAX_CRUMBS; i++) {
    world.crumbs.push({
      x: bug.pts[0].x - n.x * drop,
      y: bug.pts[0].y - n.y * drop,
      vx: (world.rand() - 0.5) * 0.5,
      vy: -0.15 - world.rand() * 0.25,
      life: 150,
      landed: false,
      shade: world.rand() < 0.5 ? 0 : 1,
      seed: world.rand() * 6,
    });
  }
};

// Crumbs flutter down, settle on the first flat surface below them, and soon vanish.
const stepCrumbs = (world) => {
  world.crumbs = world.crumbs.filter((c) => {
    c.life--;
    if (!c.landed) {
      const y0 = c.y;
      c.vy = Math.min(c.vy + 0.03, wetAt(world.terrain, c) ? 0.12 : 0.6); // they sink slowly in water
      c.x += c.vx + 0.15 * Math.sin(world.time * 0.2 + c.seed);
      c.y += c.vy;
      c.vx *= 0.97;
      const floor = floorBelow(world, c.x, y0).y;
      if (c.y >= floor - 1) {
        c.y = floor - 1;
        c.landed = true;
        c.life = Math.min(c.life, 45);
      }
    }
    return c.life > 0 && c.x >= 0 && c.x < world.W;
  });
};

// Pruned pieces tumble to the floor and lie there a moment. look says how to draw them.
const fling = (world, a, b, look) => {
  if (world.debris.length >= MAX_DEBRIS || dist(a, b) < 1) return;
  world.debris.push({
    c: lerp(a, b, 0.5),
    h: { x: (b.x - a.x) / 2, y: (b.y - a.y) / 2 },
    vx: (world.rand() - 0.5) * 0.6,
    vy: -world.rand() * 0.5,
    spin: (world.rand() - 0.5) * 0.1,
    look,
    life: 240,
    landed: false,
  });
};

const stepDebris = (world) => {
  world.debris = world.debris.filter((p) => {
    if (!p.landed) {
      const low0 = p.c.y + Math.abs(p.h.y);
      p.vy = Math.min(p.vy + params.gravity * 0.5, 3);
      p.c = { x: p.c.x + p.vx, y: p.c.y + p.vy };
      const [cs, sn] = [Math.cos(p.spin), Math.sin(p.spin)];
      p.h = { x: p.h.x * cs - p.h.y * sn, y: p.h.x * sn + p.h.y * cs };
      const floor = floorBelow(world, p.c.x, low0).y - 1;
      const low = p.c.y + Math.abs(p.h.y);
      if (low >= floor) {
        p.c.y -= low - floor;
        p.landed = true;
        p.life = Math.min(p.life, 150);
      }
    }
    return --p.life > 0;
  });
};

// Fallen leaves and petals flutter down, rocking side to side and blown along by the breeze. On the ground they lie,
// brown, curl up and are gone in a minute (a petal in 15 s); on the water they float a while, then sink, and fish
// nibble at them.
const stepLitter = (world) => {
  const ter = world.terrain;
  world.litter = world.litter.filter((it) => {
    const y0 = it.y;
    if (it.state === 'fall') {
      it.phase += 0.05;
      it.x = clamp(it.x + Math.cos(it.phase) * 0.35 + wind(world, it.x) * 0.3, 1, world.W - 2);
      it.y += 0.06 + 0.3 * Math.cos(it.phase) ** 2; // quickest at the bottom of each swing
      if (wetAt(ter, { x: it.x, y: it.y - CELL })) {
        it.state = 'sink'; // dropped under water
      } else if (wetAt(ter, it)) {
        it.y = ter.top + Math.floor((it.y - ter.top) / CELL) * CELL - 0.5; // on the surface
        Object.assign(it, { state: 'float', float: FLOAT_TICKS });
        ripple(world, it.x, it.y + 1);
      }
    } else if (it.state === 'float') {
      it.x = clamp(it.x + wind(world, it.x) * 0.05 + Math.sin(world.time * 0.02 + it.phase) * 0.03, 1, world.W - 2);
      if (!wetAt(ter, { x: it.x, y: it.y + 1 })) it.state = 'fall'; // drifted off the edge of the water, or it drained
      else if (--it.float <= 0) it.state = 'sink';
    } else if (it.state === 'sink') {
      it.phase += 0.03;
      it.x = clamp(it.x + Math.cos(it.phase) * 0.08, 1, world.W - 2);
      it.y += 0.05;
    } else {
      it.rot += LITTER_ROT * (it.look.petal ? PETAL_ROT : 1);
    }
    // Falling or sinking it lands on the floor; lying, it falls again if the floor goes from under it.
    if (it.state !== 'float' && (it.state !== 'lie' || world.time % 10 === 0)) {
      const floor = floorBelow(world, it.x, Math.min(y0, it.y) - 1).y - 1;
      if (it.y >= floor) Object.assign(it, { y: floor, state: 'lie' });
      else if (it.state === 'lie') it.state = 'fall';
    }
    return it.life > 0 && it.rot < 1;
  });
};

const earn = (world, n, x, y) => {
  world.coins += n;
  world.popups.push({ x, y, text: `+${n}`, life: 70 });
};

// ---------- commands ----------

// Make every bug on a surface drop what it's doing and do something else right away. Dancers all start on
// the same beat, so the whole tank rocks together.
export const command = (world, action) => {
  const bops = danceBops(world, params.danceBops);
  for (const bug of world.bugs) {
    if (!bug.surf) continue;
    if (bug.transfer) {
      // Abandon a crossing: the body snaps to the far side, so find new footholds there.
      Object.assign(bug, { transfer: null, step: null });
      resetLegs(bug);
    }
    Object.assign(bug, { partner: null, goal: null, route: [], squash: 1 });
    if (action === 'idle') {
      setState(bug, 'idle', restTicks(world, bug));
      bug.cooldown = Math.max(bug.cooldown, bug.timer); // don't get pulled into a dance meanwhile
    } else if (action === 'walk') {
      wander(world, bug);
    } else if (action === 'eat') {
      if (!seekFood(world, bug)) setState(bug, 'idle', 30);
    } else if (action === 'dance') {
      startDance(world, bug, bops, params.danceTempo);
      bug.cooldown = danceTicks(bops, params.danceTempo) + bug.t.danceCooldown;
    } else {
      startQuirk(world, bug, action);
    }
  }
};

export const rerollGenes = (world, bug) => {
  bug.genes = randomGenes(world.rand, params.variety);
  bug.t = traitsOf(bug.genes);
};

// Let a bug, fish or flier go: it leaves the tank.
export const release = (world, who) => {
  if (who.partner) who.partner.partner = null;
  world.bugs = world.bugs.filter((b) => b !== who);
  world.fish = world.fish.filter((f) => f !== who);
  world.fliers = world.fliers.filter((b) => b !== who);
  if (world.held?.bug === who || world.held?.fish === who || world.held?.flier === who) world.held = null;
  if (world.selected === who) world.selected = null;
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

// ---------- saving ----------

const SAVE_VERSION = 1;

// Run-length encoding for the terrain grid: [value, count, value, count, ...].
const rle = (cells) => {
  const out = [];
  for (let i = 0; i < cells.length; ) {
    let n = 1;
    while (i + n < cells.length && cells[i + n] === cells[i]) n++;
    out.push(cells[i], n);
    i += n;
  }
  return out;
};
const unrle = (pairs, n) => {
  const cells = new Uint8Array(n);
  for (let k = 0, i = 0; k < pairs.length; i += pairs[k + 1], k += 2) cells.fill(pairs[k], i, i + pairs[k + 1]);
  return cells;
};

const exportObject = (obj) => {
  const { kind, base } = obj;
  if (kind === 'stick') {
    const segs = obj.segs.map((g) => ({
      root: g.root,
      tip: g.tip,
      parent: obj.segs.indexOf(g.parent),
      depth: g.depth,
      leaves: g.leaves,
    }));
    return { kind, base, hold: obj.hold, style: obj.style, wood: obj.wood, foliage: obj.foliage, segs };
  }
  if (kind === 'plant') {
    const stems = obj.stems.map(({ parent, ...st }) => ({ ...st, parent: obj.stems.indexOf(parent) }));
    return { kind, base, hold: obj.hold, species: obj.species, stems };
  }
  if (kind === 'grass') return { kind, base, genome: obj.genome, tufts: obj.tufts };
  if (kind === 'vine') return { kind, base, genome: obj.genome, hold: obj.hold, nodes: obj.nodes, growth: obj.growth };
  return null;
};

// The whole tank as plain data, for saving: no references, just enough to build it again. Bugs are kept as where
// they stand and which way they face; they start over idle when the tank is loaded.
export const exportWorld = (world) => ({
  version: SAVE_VERSION,
  W: world.W,
  H: world.H,
  time: world.time,
  coins: world.coins,
  clippings: world.clippings ?? 0,
  rerolls: world.rerolls ?? null,
  wallpaper: world.wallpaper,
  wallpapers: world.wallpapers,
  found: world.found,
  shop: world.shop,
  offers: world.offers,
  terrain: {
    cols: world.terrain.cols,
    rows: world.terrain.rows,
    cells: rle(world.terrain.cells),
    tint: rle(world.terrain.tint),
  },
  objects: world.objects.map(exportObject).filter(Boolean),
  bugs: world.bugs.map((bug) => ({
    name: bug.name,
    genes: bug.genes,
    hunger: bug.hunger,
    at: bug.surf ? pointAt(bug.surf, bug.s) : bug.pts[MID],
    standing: !!bug.surf,
    facing: bug.surf ? Math.sign(segDir(bug.surf).x * bug.dir) || 1 : 1,
  })),
  fish: world.fish.map((f) => ({ name: f.name, genome: f.genome, at: { x: f.x, y: f.y }, hunger: f.hunger })),
  fliers: world.fliers.map((b) => ({ name: b.name, genome: b.genome, at: { x: b.x, y: b.y }, hunger: b.hunger })),
});

// The sizes a tank comes in, world px wide and tall (the large one on its side: wider than it's tall), and which
// of them W by H is (null if none).
export const TANK_SIZES = { small: [256, 341], medium: [320, 427], large: [512, 384] };
export const tankSize = (W, H) => {
  const [key] = Object.entries(TANK_SIZES).find(([, [w, h]]) => w === W && h === H) ?? [null];
  return key;
};

// Build a tank from saved data, at this tank's size. Everything is kept on the floor and in the middle: if the tank
// is taller or shorter than when it was saved, things move down or up with it, and wider or narrower, they keep to
// the middle (and what no longer fits is lost).
export const importWorld = (data, W, H, seed = undefined) => {
  const world = createWorld(W, H, { seed, scene: false });
  const dy = world.ground.y0 - (data.H - 6);
  const dx = Math.round((W - data.W) / 2 / CELL) * CELL; // whole cells, so the terrain moves with everything else
  const at = (p) => ({ x: clamp(p.x + dx, 0, W - 1), y: p.y + dy });
  Object.assign(world, {
    time: data.time,
    coins: data.coins,
    clippings: data.clippings,
    rerolls: data.rerolls,
    wallpaper: data.wallpaper,
    // Saved before wallpapers were kept: the one up is the start of the collection.
    wallpapers: data.wallpapers ?? (data.wallpaper ? [data.wallpaper] : []),
    found: data.found ?? [],
    shop: data.shop,
    offers: data.offers,
  });
  // Saved before there were fish: stock some. Saved when every flier was a ladybug: they're ladybugs.
  if (world.shop) world.shop.fish ??= Array.from({ length: OFFERS }, () => makeOffer(world, 'fish'));
  const oldLadybug = (genome) => ({ kind: 'ladybug', ...genome });
  for (const o of world.shop?.bug ?? []) {
    if (o.type === 'ladybug') Object.assign(o, { type: 'flier', genome: oldLadybug(o.genome) });
  }
  const t = data.terrain;
  const n = t.cols * t.rows;
  const saved = { cols: t.cols, rows: t.rows, cells: unrle(t.cells, n), tint: unrle(t.tint, n) };
  world.terrain = resizeTerrain(saved, W, world.ground.y0, dx / CELL);
  for (const o of data.objects) {
    const obj = { kind: o.kind, base: at(o.base) };
    if (o.kind === 'stick' || o.kind === 'plant') obj.hold = o.hold && at(o.hold); // standing on the terrain
    if (o.kind === 'stick') {
      Object.assign(obj, { style: o.style ?? 'branch', wood: o.wood, foliage: o.foliage, segs: [] });
      for (const g of o.segs) {
        const extra = { kind: 'stick', obj, parent: obj.segs[g.parent] ?? null, depth: g.depth };
        obj.segs.push(Object.assign(makeSeg(world, at(g.root), at(g.tip), extra), { leaves: g.leaves }));
      }
      world.branches.push(...obj.segs);
    } else if (o.kind === 'plant') {
      obj.species = o.species;
      const fresh = (st) => ({ len: dist(st.root, st.tip), bend: 0, spin: 0, turn: 0, bud: st.flower > 0 });
      obj.stems = o.stems.map((st) => ({ ...fresh(st), ...st, root: at(st.root), tip: at(st.tip) }));
      obj.stems.forEach((st) => (st.parent = obj.stems[st.parent] ?? null));
    } else if (o.kind === 'grass') {
      Object.assign(obj, { genome: o.genome, tufts: o.tufts.map((tuft) => ({ ...tuft, ...at(tuft) })) });
    } else if (o.kind === 'vine') {
      const nodes = o.nodes.map((p) => ({ ...at(p), px: p.px + dx, py: p.py + dy }));
      Object.assign(obj, { genome: o.genome, hold: o.hold && at(o.hold), nodes, growth: o.growth });
    }
    world.objects.push(obj);
  }
  rebuildJunctions(world);
  rebuildOutline(world);
  // What each thing stands on (or hangs from), now the surfaces are back.
  for (const obj of world.objects) {
    if ((obj.kind === 'stick' || obj.kind === 'plant') && !obj.hold) {
      obj.on = floorBelow(world, obj.base.x, obj.base.y - 0.5).g;
    }
    if (obj.kind === 'vine' && !obj.hold && obj.base.y > 4) {
      obj.on = world.branches.find((g) => g.kind !== 'terrain' && distToSeg(g, obj.base.x, obj.base.y) < 3) ?? null;
    }
  }
  for (const b of data.bugs) {
    const p = at(b.at);
    let near = null;
    for (const g of b.standing ? world.branches : []) {
      const d = distToSeg(g, p.x, p.y);
      if (d < 4 && (!near || d < near.d)) near = { d, g };
    }
    const bug = near
      ? placeBug(world, near.g, project(near.g, p.x, p.y), Math.sign(segDir(near.g).x || 1) * b.facing, b.genes)
      : addBug(world, p.x, p.y - 10, b.genes);
    if (bug) Object.assign(bug, { name: b.name, hunger: b.hunger });
  }
  for (const f of data.fish ?? []) {
    const { x, y } = at(f.at);
    world.fish.push(Object.assign(newFish(world, x, y, f.genome, f.name), { hunger: f.hunger }));
  }
  // Fliers come back in the air where they were, and fly to the nearest place to land.
  for (const b of data.fliers ?? data.ladybugs ?? []) {
    const { x, y } = at(b.at);
    addFlier(world, x, y - 2, oldLadybug(b.genome), b.name).hunger = b.hunger;
  }
  return world;
};

