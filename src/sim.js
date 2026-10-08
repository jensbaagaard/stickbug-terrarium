// Stickbug terrarium simulation: world, surfaces, bugs and their behaviour, decorations and the shop.
// Everything here is pure data + functions; rendering lives in render.js.
import { GENES, params } from './tuning.js';
import { randomGenes, randomName, traitsOf } from './genome.js';
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
  makeGrass,
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
  skyline,
  stepTerrain,
  WATER,
} from './terrain.js';

const GRAB_RADIUS = 16;
const PRESS_SLOP = 3; // a press on a bug that moves further than this picks it up; otherwise it selects it
const JUNCTION_DIST = 6; // surfaces closer than this connect
const FLOOR_SLOPE = 1.2; // surfaces flatter than this catch falling things
const TAP_SLOP = 8; // a press that moves less than this is a tap
const SKY_TOLERANCE = 2.5; // px the walkable outline may stray from the terrain's top
const ARRIVE = 0.5; // close enough to a walk target to stop stepping
const HUNGER_RATE = 1 / 2700;
const LEAF_GROWTH = 1 / 1200;
const LEAF_SPAWN_CHANCE = 1 / 360;
const LEAF_SPACING = 16;
const MAX_CRUMBS = 200;
const MAX_DEBRIS = 80;
const SPROUT_TICKS = 120; // a pruned stem waits this long before sprouting new shoots
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
const FLEX = 0.15; // how hard pulled grass springs back
export const PRICES = { fountain: 15 }; // fixed prices for anything not showcased; showcased kinds are priced per offer
const SHOP_KINDS = ['bug', 'plant', 'stick', 'wallpaper']; // showcased in the shop, OFFERS of each
const OFFERS = 4;

const dirOf = (a) => ({ x: Math.cos(a), y: Math.sin(a) });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- surfaces ----------

const isFloorLike = (g) => Math.abs(g.y1 - g.y0) <= Math.abs(g.x1 - g.x0) * FLOOR_SLOPE;
const yAt = (g, x) => g.y0 + ((g.y1 - g.y0) * (x - g.x0)) / (g.x1 - g.x0 || 1);

// Highest floor-like surface at x that is at or below y. The terrain's outline counts at any slope: it's the
// ground.
export const floorBelow = (world, x, y) => {
  let best = { y: world.ground.y0, g: world.ground };
  for (const g of world.branches) {
    if (!(g.kind === 'terrain' ? g.x1 > g.x0 : isFloorLike(g)) || x < g.x0 || x > g.x1) continue;
    const gy = yAt(g, x);
    if (gy >= y && gy < best.y) best = { y: gy, g };
  }
  return best;
};

const surfaces = (world) => [world.ground, ...world.branches];

const rebuildJunctions = (world) => {
  const all = surfaces(world);
  world.junctions = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const c = closestApproach(all[i], all[j]);
      if (c.d <= JUNCTION_DIST) world.junctions.push({ a: all[i], sa: c.sa, b: all[j], sb: c.sb });
    }
  }
};

// BFS over junctions. Returns a list of hops ([] if from === to) or null.
const findRoute = (world, from, to) => {
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length && !prev.has(to)) {
    const cur = queue.shift();
    for (const j of world.junctions) {
      for (const [a, sa, b, sb] of [[j.a, j.sa, j.b, j.sb], [j.b, j.sb, j.a, j.sa]]) {
        if (a !== cur || prev.has(b)) continue;
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

// Every surface reachable from `from`, in one flood fill.
const reachable = (world, from) => {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const j of world.junctions) {
      const next = j.a === cur ? j.b : j.b === cur ? j.a : null;
      if (next && !seen.has(next)) {
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
  // outline is never cut: rebuildSkyline looks after what stands on it.)
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
    const route = world.branches.includes(bug.goal.surf) || bug.goal.surf === world.ground
      ? findRoute(world, bug.surf, bug.goal.surf)
      : null;
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
  for (const g of surfaces(world)) {
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
    junctions: [],
    time: 0,
    rand: mulberry32(seed),
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
    popups: [],
    coins: START_COINS,
    placing: null, // the shop item waiting to be put down: {kind, seed}
    tool: 'hand', // or 'paint', 'prune' or 'move'
    moving: null, // the plant being dragged somewhere else, and where it was grabbed: {obj, x, y}
    demo: null, // the how-to animation for the tool just picked: {kind, at}
    selected: null,
    wallpaper: null, // the back of the tank: null for plain black
    terrain: makeTerrain(W, H - 6),
    brush: { material: 'sand', size: 3 }, // cells
    painting: false,
  };
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
    wood: { name: 'Oak', h: 28, s: 38, l: 27 },
    foliage: DEFAULT_FOLIAGE,
  });
  const plant = addDecor(world, build(world, 'plant', Math.floor(world.rand() * 2 ** 31), W * 0.84, H));
  for (let i = 0; i < 2400; i++) growPlant(world, plant, 1);
  // One bug to start with, always the plain default: no genetic offsets, so it is exactly the sliders.
  const starter = placeBug(world, world.ground, W * 0.62, -1, Object.fromEntries(GENES.map((g) => [g.key, 0])));
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

// The terrain's top as walkable surfaces: each raised stretch rises from the floor, follows the tops of its
// columns, and comes back down, simplified into a few straight runs. Unchanged runs keep their old objects,
// so bugs on them don't notice a rebuild.
const skylineSegs = (world, sky, old) => {
  const floor = world.ground.y0;
  const reuse = new Map([...old].map((g) => [`${g.root.x},${g.root.y},${g.tip.x},${g.tip.y}`, g]));
  const segs = [];
  let run = [];
  const end = (x) => {
    run.push({ x, y: floor });
    const pts = simplify(run, SKY_TOLERANCE);
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      if (dist(a, b) < 1) continue;
      segs.push(reuse.get(`${a.x},${a.y},${b.x},${b.y}`) ?? makeSeg(world, a, b, { kind: 'terrain' }));
    }
    run = [];
  };
  sky.forEach((y, c) => {
    const x = Math.min(c * CELL, world.W - 1);
    if (y < floor - 0.5) {
      if (!run.length) run.push({ x, y: floor });
      run.push({ x, y }, { x: Math.min(x + CELL, world.W - 1), y });
    } else if (run.length) {
      end(x);
    }
  });
  if (run.length) end(world.W - 1);
  return segs;
};

// The terrain moved: redo its outline. Bugs on outline that changed, or on the floor where terrain has risen
// over them, step onto the new outline under their feet; things planted on it move with it or come down.
const rebuildSkyline = (world) => {
  const ter = world.terrain;
  ter.skyDirty = false;
  const sky = skyline(ter, world.ground.y0);
  if (ter.sky && sky.every((y, c) => y === ter.sky[c])) return;
  ter.sky = sky;
  const old = new Set(world.branches.filter((g) => g.kind === 'terrain'));
  const fresh = skylineSegs(world, sky, old);
  for (const g of fresh) old.delete(g);
  world.branches = world.branches.filter((g) => g.kind !== 'terrain').concat(fresh);
  rebuildJunctions(world);
  const under = (x) => fresh.find((g) => g.x1 > g.x0 && x >= g.x0 && x <= g.x1);
  for (const bug of world.bugs) {
    const surf = bug.surf;
    const shifted = old.has(surf) || old.has(bug.transfer?.from);
    if (!surf || !(shifted || surf === world.ground)) continue;
    if (shifted && bug.transfer) {
      detach(bug, 'fall');
      continue;
    }
    const at = pointAt(surf, bug.s);
    const g = under(at.x);
    // The ground fell away beneath it: let go and fall, rather than snap down.
    if (shifted && (!g || yAt(g, at.x) > at.y + 6)) {
      detach(bug, 'fall');
      continue;
    }
    // Terrain drawn high overhead isn't something to climb onto. A bug on the floor stays put; one whose ground
    // was swallowed into it lets go and drops to whatever is below.
    if (g && shifted && yAt(g, at.x) < at.y - 40) {
      detach(bug, 'fall');
      continue;
    }
    if (!g || (surf === world.ground && yAt(g, at.x) < at.y - 40)) continue; // open floor, or terrain floating high
    const d = segDir(surf);
    const nd = segDir(g);
    const facing = (d.x * nd.x + d.y * nd.y) * bug.dir;
    const s = clampS(g, project(g, at.x, at.y), bug.t);
    Object.assign(bug, { surf: g, s, dir: facing < 0 ? -1 : 1, transfer: null, step: null });
    resetLegs(bug);
  }
  for (const obj of [...world.objects]) {
    if (!old.has(obj.on)) continue;
    const g = under(obj.base.x);
    if (g && distToSeg(g, obj.base.x, obj.base.y) < 3) obj.on = g;
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
// there's nothing near enough.
const standAt = (world, x, y) => {
  const gx = clamp(x, 3, world.W - 4);
  const top = groundTop(world, gx, y);
  let best = { y: top, on: top >= world.ground.y0 ? world.ground : null };
  for (const g of world.branches) {
    if (g.kind === 'terrain' || !isFloorLike(g) || gx < g.x0 || gx > g.x1) continue;
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
  return pl && build(world, pl.kind, pl.seed, x, y, pl.offer?.genes);
};

const addDecor = (world, spec) => {
  const obj = { kind: spec.kind, base: spec.base, on: spec.on, hold: spec.hold };
  if (spec.kind === 'stick') {
    Object.assign(obj, { wood: spec.wood, foliage: spec.foliage });
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
    obj.stems.push(newStem(world, obj, null, spec.base, -Math.PI / 2 + spec.species.lean));
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
  const full = kind === 'bug' && world.bugs.length >= params.maxBugs;
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

// Wallpaper goes straight up when bought, over whatever was there before.
export const buyWallpaper = (world, offer) => {
  if (offer.sold || world.coins < offer.price) return;
  world.wallpaper = makeWallpaper(mulberry32(offer.seed));
  world.coins -= offer.price;
  offer.sold = true;
  world.placing = null;
};

const placeItem = (world, x, y) => {
  const { kind, seed, offer, price } = world.placing;
  const decor = kind !== 'bug' && kind !== 'fountain' && build(world, kind, seed, x, y);
  if (decor === null) return; // nothing to stand on near there: keep holding it
  world.placing = null;
  if (world.coins < price || offer?.sold) return;
  if (kind === 'bug') {
    if (!addBug(world, x, y, offer.genes, offer.name)) return; // the tank is full
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
    const genes = randomGenes(world.rand, params.variety);
    const rarity = GENES.reduce((n, g) => n + Math.abs(genes[g.key]) / g.spread, 0) / GENES.length;
    return { ...offer, genes, name: randomName(world.rand), price: 10 + Math.round(rarity * 60) };
  }
  if (kind === 'plant') {
    // Plants come in three types, each with its own genome: flowering plants, grass and hanging vines.
    const type = world.rand();
    if (type < 0.25) {
      const g = makeGrass(mulberry32(offer.seed));
      return { ...offer, type: 'grass', name: g.name, price: 6 + Math.round(g.height) + (g.blossom ? 3 : 0) };
    }
    if (type < 0.5) {
      const g = makeVine(mulberry32(offer.seed));
      return { ...offer, type: 'vine', name: g.name, price: 8 + Math.round(g.maxNodes / 3) + (g.flower ? 3 : 0) };
    }
    const sp = makeSpecies(mulberry32(offer.seed));
    return { ...offer, name: sp.name, price: 6 + sp.maxNodes + Math.round(sp.flower.size * 3) };
  }
  if (kind === 'wallpaper') {
    const wp = makeWallpaper(mulberry32(offer.seed));
    return { ...offer, name: wp.name, price: 6 + 2 * wp.detail };
  }
  const stick = makeStick(mulberry32(offer.seed), { x: world.W / 2, y: world.ground.y0 }, world.W, world.H);
  return { ...offer, name: stick.wood.name, price: 4 + 2 * stick.pieces.length };
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
  if (offer.kind === 'bug') {
    const bug = newBug(world, x, 0, offer.genes);
    land(world, bug, world.ground, x, 1);
    bodyPose(world.ground, bug.s, bug.dir, 1, bug.t).forEach((p, i) =>
      Object.assign(bug.pts[i], { x: p.x, y: p.y, px: p.x, py: p.y }),
    );
    world.bugs.push(bug);
    for (let i = 0; i < 6; i++) step(world);
    const reach = bug.t.antenna * bug.t.size;
    const b = box([...bug.pts, ...bug.legs.map((l) => l.foot).filter(Boolean)], 3);
    return { x0: b.x0 - reach, x1: b.x1 + reach, y0: b.y0 - reach * 0.5, y1: world.ground.y0 + 2 };
  }
  if (offer.kind === 'wallpaper') {
    world.wallpaper = makeWallpaper(mulberry32(offer.seed));
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
  if (kind === 'plant') {
    const busy = () => obj.stems.some((st) => st.growing || st.sprout > 0 || (st.bud && st.flower < 1));
    for (let i = 0; i < 20000 && busy(); i++) growPlant(world, obj, 4);
    const b = box(obj.stems.flatMap((st) => [st.root, st.tip]), 8 + obj.species.flower.size * 6);
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
  for (const stem of [...plant.stems]) {
    for (const leaf of stem.leaves) leaf.size = Math.min(1, leaf.size + LEAF_GROWTH * 2 * rate);
    // Flowers only open in the air: under water they close up again, until it's gone.
    if (stem.bud) stem.flower = clamp(stem.flower + (wetAt(world.terrain, stem.tip) ? -0.01 : 0.002 * rate), 0, 1);
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

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Each stem points the way it grew, turned as far as the stem it grows from, and bent at its root. Bent, it springs
// back, so a plant pulled about bends along its length and wobbles back when let go, and under water the current
// rocks it.
const bendPlant = (world, plant) => {
  const pull = world.pull?.obj === plant && plant.stems.includes(world.pull.stem) ? world.pull : null;
  const goals = pull ? reachFor(plant, pull.stem, add(world.pointer, pull.off)) : null;
  for (const stem of plant.stems) {
    const root = stem.parent ? stem.parent.tip : plant.base;
    const rest = stem.angle + (stem.parent?.turn ?? 0); // the way it points unbent
    const goal = goals?.get(stem);
    if (goal) {
      const bend = wrapAngle(Math.atan2(goal.y - root.y, goal.x - root.x) - rest);
      [stem.spin, stem.bend] = [wrapAngle(bend - stem.bend), bend];
    } else {
      const wet = wetAt(world.terrain, stem.tip);
      const push = wet ? CURRENT * Math.sin(world.time * 0.03 - stem.depth * 0.5 + plant.base.x) : 0;
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

// Cut a stem at p: everything above falls off and sells as clippings, and the stump bushes out again.
const prunePlant = (world, plant, stem, p) => {
  const doomed = stemDescendants(plant, stem);
  let clipped = dist(p, stem.tip);
  for (const s of doomed) {
    clipped += dist(s.root, s.tip);
    fling(world, s.root, s.tip, { kind: 'stem', plant });
  }
  fling(world, p, stem.tip, { kind: 'stem', plant });
  const kept = dist(stem.root, p);
  if (kept < 2) {
    doomed.push(stem);
    if (stem.parent) stem.parent.sprout = SPROUT_TICKS;
  } else {
    const was = dist(stem.root, stem.tip);
    stem.leaves = stem.leaves.filter((l) => l.at * was <= kept).map((l) => ({ ...l, at: (l.at * was) / kept }));
    Object.assign(stem, { tip: p, len: kept, growing: false, bud: false, flower: 0, sprout: SPROUT_TICKS });
  }
  plant.stems = plant.stems.filter((s) => !doomed.includes(s));
  if (!plant.stems.length) world.objects = world.objects.filter((o) => o !== plant);
  earn(world, Math.max(1, Math.round(clipped / CLIPPING_LEN)), p.x, p.y);
};

// ---------- grass and vines ----------

// Is (x, y) dirt that grass can grow in: painted dirt or the bare tank floor?
const isSoil = (world, x, y) => {
  const ter = world.terrain;
  const i = cellAt(ter, x, y + 1);
  if (i >= 0 && ter.cells[i] !== EMPTY) return ter.cells[i] === DIRT;
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
// dirt. Null if there's none.
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

// Grass grows tuft by tuft. Grown tufts seed neighbours a few px along the same dirt, over bumps and up and
// down the faces of piles (but not cliffs, or onto a ledge with a gap under it); tufts that get buried, flooded
// or lose their dirt wither away.
const growGrass = (world, patch, rate) => {
  const g = patch.genome;
  const ter = world.terrain;
  const check = (world.time + Math.floor(patch.base.x)) % 10 === 0;
  for (const tuft of [...patch.tufts]) {
    if (check) {
      const above = cellAt(ter, tuft.x, tuft.y - 1);
      const y = groundTop(world, tuft.x, tuft.y - 1);
      if ((above >= 0 && ter.cells[above] !== EMPTY) || Math.abs(y - tuft.y) > 3 || !isSoil(world, tuft.x, y)) {
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
  const breeze = Math.sin(world.time * 0.017 + vine.base.x * 0.05) * 0.015 * (1 - g.stiffness * 0.7);
  Object.assign(nodes[0], { x: vine.base.x, y: vine.base.y });
  nodes.forEach((p, i) => {
    if (i === 0) return;
    p.wet = wetAt(world.terrain, p);
    const vx = (p.x - p.px) * 0.95;
    const vy = (p.y - p.py) * 0.95;
    p.px = p.x;
    p.py = p.y;
    p.x += vx + breeze + (p.wet ? VINE_CURRENT * Math.sin(world.time * 0.03 - i * 0.4) : 0);
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
      if (d < 4) consider(d, { plant: obj, stem, p: pointAt(g, project(g, x, y)) });
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
      if (d2 < best) [best, hit] = [d2, { bug, i }];
    }
  }
  return hit;
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
    const hit = prunableAt(world, x, y, true);
    if (hit) world.moving = { obj: hit.plant ?? hit.grass ?? hit.vine, x, y };
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
  const hit = bugAt(world, x, y);
  if (hit) world.press = { ...hit, x, y };
  else world.touch = { x, y, hit: prunableAt(world, x, y, true) }; // a plant there, to pull if it's dragged
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
    detach(press.bug, 'held');
    world.held = { bug: press.bug, i: press.i };
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
    world.selected = world.press.bug;
    world.press = null;
    return;
  }
  if (world.held) {
    const bug = world.held.bug;
    world.held = null;
    setState(bug, 'fall', 0);
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
  if (world.held) setState(world.held.bug, 'fall', 0);
  Object.assign(world, { held: null, press: null, touch: null, pull: null, cut: null, painting: false, moving: null });
};

// What a press at the pointer would do, to show it before it's done: grab a bug, cut something there (hit, as
// prunableAt gives it), lift a plant to move it, pick a plant to take a cutting from, or put down the plant
// lifted or picked. Null if nothing, or the pointer isn't over the tank.
export const aimAt = (world) => {
  if (!world.hover || world.placing || world.held || world.pull || world.cut || world.painting) return null;
  const { x, y } = world.pointer;
  const tool = world.tool;
  if (tool === 'hand' && bugAt(world, x, y)) return { kind: 'bug' };
  if (tool === 'hand' || tool === 'prune') {
    const hit = prunableAt(world, x, y);
    return hit && { kind: 'cut', hit };
  }
  if (tool !== 'move' && tool !== 'propagate') return null;
  if (world.moving) return { kind: 'drop' };
  const hit = prunableAt(world, x, y, true);
  if (tool === 'move' && hit) return { kind: 'lift', obj: hit.plant ?? hit.grass ?? hit.vine };
  return hit?.plant && tool === 'propagate' && propagatable(hit.plant) ? { kind: 'pick', obj: hit.plant } : null;
};

// Tap something to prune it; tap empty space to deselect.
const tap = (world, x, y) => {
  const hit = prunableAt(world, x, y);
  if (hit) pruneHit(world, hit);
  else world.selected = null;
};

// ---------- relocating plants ----------

// Where a plant, grass patch or vine dragged by (dx, dy) ends up: its base moves as far as the pointer did,
// then lands the way a new one would.
const destination = (world, obj, dx, dy) => {
  const [x, y] = [obj.base.x + dx, obj.base.y + dy];
  if (obj.kind === 'vine') return vineAnchor(world, x, y);
  return obj.kind === 'grass' ? sowAt(world, x, y) : standAt(world, x, y);
};

// The plant being dragged and where it would land (or, propagating, where its seedling would go), for drawing.
export const relocationAt = (world) => {
  const m = world.moving;
  if (!m || !world.objects.includes(m.obj)) return null;
  const { x, y } = world.pointer;
  const to = world.tool === 'propagate' ? standAt(world, x, y) : destination(world, m.obj, x - m.x, y - m.y);
  if (!to) return null;
  return { obj: m.obj, base: to.base, dx: to.base.x - m.obj.base.x, dy: to.base.y - m.obj.base.y };
};

// Move a plant, grass patch or vine so its base is at to.base.
const relocate = (world, obj, to) => {
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
    // Each tuft settles onto whatever is below it; any that land off dirt wither.
    for (const tuft of obj.tufts) {
      tuft.x = clamp(tuft.x + dx, 1, world.W - 2);
      tuft.y = groundTop(world, tuft.x, tuft.y + dy - 3);
    }
  }
  Object.assign(obj, { base: to.base, on: to.on, hold: to.hold });
};

// A flowering plant that has finished growing: nothing still growing or about to sprout, and its flowers open.
export const propagatable = (obj) =>
  obj.kind === 'plant' &&
  obj.stems.some((st) => st.flower >= 1) &&
  obj.stems.every((st) => !st.growing && st.sprout <= 0 && (!st.bud || st.flower >= 1));

// Take a cutting: a seedling of the same species goes in at to, and the parent is cut right back to a seedling
// too, so both start again.
const propagate = (world, plant, to) => {
  for (const st of plant.stems) fling(world, st.root, st.tip, { kind: 'stem', plant });
  plant.stems = [newStem(world, plant, null, plant.base, -Math.PI / 2 + plant.species.lean)];
  addDecor(world, { kind: 'plant', base: to.base, on: to.on, species: structuredClone(plant.species) });
};

// ---------- simulation step ----------

export const step = (world) => {
  world.time++;
  const ter = world.terrain;
  if (world.painting) paintAt(world, world.pointer); // holding still keeps pouring
  stepTerrain(ter, world.rand, world.time);
  if (ter.skyDirty && (world.time % 8 === 0 || !ter.active)) rebuildSkyline(world);
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
    if (obj.kind === 'plant') growPlant(world, obj, params.plantGrowth);
    else if (obj.kind === 'grass') growGrass(world, obj, params.plantGrowth);
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
    if (bug.surf) think(world, bug);
    if (bug.surf) followSurface(world, bug);
    else simulateLoose(world, bug);
  }
  matchDancers(world);
  stepCrumbs(world);
  stepDebris(world);
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

// Verlet physics for falling or held bugs; settles onto a surface when at rest.
const simulateLoose = (world, bug) => {
  const isHeld = world.held?.bug === bug;
  const pin = () => {
    if (!isHeld) return;
    const p = bug.pts[world.held.i];
    p.x = world.pointer.x;
    p.y = world.pointer.y;
  };
  for (const p of bug.pts) {
    const vx = (p.x - p.px) * 0.99;
    const vy = (p.y - p.py) * 0.99;
    p.px = p.x;
    p.py = p.y;
    p.x += vx;
    p.y += vy + params.gravity;
  }
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

// Walk to a random spot on any surface the bug can reach.
const wander = (world, bug) => {
  const options = [...reachable(world, bug.surf)];
  const surf = options[Math.floor(world.rand() * options.length)];
  goTo(world, bug, surf, world.rand() * segLength(surf));
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
      if (leaf.size < 0.4) continue;
      const p = pointAt(g, leaf.t * segLength(g));
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
      c.vy = Math.min(c.vy + 0.03, 0.6);
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

export const releaseBug = (world, bug) => {
  if (bug.partner) bug.partner.partner = null;
  world.bugs = world.bugs.filter((b) => b !== bug);
  if (world.held?.bug === bug) world.held = null;
  if (world.selected === bug) world.selected = null;
};

// What the panel shows: coins, the shop and tool state, and the selected bug.
export const snapshot = (world) => {
  const bug = world.bugs.includes(world.selected) ? world.selected : null;
  return {
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
    selected: bug && {
      name: bug.name,
      hunger: bug.hunger,
      genes: bug.genes,
      t: bug.t,
    },
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
    return { kind, base, hold: obj.hold, wood: obj.wood, foliage: obj.foliage, segs };
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
});

// Build a tank from saved data, at this tank's size. Everything is kept on the floor: if the tank is taller or
// shorter than when it was saved, things move down or up with it.
export const importWorld = (data, W, H) => {
  const world = createWorld(W, H, { scene: false });
  const dy = world.ground.y0 - (data.H - 6);
  const at = (p) => ({ x: clamp(p.x, 0, W - 1), y: p.y + dy });
  Object.assign(world, {
    time: data.time,
    coins: data.coins,
    clippings: data.clippings,
    rerolls: data.rerolls,
    wallpaper: data.wallpaper,
    shop: data.shop,
    offers: data.offers,
  });
  const t = data.terrain;
  const n = t.cols * t.rows;
  const saved = { cols: t.cols, rows: t.rows, cells: unrle(t.cells, n), tint: unrle(t.tint, n) };
  world.terrain = resizeTerrain(saved, W, world.ground.y0);
  for (const o of data.objects) {
    const obj = { kind: o.kind, base: at(o.base) };
    if (o.kind === 'stick' || o.kind === 'plant') obj.hold = o.hold && at(o.hold); // standing on the terrain
    if (o.kind === 'stick') {
      Object.assign(obj, { wood: o.wood, foliage: o.foliage, segs: [] });
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
      const nodes = o.nodes.map((p) => ({ ...at(p), px: p.px, py: p.py + dy }));
      Object.assign(obj, { genome: o.genome, hold: o.hold && at(o.hold), nodes, growth: o.growth });
    }
    world.objects.push(obj);
  }
  rebuildJunctions(world);
  rebuildSkyline(world);
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
    for (const g of b.standing ? surfaces(world) : []) {
      const d = distToSeg(g, p.x, p.y);
      if (d < 4 && (!near || d < near.d)) near = { d, g };
    }
    const bug = near
      ? placeBug(world, near.g, project(near.g, p.x, p.y), Math.sign(segDir(near.g).x || 1) * b.facing, b.genes)
      : addBug(world, p.x, p.y - 10, b.genes);
    if (bug) Object.assign(bug, { name: b.name, hunger: b.hunger });
  }
  return world;
};

