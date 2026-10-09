// Fliers: the small flying bugs, three kinds of them sharing one way of life, and the aphids. Ladybugs (domed, red
// and spotted, mostly) hunt the aphids that now and then settle on the plants, and with none about eat pollen at the
// open flowers; soldier beetles (long, orange with dark tips, mostly) live on the flowers' pollen, and eat aphids when
// there's none; shield bugs (flat, green or brown, mostly) sip sap from the stems. They all clamber about the plants
// and sticks and fly between them, finding their way through the air, bask at the tips, groom, huddle up with their
// own kind to rest, stop to touch antennae when they meet on a stem (then one turns back and the other goes round),
// and climb to the top of whatever they're on before they take off. Startled, the bold ones fly off; the rest drop
// and play dead on their backs, or a shield bug lets off a stink where it is. Dropping toward water, or with water
// rising round them, they fly off. Pure data + functions, like the rest of the simulation.
import { stickWidth } from './decor.js';
import { clamp, lerp, pick } from './geom.js';
import { CELL, cellAt, EMPTY, WATER } from './terrain.js';
import { wind } from './life.js';
import { params } from './tuning.js';

const HUNGER = 1 / 12000; // per tick, for an average appetite
const BITE = 0.3; // hunger an aphid takes away
const POLLEN = 1 / 1500; // and a tick of pollen
const SAP = 1 / 2000; // and a tick of sap
const WALK = 0.07; // px a tick, for an average speed
const FLY = 0.5;
const GRAVITY = 0.08;
const LIFT_TICKS = 30; // opening its wings to take off
const FLIGHT_TICKS = 900; // flying this long without getting where it's going, it makes for somewhere else
const REPLAN_TICKS = 60; // how often it works out its way through the air again, as the terrain or its perch moves
const REACH = 2; // cells of air a flier's body takes up from its feet: either side of them, and up
const MAX_APHIDS = 60;
const COLONY = 12; // aphids a plant holds at most
const APHID_EVERY = 1200; // ticks between chances of aphids arriving on a plant
const APHID_GROW = 1 / 3000; // a newborn aphid grows up in this many ticks, and can breed
const BREED = 1 / 2500; // chance a tick a grown aphid has a young one
const APHID_LIFE = 20000; // ticks, give or take half

const range = (rand, lo, hi) => lo + rand() * (hi - lo);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- genome ----------

const BLACK = { h: 0, s: 0, l: 12 };
const red = (rand) => ({ h: range(rand, -4, 8), s: range(rand, 75, 90), l: range(rand, 42, 50) });
const orange = (rand) => ({ h: range(rand, 18, 30), s: range(rand, 85, 95), l: range(rand, 48, 55) });
const yellow = (rand) => ({ h: range(rand, 48, 56), s: 85, l: 56 });
const pink = (rand) => ({ h: range(rand, 338, 352), s: 65, l: 68 });
const steel = (rand) => ({ h: range(rand, 205, 225), s: 50, l: 34 });
const GOLD = { h: 46, s: 85, l: 55 };
const SOOT = { h: 240, s: 6, l: 19 }; // a black shell, just lighter than a black wallpaper
const green = (rand) => ({ h: range(rand, 95, 125), s: range(rand, 45, 65), l: range(rand, 36, 46) });
const brown = (rand) => ({ h: range(rand, 20, 35), s: range(rand, 30, 50), l: range(rand, 30, 40) });
const PALE = { h: 50, s: 40, l: 78 };

// Each kind's looks, how often each comes up, and how rare (0..3) it is: the rarer, the dearer.
const LOOKS = {
  // Most are red or orange with black spots; some are yellow with lots of little ones, pink, or black with red ones;
  // a few are spotless, and the rarest of all a metallic steel blue or gold. A white collar is a harlequin's.
  ladybug: [
  { weight: 30, rare: 0, look: (rand) => ({ shell: red(rand), spots: 7 }) },
  { weight: 14, rare: 0, look: (rand) => ({ shell: red(rand), spots: 2 }) },
  { weight: 12, rare: 1, look: (rand) => ({ shell: orange(rand), spots: 10 + Math.floor(rand() * 6) }) },
  {
    weight: 10,
    rare: 1,
    look: (rand) => ({ shell: orange(rand), spots: 16 + Math.floor(rand() * 4), collar: 'white' }),
  },
  { weight: 9, rare: 1, look: (rand) => ({ shell: yellow(rand), spots: 22 }) },
  { weight: 8, rare: 1, look: (rand) => ({ shell: rand() < 0.5 ? red(rand) : orange(rand), spots: 0 }) },
  { weight: 7, rare: 2, look: (rand) => ({ shell: SOOT, spot: red(rand), spots: rand() < 0.5 ? 2 : 4 }) },
  { weight: 5, rare: 2, look: (rand) => ({ shell: pink(rand), spots: 12 }) },
  { weight: 3, rare: 3, look: (rand) => ({ shell: steel(rand), spots: 0, metallic: true }) },
  { weight: 2, rare: 3, look: (rand) => ({ shell: GOLD, spots: rand() < 0.5 ? 0 : 7, metallic: true }) },
  ],
  // Mostly green or brown, the edge of the shield banded, now and then a pale tip to it; rarer, a red one striped
  // black, and rarest a metallic blue.
  shieldbug: [
    { weight: 45, rare: 0, look: (rand) => ({ shell: green(rand), edge: { h: 75, s: 40, l: 30 } }) },
    { weight: 28, rare: 0, look: (rand) => ({ shell: brown(rand), edge: { h: 40, s: 35, l: 62 } }) },
    { weight: 15, rare: 1, look: (rand) => ({ shell: green(rand), edge: { h: 75, s: 40, l: 30 }, tip: PALE }) },
    { weight: 8, rare: 2, look: (rand) => ({ shell: red(rand), edge: { h: 0, s: 0, l: 24 }, stripes: true }) },
    { weight: 4, rare: 3, look: (rand) => ({ shell: steel(rand), edge: SOOT, metallic: true }) },
  ],
  // Mostly orange with dark wing tips; some with slate grey wing cases and an orange collar, yellow, or red.
  soldier: [
    { weight: 50, rare: 0, look: (rand) => ({ shell: orange(rand), tip: SOOT, collar: orange(rand), head: SOOT }) },
    { weight: 25, rare: 1, look: (rand) => ({ shell: { h: 220, s: 15, l: 34 }, collar: orange(rand), head: SOOT }) },
    { weight: 15, rare: 1, look: (rand) => ({ shell: yellow(rand), tip: SOOT, collar: yellow(rand), head: SOOT }) },
    { weight: 10, rare: 2, look: (rand) => ({ shell: red(rand), tip: SOOT, collar: red(rand), head: SOOT }) },
  ],
};
export const KINDS = Object.keys(LOOKS);

// A flier's genome: its kind, its looks, and its nature, the genes running 0..1: size, speed, appetite, boldness
// (whether it flies off when startled, or plays dead or stinks), sociability (how much it likes to huddle up with its
// own kind), wanderlust (how often it flies off somewhere else) and activity (how little it rests).
export const makeFlier = (rand, kind = 'ladybug') => {
  const looks = LOOKS[kind];
  let roll = rand() * looks.reduce((n, l) => n + l.weight, 0);
  const look = looks.find((l) => (roll -= l.weight) < 0) ?? looks[0];
  return {
    kind,
    rare: look.rare,
    spot: BLACK,
    collar: 'black',
    metallic: false,
    ...look.look(rand),
    size: rand(),
    speed: rand(),
    appetite: rand(),
    boldness: rand(),
    sociability: rand(),
    wanderlust: rand(),
    activity: rand(),
    seed: Math.floor(rand() * 1000),
  };
};

export const flierPrice = (g) => 7 + g.rare * 6 + (g.size > 0.8 ? 2 : 0);

// Its build in px, from its tail to the front of its head, and the height of its shell: a ladybug's a little dome, a
// shield bug's longer and flatter, a soldier beetle's longer still, and narrow.
const BUILDS = { ladybug: [5, 2.6], shieldbug: [6, 2.2], soldier: [6.5, 2.2] };
export const flierShape = (g) => {
  const k = 0.9 + 0.4 * g.size;
  const [len, high] = BUILDS[g.kind];
  return { len: len * k, high: high * k };
};

// What each kind eats, first choice first.
const DIETS = { ladybug: ['aphids', 'pollen'], soldier: ['pollen', 'aphids'], shieldbug: ['sap'] };

const NAMES = {
  ladybug: [
    'Dot', 'Ruby', 'Pepper', 'Poppy', 'Cherry', 'Spot', 'Freckles', 'Scarlet', 'Button', 'Pip', 'Polka', 'Rosie',
    'Bean', 'Juniper', 'Marigold', 'Penny', 'Tomato', 'Berry', 'Ember', 'Pimento', 'Chili', 'Speckle', 'Lulu',
  ],
  shieldbug: [
    'Shelby', 'Sage', 'Basil', 'Moss', 'Olive', 'Pickle', 'Fern', 'Clover', 'Bramble', 'Thistle', 'Acorn', 'Hazel',
  ],
  soldier: [
    'Rusty', 'Ginger', 'Sergeant', 'Major', 'Copper', 'Amber', 'Sunny', 'Marmalade', 'Pumpkin', 'Cinnamon', 'Private',
  ],
};
const TITLES = ['Little ', 'Lady ', 'Sir ', 'Miss ', 'Old '];
export const flierName = (rand, kind = 'ladybug') =>
  (rand() < 0.2 ? pick(rand, TITLES) : '') + pick(rand, NAMES[kind]);

// ---------- where they get about ----------

const cellOf = (world, x, y) => world.terrain.cells[cellAt(world.terrain, x, y)]; // undefined outside the grid
const wet = (world, x, y) => cellOf(world, x, y) === WATER;
const solid = (world, x, y) => {
  if (y >= world.ground.y0) return true;
  const m = cellOf(world, x, y);
  return m !== undefined && m !== EMPTY && m !== WATER;
};
// Would a flier with its feet at (x, y) be in the terrain: under its middle, front, back or the top of its shell.
const inTerrain = (world, b, x, y) => {
  const { len, high } = flierShape(b.genome);
  return [[0, 1], [-len / 2, 1], [len / 2, 1], [0, high]].some(([dx, dy]) => solid(world, x + dx, y - dy));
};
// The first solid row at or below y at x: the top of the terrain there, or the tank floor.
const floorTop = (world, x, y) => {
  let fy = Math.max(0, Math.ceil(y));
  while (!solid(world, x, fy)) fy++;
  return fy;
};
// The floor a flier at x stands on: the highest under any of its feet, so one on the edge of a ledge is on it.
const floorUnder = (world, b, x, y) => {
  const half = flierShape(b.genome).len / 2;
  return Math.min(floorTop(world, x - half, y), floorTop(world, x, y), floorTop(world, x + half, y));
};

// Plants and sticks are trees of parts (a plant's stems, a stick's pieces), each growing from the tip of its parent.
const partsOf = (obj) => obj.stems ?? obj.segs;
const kidsOf = (obj, part) => partsOf(obj).filter((p) => p.parent === part);
const chainTo = (part) => {
  const out = [];
  for (let p = part; p; p = p.parent) out.unshift(p);
  return out;
};
const there = (world, perch) => world.objects.includes(perch.obj) && partsOf(perch.obj).includes(perch.part);

// On a part u of the way from its root to its tip, on one side of it: where its surface is, the way along it (root to
// tip) and its outward normal on that side.
const frameOf = ({ obj, part, u, side }) => {
  const [dx, dy] = [part.tip.x - part.root.x, part.tip.y - part.root.y];
  const len = Math.hypot(dx, dy) || 1;
  const d = { x: dx / len, y: dy / len };
  const n = { x: d.y * side, y: -d.x * side };
  const r = obj.kind === 'stick' ? stickWidth(obj.style, part.depth) / 2 : 0.6;
  return { len, d, n, at: { x: part.root.x + dx * u + n.x * r, y: part.root.y + dy * u + n.y * r } };
};

// The upper side of a part: on a stick, the side to walk along the top of it.
const topSide = (part) => (part.tip.x - part.root.x >= 0 ? 1 : -1);

// Places to land: the tips of plants' shoots and leaves, and along the sticks, on top. Not in the water.
const landingSpots = (world) => {
  const spots = [];
  for (const obj of world.objects) {
    if (obj.kind === 'plant') {
      const parents = new Set(obj.stems.map((st) => st.parent));
      for (const part of obj.stems) if (!parents.has(part)) spots.push({ obj, part, u: 1, side: 1 });
    } else if (obj.kind === 'stick') {
      for (const part of obj.segs) spots.push({ obj, part, u: 0.5, side: topSide(part) });
    }
  }
  return spots.filter((s) => {
    const { at } = frameOf(s);
    return !wet(world, at.x, at.y) && at.y > 3;
  });
};

// Open flowers, for pollen.
const flowersOf = (world) => {
  const out = [];
  for (const obj of world.objects) {
    if (obj.kind !== 'plant') continue;
    for (const part of obj.stems) {
      if (!part.bud || part.flower < 1 || part.wilt > 0.2 || (part.role === 'runner' && !part.sideBloom)) continue;
      if (!wet(world, part.tip.x, part.tip.y)) out.push({ obj, part, u: 1, side: 1 });
    }
  }
  return out;
};

// ---------- the way through the air ----------

// The air, cell by cell on the terrain's grid: open (no terrain or water) and roomy (open as far round as a
// flier's body reaches from its feet there), worked out afresh when the terrain changes.
const airs = new WeakMap();
const airOf = (world) => {
  const ter = world.terrain;
  const known = airs.get(ter);
  if (known?.version === ter.version) return known;
  const { cols, rows, cells, top } = ter;
  const open = cells.map((m) => (m === EMPTY ? 1 : 0));
  const across = new Uint8Array(cols * rows); // open REACH cells either side (and not past the glass)
  for (let i = 0; i < across.length; i++) {
    const c = i % cols;
    let ok = c >= REACH && c < cols - REACH;
    for (let k = -REACH; k <= REACH && ok; k++) ok = open[i + k] === 1;
    across[i] = ok ? 1 : 0;
  }
  const roomy = new Uint8Array(cols * rows); // and REACH cells up (above the grid is all air)
  for (let i = 0; i < roomy.length; i++) {
    let ok = across[i] === 1;
    for (let k = 1; k <= REACH && ok && i - k * cols >= 0; k++) ok = across[i - k * cols] === 1;
    roomy[i] = ok ? 1 : 0;
  }
  const air = { version: ter.version, cols, rows, top, open, roomy };
  airs.set(ter, air);
  return air;
};

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// A way through the air from a to b (px), as the points to fly straight between, the last of them b: a breadth-first
// search of the cells, through roomy air, but near either end (squeezing out of a nook, or in to a perch by a wall)
// through any open air. Null if there's no way.
const wayThrough = (world, a, b) => {
  const { cols, rows, open, roomy, top } = airOf(world);
  const cellOfP = (p) =>
    clamp(Math.floor(p.x / CELL), 0, cols - 1) + clamp(Math.floor((p.y - top) / CELL), 0, rows - 1) * cols;
  const [from, to] = [cellOfP(a), cellOfP(b)];
  const [col, row] = [(i) => i % cols, (i) => Math.floor(i / cols)];
  const near = (i, j) => Math.abs(col(i) - col(j)) <= 3 && Math.abs(row(i) - row(j)) <= 3;
  const ok = (i) => roomy[i] === 1 || i === to || (open[i] === 1 && (near(i, from) || near(i, to)));
  const prev = new Int32Array(cols * rows).fill(-1);
  prev[from] = from;
  const queue = [from];
  for (let q = 0; q < queue.length && prev[to] < 0; q++) {
    const i = queue[q];
    const [c, r] = [col(i), row(i)];
    for (const [dc, dr] of STEPS) {
      const [nc, nr] = [c + dc, r + dr];
      const j = nr * cols + nc;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows || prev[j] >= 0 || !ok(j)) continue;
      if (dc && dr && !(ok(r * cols + nc) && ok(nr * cols + c))) continue; // no cutting corners
      prev[j] = i;
      queue.push(j);
    }
  }
  if (prev[to] < 0) return null;
  const pts = [b];
  for (let i = prev[to]; i !== from; i = prev[i]) {
    pts.unshift({ x: col(i) * CELL + CELL / 2, y: top + row(i) * CELL + CELL / 2 });
  }
  // Straighten it out: from each point on to the furthest one it can fly straight to.
  const seen = (p, q) => {
    const n = Math.ceil(dist(p, q));
    for (let k = 1; k < n; k++) if (!ok(cellOfP(lerp(p, q, k / n)))) return false;
    return true;
  };
  const way = [];
  for (let [p, i] = [a, 0]; i < pts.length; ) {
    let j = i;
    while (j + 1 < pts.length && seen(p, pts[j + 1])) j++;
    way.push((p = pts[j]));
    i = j + 1;
  }
  return way;
};

// ---------- aphids ----------

const newAphid = (rand, obj, part, u) => ({
  obj,
  part,
  u,
  side: rand() < 0.5 ? -1 : 1,
  x: 0,
  y: 0,
  size: 0.3,
  age: 0,
  life: APHID_LIFE * (0.5 + rand()),
  seed: rand() * 1000,
});

// Now and then a few aphids settle on a plant out of the water, and they breed, up to a colony a plant. They live a
// few minutes, and go with the stem they're on, or under the water. A plant with aphids on it drops its old leaves
// sooner (sim.js reads `pests`). Their own random numbers, like the rest of the tank's life.
const stepAphids = (world) => {
  const r = world.lifeRand;
  if (world.time % APHID_EVERY === 0 && world.aphids.length < MAX_APHIDS && r() < 0.35 * params.aphids) {
    const plants = world.objects.filter((o) => o.kind === 'plant' && o.stems.length > 2);
    const obj = plants.length ? pick(r, plants) : null;
    const part = obj && pick(r, obj.stems);
    if (part && !wet(world, part.tip.x, part.tip.y)) {
      const at = r();
      for (let i = 2 + Math.floor(r() * 3); i > 0; i--) world.aphids.push(newAphid(r, obj, part, at));
    }
  }
  const colony = new Map();
  for (const a of world.aphids) colony.set(a.obj, (colony.get(a.obj) ?? 0) + 1);
  for (const o of world.objects) if (o.kind === 'plant') o.pests = colony.get(o) ?? 0;
  const born = [];
  world.aphids = world.aphids.filter((a) => {
    if (!there(world, a)) return false;
    if (r() < 0.002) a.u = Math.min(1, Math.max(0, a.u + (r() - 0.5) * 0.15)); // shuffle along a little
    Object.assign(a, frameOf(a).at);
    if (wet(world, a.x, a.y)) return false;
    a.size = Math.min(1, a.size + APHID_GROW);
    const room = colony.get(a.obj) < COLONY && world.aphids.length + born.length < MAX_APHIDS;
    if (a.size >= 1 && room && r() < BREED * params.aphids) {
      born.push(newAphid(r, a.obj, a.part, Math.min(1, Math.max(0, a.u + (r() - 0.5) * 0.1))));
      colony.set(a.obj, colony.get(a.obj) + 1);
    }
    return ++a.age < a.life;
  });
  world.aphids.push(...born);
};

// ---------- fliers ----------

export const newFlier = (world, x, y, genome, name = flierName(world.rand)) => ({
  name,
  genome,
  x, // its feet
  y,
  mode: 'air', // on a 'tree' (a plant or stick), on the 'ground', in the 'air', on its 'back' or 'held'
  perch: null, // on a tree: {obj, part, u: 0..1 from its root to its tip, side: which side of it, +-1}
  dir: world.rand() < 0.5 ? -1 : 1, // the way it's going: on a tree +1 is toward the tip, elsewhere to the right
  vx: 0,
  vy: 0,
  flying: true, // in the air: flying, or falling
  to: null, // the perch it's heading for, walking or flying
  way: null, // flying there, the points it's flying through
  replan: 0, // ticks till it works its way out again
  flown: 0, // ticks it's been flying
  lost: 0, // times this flight it's found no way to where it was going
  then: null, // and what it'll do there: {kind: 'eat', aphid} | {kind: 'pollen'} | {kind: 'rest', ticks}
  // What it's doing where it is, and for how long ({kind, ticks}): eating an aphid, at pollen, sipping sap, resting,
  // grooming, meeting another, stretching its wings, letting off a stink or lifting off.
  act: null,
  think: 0, // ticks until it next decides what to do
  hunger: 0.3,
  dead: 0, // ticks left of playing dead
  met: 0, // ticks before it'll stop to meet another again
  wings: 0, // 0 folded .. 1 wide open
  stride: 0, // px walked, for its legs
  fwd: { x: 1, y: 0 }, // which way it faces, and which way is up from its feet, for drawing
  up: { x: 0, y: -1 },
  seed: world.rand() * 1000,
});

// Put in at (x, y), it flies off to the nearest place to land.
export const addFlier = (world, x, y, genome, name) => {
  const b = newFlier(world, x, y, genome, name);
  const spots = landingSpots(world);
  b.to = spots.length ? spots.reduce((a, s) => (dist(frameOf(s).at, b) < dist(frameOf(a).at, b) ? s : a)) : null;
  world.fliers.push(b);
  return b;
};

// The nearest flier within reach of (x, y), to pick up or look at.
export const flierAt = (world, x, y) => {
  let best = null;
  for (const b of world.fliers) {
    const d = Math.hypot(b.x - x, b.y - 1 - y);
    if (d < 5 && (!best || d < best.d)) best = { d, flier: b };
  }
  return best;
};

const speedOf = (b) => WALK * (0.6 + 0.8 * b.genome.speed);

// Off whatever it's on and into the air: flying (to b.to, if it's going anywhere) or falling.
const airborne = (b, flying) => {
  Object.assign(b, { mode: 'air', perch: null, flying, act: null, vy: flying ? -0.5 : 0 });
  return Object.assign(b, { flown: 0, way: null, lost: 0 });
};

// Somewhere else in the tank to fly to, not on the tree it's on.
const elsewhere = (world, b) => {
  const spots = landingSpots(world).filter((s) => s.obj !== b.perch?.obj);
  return spots.length ? pick(world.rand, spots) : null;
};

// Head for perch `to`, and do `then` there.
const goTo = (b, to, then = null) => Object.assign(b, { to, then });

// Landed on (or walked to) where it was going: on with what it went for.
const arrive = (world, b) => {
  const then = b.then;
  Object.assign(b, { to: null, then: null });
  if (!then) return;
  if (then.kind === 'eat' && world.aphids.includes(then.aphid)) {
    b.dir = Math.sign(then.aphid.u - b.perch.u) || b.dir;
    b.act = { kind: 'eat', ticks: 45, aphid: then.aphid };
  } else if (then.kind === 'pollen') {
    b.act = { kind: 'pollen', ticks: 300 + world.rand() * 400 };
  } else if (then.kind === 'sap') {
    b.act = { kind: 'sap', ticks: 400 + world.rand() * 400 };
  } else if (then.kind === 'rest') {
    b.act = { kind: 'rest', ticks: then.ticks };
  }
};

// Onto a plant or stick from the ground at the root of its part, on the side it came from.
const mount = (b, obj, part) => {
  const up = part.tip.y - part.root.y;
  const side = Math.sign(up) === -b.dir ? 1 : -1;
  Object.assign(b, { mode: 'tree', perch: { obj, part, u: 0, side }, dir: 1 });
};

// Down off the root of a tree: onto the stick a plant stands on, or the ground.
const stepOff = (world, b) => {
  const { obj, part } = b.perch;
  const { n } = frameOf(b.perch);
  const stick = obj.on?.obj?.kind === 'stick' && obj.on.obj.segs.includes(obj.on) ? obj.on : null;
  if (stick) {
    const [dx, dy] = [stick.tip.x - stick.root.x, stick.tip.y - stick.root.y];
    const u = ((part.root.x - stick.root.x) * dx + (part.root.y - stick.root.y) * dy) / (dx * dx + dy * dy || 1);
    b.perch = { obj: stick.obj, part: stick, u: Math.min(1, Math.max(0, u)), side: topSide(stick) };
    b.dir = world.rand() < 0.5 ? -1 : 1;
    return;
  }
  const dir = Math.sign(n.x) || b.dir;
  const x = part.root.x + dir;
  Object.assign(b, { mode: 'ground', perch: null, dir, x, y: floorTop(world, x, part.root.y - 3) });
};

// Which shoot to take at a fork: the one on the way (an array of parts) if it's going somewhere, the one reaching
// highest if it's climbing ('up'), else any.
const forkTo = (world, kids, way) => {
  if (Array.isArray(way)) return kids.find((k) => way.includes(k)) ?? null;
  if (way === 'up') return kids.reduce((a, k) => (!a || k.tip.y < a.tip.y ? k : a), null);
  return kids.length ? pick(world.rand, kids) : null;
};

// Another flier just ahead on the same part: they stop and touch antennae.
const meet = (world, b, len) => {
  if (b.met > 0) return false;
  const size = flierShape(b.genome).len;
  const other = world.fliers.find(
    (c) =>
      c !== b &&
      c.mode === 'tree' &&
      c.perch.part === b.perch.part &&
      (!c.act || c.act.kind === 'rest') &&
      (c.perch.u - b.perch.u) * len * b.dir > 0 &&
      (c.perch.u - b.perch.u) * len * b.dir < size + 1,
  );
  if (!other) return false;
  const ticks = 50 + world.rand() * 60;
  b.act = { kind: 'meet', ticks, with: other };
  other.act = { kind: 'meet', ticks, with: b };
  other.dir = -b.dir;
  b.met = other.met = 400;
  return true;
};

// A step along whatever it's on, b.dir-wards. On a tree it follows `way` at the forks (see forkTo); off the root it
// steps down. On the ground it walks over bumps, turns back at walls, the water and the tank's sides, falls off
// ledges, and climbs a plant or stick it comes to if it's on the way (`way` from the root up, on `obj`) or now and
// then if it's just wandering. What happened: 'tip' (at a tip, nowhere further to go), 'met', 'blocked' or null.
const crawl = (world, b, way = null, obj = null) => {
  const speed = speedOf(b);
  b.stride += speed;
  if (b.mode === 'ground') {
    const x = b.x + b.dir * speed;
    const front = x + (b.dir * flierShape(b.genome).len) / 2;
    if (x < 2 || x > world.W - 3 || solid(world, front, b.y - 3) || wet(world, front, b.y - 1)) {
      b.dir = -b.dir;
      return 'blocked';
    }
    const y = floorUnder(world, b, x, b.y - 3);
    b.x = x;
    if (y - b.y > 5) {
      airborne(b, false); // over the edge
      return null;
    }
    b.y = y;
    const root = Array.isArray(way) ? way[0] : null;
    if (root && Math.abs(root.root.x - b.x) < 0.8 && Math.abs(root.root.y - b.y) < 4) mount(b, obj, root);
    else if (!way && world.rand() < 0.03) {
      for (const o of world.objects) {
        if (o.kind !== 'plant' && o.kind !== 'stick') continue;
        const r = partsOf(o).find((p) => !p.parent && Math.abs(p.root.x - b.x) < 0.8 && Math.abs(p.root.y - b.y) < 4);
        if (r) return mount(b, o, r);
      }
    }
    return null;
  }
  const perch = b.perch;
  const { len } = frameOf(perch);
  if (meet(world, b, len)) return 'met';
  const ahead = frameOf({ ...perch, u: perch.u + (b.dir * (speed + 1)) / len }).at;
  if (wet(world, ahead.x, ahead.y)) {
    b.dir = -b.dir; // the water's ahead
    return 'blocked';
  }
  perch.u += (b.dir * speed) / len;
  if (perch.u > 1) {
    const next = forkTo(world, kidsOf(perch.obj, perch.part), way);
    if (!next) {
      perch.u = 1;
      return 'tip';
    }
    perch.u = ((perch.u - 1) * len) / frameOf({ ...perch, part: next }).len;
    perch.part = next;
  } else if (perch.u < 0) {
    const parent = perch.part.parent;
    if (!parent) {
      stepOff(world, b);
      return null;
    }
    perch.u = 1 + (perch.u * len) / frameOf({ ...perch, part: parent }).len;
    perch.part = parent;
  }
  return null;
};

// Get going to b.to: along the tree it's on if that's where it is, over the ground to its foot if that's near, and
// otherwise (or if the water's in the way) up to the top of whatever it's on and off, flying.
const head = (world, b) => {
  const to = b.to;
  const lift = () => (b.act = { kind: 'lift', ticks: LIFT_TICKS });
  if (b.mode === 'tree' && b.perch.obj === to.obj) {
    const { part, u } = b.perch;
    if (part === to.part && Math.abs(to.u - u) * frameOf(b.perch).len < 0.8) return arrive(world, b);
    const way = chainTo(to.part);
    b.dir = part === to.part ? Math.sign(to.u - u) : way.includes(part) ? 1 : -1;
    if (crawl(world, b, way, to.obj) === 'blocked') lift();
    return;
  }
  const way = chainTo(to.part);
  const foot = way[0].root;
  if (b.mode === 'ground' && Math.abs(foot.y - b.y) < 6 && Math.abs(foot.x - b.x) < 50) {
    b.dir = Math.sign(foot.x - b.x) || b.dir;
    if (crawl(world, b, way, to.obj) === 'blocked') lift();
    return;
  }
  if (b.mode === 'tree' && (b.perch.u < 1 || kidsOf(b.perch.obj, b.perch.part).length)) {
    b.dir = 1;
    if (crawl(world, b, 'up') === 'blocked') lift();
    return;
  }
  lift();
};

// Something to eat: the nearest aphid (nearer still if it's on the plant it's on), or with none about, the nearest
// open flower's pollen.
const FOODS = {
  aphids: (world, b) => {
    const here = b.perch?.obj;
    let best = null;
    for (const a of world.aphids) {
      const d = dist(a, b) * (a.obj === here ? 0.5 : 1);
      if (!best || d < best.d) best = { d, a };
    }
    const a = best?.a;
    return a && [{ obj: a.obj, part: a.part, u: a.u, side: a.side }, { kind: 'eat', aphid: a }];
  },
  pollen: (world, b) => {
    const flowers = flowersOf(world);
    if (!flowers.length) return null;
    return [flowers.reduce((a, f) => (dist(frameOf(f).at, b) < dist(frameOf(a).at, b) ? f : a)), { kind: 'pollen' }];
  },
  // Somewhere along a stem of the plant it's on, or of the nearest plant, out of the water.
  sap: (world, b) => {
    const plants = world.objects.filter((o) => o.kind === 'plant' && o.stems.length);
    if (!plants.length) return null;
    const near = (a, o) => (dist(o.base, b) < dist(a.base, b) ? o : a);
    const obj = b.perch?.obj.kind === 'plant' ? b.perch.obj : plants.reduce(near);
    const spot = { obj, part: pick(world.rand, obj.stems), u: 0.2 + 0.6 * world.rand(), side: b.dir };
    const { at } = frameOf(spot);
    return wet(world, at.x, at.y) ? null : [spot, { kind: 'sap' }];
  },
};

// Something to eat, what its kind likes best first: the nearest aphid (nearer still if it's on the plant it's on),
// the nearest open flower's pollen, or sap.
const seekFood = (world, b) => {
  for (const food of DIETS[b.genome.kind]) {
    const found = FOODS[food](world, b);
    if (found) return goTo(b, ...found);
  }
  return null;
};

// A sociable one goes to rest next to another of its kind resting on a plant or stick, so they bunch up.
const huddle = (world, b) => {
  const kin = (c) => c !== b && c.genome.kind === b.genome.kind;
  const resting = world.fliers.filter((c) => kin(c) && c.mode === 'tree' && c.act?.kind === 'rest');
  if (!resting.length) return null;
  const c = pick(world.rand, resting);
  const gap = (flierShape(b.genome).len + 0.5) / frameOf(c.perch).len;
  const u = c.perch.u + (c.perch.u > 0.5 ? -gap : gap);
  return goTo(b, { ...c.perch, u: Math.min(1, Math.max(0, u)) }, { kind: 'rest', ticks: 900 + world.rand() * 1200 });
};

// Now and then it picks something to do, by its nature: find something to eat when it's hungry, huddle up if it's
// sociable, fly off somewhere else if it's a wanderer, bask at the top of whatever it's on if it's a lazy one, or
// groom, or stretch its wings; or else just wander on, sometimes turning back.
const decide = (world, b) => {
  const g = b.genome;
  b.think = 90 + world.rand() * 150;
  if (b.to) return;
  const roll = (p) => world.rand() < p;
  const rest = () => ({ kind: 'rest', ticks: (300 + world.rand() * 900) * (1.5 - g.activity) });
  if (b.hunger > 0.3 && roll(b.hunger + 0.2) && seekFood(world, b)) return;
  if (roll(0.05 + 0.2 * g.sociability) && huddle(world, b)) return;
  if (roll(0.03 + 0.15 * g.wanderlust)) {
    const to = elsewhere(world, b);
    if (to) return goTo(b, to, roll(0.5) ? rest() : null);
  }
  if (roll(0.1 + 0.3 * (1 - g.activity))) {
    if (b.mode !== 'tree') return (b.act = rest());
    let top = b.perch.part; // the highest tip above it
    for (let kids; (kids = kidsOf(b.perch.obj, top)).length; ) top = forkTo(world, kids, 'up');
    return goTo(b, { ...b.perch, part: top, u: 1 }, rest());
  }
  if (roll(0.15)) b.act = { kind: roll(0.7) ? 'groom' : 'stretch', ticks: 60 + world.rand() * 80 };
  else if (roll(0.3)) b.dir = -b.dir;
};

// Doing whatever it's doing where it is, till it's done.
const doAct = (world, b) => {
  const a = b.act;
  if (a.kind === 'eat' && !world.aphids.includes(a.aphid)) a.ticks = 0; // gone from under its nose
  if (a.kind === 'sap') b.hunger = Math.max(0, b.hunger - SAP);
  if (a.kind === 'pollen') {
    b.hunger = Math.max(0, b.hunger - POLLEN);
    const st = b.perch?.part;
    if (!st || st.flower < 1 || st.wilt > 0.3) a.ticks = 0; // the flower closed, or it's going over
  }
  if (--a.ticks > 0) return;
  b.act = null;
  if (a.kind === 'eat' && world.aphids.includes(a.aphid)) {
    world.aphids = world.aphids.filter((x) => x !== a.aphid);
    b.hunger = Math.max(0, b.hunger - BITE);
    b.think = 0; // another?
  } else if (a.kind === 'meet') {
    // The shyer one turns back; the other goes on, round the other side of the stem.
    const other = a.with;
    if (b.genome.boldness < other.genome.boldness) b.dir = -b.dir;
    else if (b.perch) b.perch.side = -b.perch.side;
  } else if (a.kind === 'lift') {
    b.to ??= elsewhere(world, b);
    b.dir = b.to ? Math.sign(frameOf(b.to).at.x - b.x) || b.dir : b.dir;
    airborne(b, true);
    b.vx = b.dir * 0.3;
  }
};

// On a plant, a stick or the ground, getting on with things.
const live = (world, b) => {
  if (b.met > 0) b.met--;
  if (b.act) return doAct(world, b);
  if (--b.think <= 0) decide(world, b);
  if (b.act) return;
  // Gone, or (going for pollen) the flower's closed or going over: think again.
  const over = b.to && b.then?.kind === 'pollen' && (b.to.part.flower < 1 || b.to.part.wilt > 0.2);
  if (b.to && (!there(world, b.to) || over)) Object.assign(b, { to: null, then: null, think: 0 });
  if (b.to) return head(world, b);
  // Wandering: at a tip it turns back, or a wanderer may take off from it.
  if (crawl(world, b) === 'tip') {
    if (world.rand() < 0.2 * b.genome.wanderlust) b.act = { kind: 'lift', ticks: LIFT_TICKS };
    else b.dir = -1;
  }
};

// In the air. Flying, it makes for where it's going the way it's worked out through the air, round any terrain in
// between, bobbing as it goes and pushed about by the breeze, and lands there; if there's no way there, or it's taking
// too long, it makes for somewhere else, and with nowhere to go it flutters down. Falling, it drops, on its back if
// it's playing dead, but about to drop in water it gets its wings out and flies off. Either way it lands on whatever
// floor it comes to. In the water (risen round it, say), it flies straight up out of it, and keeps out of it after.
const air = (world, b) => {
  const g = b.genome;
  if (inTerrain(world, b, b.x, b.y)) {
    // Buried (let go in it, or it came down on top of it): up and out of it.
    Object.assign(b, { y: b.y - 1, vx: 0, vy: 0 });
    return;
  }
  const soaked = wet(world, b.x, b.y);
  const blocked = (px, py) => inTerrain(world, b, px, py) || (b.flying && !soaked && wet(world, px, py));
  if (!b.flying && [1, 3, 5].some((dy) => wet(world, b.x, b.y + dy))) offWater(world, b);
  if (b.flying && b.to && ++b.flown > FLIGHT_TICKS) Object.assign(b, { to: elsewhere(world, b), flown: 0, way: null });
  const to = b.to && there(world, b.to) ? b.to : null;
  if (b.flying) {
    const speed = FLY * (0.7 + 0.6 * g.speed);
    let want = { x: b.dir * 0.2, y: 0.25 };
    if (to) {
      const at = frameOf(to).at;
      if (dist(at, b) < 2) return land(world, b, to);
      if (!b.way || --b.replan <= 0) {
        b.way = wayThrough(world, b, at);
        b.replan = REPLAN_TICKS;
        // No way there: somewhere else, and after a few of those (shut in somewhere), it settles down to walk.
        if (!b.way) Object.assign(b, { to: ++b.lost < 4 ? elsewhere(world, b) : null, replan: 20 });
      }
      want = { x: 0, y: 0 }; // hovering, till it knows the way
      if (b.way) {
        b.way[b.way.length - 1] = at; // the perch sways
        while (b.way.length > 1 && dist(b.way[0], b) < 3) b.way.shift();
        const next = b.way[0];
        const d = dist(next, b) || 1;
        const k = (speed * (b.way.length > 1 ? 1 : Math.min(1, d / 8))) / d; // slowing to land
        want = { x: (next.x - b.x) * k, y: (next.y - b.y) * k };
      }
    }
    if (soaked) want = { x: 0, y: -speed };
    b.vx += (want.x - b.vx) * 0.12 + wind(world, b.x) * 0.006;
    b.vy += (want.y - b.vy) * 0.12 + Math.sin(world.time * 0.25 + b.seed) * 0.03;
  } else {
    b.vy = Math.min(b.vy + GRAVITY, 2);
    b.vx *= 0.98;
  }
  // Move, sliding along the terrain where it bumps into it; flying, it keeps out of the water (and a fountain's spray)
  // the same way.
  const [x, y] = [b.x + b.vx, b.y + b.vy];
  // Nearly there but bumping the terrain, with no room to get its body any nearer: it's there.
  if (blocked(x, y) && to && b.flying && b.way?.length === 1 && dist(frameOf(to).at, b) < 6) return land(world, b, to);
  if (!blocked(x, y)) [b.x, b.y] = [x, y];
  else if (!blocked(b.x, y)) [b.y, b.vx] = [y, -b.vx * 0.5];
  else if (!blocked(x, b.y)) [b.x, b.vy] = [x, -Math.abs(b.vy) * 0.5];
  else [b.vx, b.vy] = [-b.vx * 0.5, -Math.abs(b.vy) * 0.5];
  b.x = Math.min(Math.max(b.x, 2), world.W - 3);
  b.y = Math.min(Math.max(b.y, 3), world.ground.y0);
  if (Math.abs(b.vx) > 0.05) b.dir = Math.sign(b.vx);
  const floor = floorUnder(world, b, b.x, b.y - 1);
  if (b.y >= floor && b.vy >= 0 && !(b.flying && b.to)) {
    Object.assign(b, { mode: b.dead > 0 ? 'back' : 'ground', y: floor, vx: 0, vy: 0, to: b.dead > 0 ? null : b.to });
  }
};

const land = (world, b, to) => {
  Object.assign(b, { mode: 'tree', perch: { ...to }, vx: 0, vy: 0, dir: world.rand() < 0.5 ? -1 : 1 });
  if (to.u >= 1) b.dir = -1; // at a tip, facing back down
  arrive(world, b);
};

// Water's no place for a flier: playing dead or not, it's off somewhere else.
const offWater = (world, b) => {
  Object.assign(b, { dead: 0, to: elsewhere(world, b), then: null });
  airborne(b, true);
};

// Held by the pointer: it hangs there, legs going, flicking its wing cases.
const hold = (world, b) => {
  Object.assign(b, { mode: 'held', perch: null, act: null, to: null, then: null, dead: 0 });
  Object.assign(b, { x: world.pointer.x, y: world.pointer.y + 1, fwd: { x: b.dir, y: 0 }, up: { x: 0, y: -1 } });
  b.stride += 0.4;
  b.wings = Math.sin(world.time * 0.3 + b.seed) > 0.85 ? 0.4 : 0;
};

// Let go: a bold one flies off; the rest drop and play dead.
export const letGo = (world, b) => {
  if (b.genome.boldness > 0.5) {
    b.to = elsewhere(world, b);
    airborne(b, true);
  } else {
    airborne(b, false);
    b.dead = 180 + world.rand() * 300;
  }
};

// Something sudden at (x, y): the fliers near it fly off if they're bold; if not, a shield bug stays put and lets off
// a stink, and the others drop and play dead.
export const startleFliers = (world, x, y, reach = 30) => {
  for (const b of world.fliers) {
    if ((b.mode !== 'tree' && b.mode !== 'ground') || Math.hypot(b.x - x, b.y - y) > reach) continue;
    Object.assign(b, { act: null, then: null });
    if (b.genome.boldness > 0.5) {
      b.to = elsewhere(world, b);
      b.act = { kind: 'lift', ticks: 8 };
    } else if (b.genome.kind === 'shieldbug') {
      b.act = { kind: 'stink', ticks: 120 };
    } else {
      airborne(b, false);
      b.dead = 200 + world.rand() * 300;
    }
  }
};

// Which way it faces and which way is up from its feet, and where its feet are on a tree, for drawing.
const pose = (b) => {
  if (b.mode === 'tree') {
    const { d, n, at } = frameOf(b.perch);
    Object.assign(b, { x: at.x, y: at.y, fwd: { x: d.x * b.dir, y: d.y * b.dir }, up: n });
  } else {
    const upside = b.mode === 'back' || (b.mode === 'air' && b.dead > 0);
    Object.assign(b, { fwd: { x: b.dir, y: 0 }, up: { x: 0, y: upside ? 1 : -1 } });
  }
  let open = 0;
  if (b.mode === 'air' && b.flying) open = 1;
  else if (b.act?.kind === 'lift') open = 1 - b.act.ticks / LIFT_TICKS;
  else if (b.act?.kind === 'stretch') open = 0.35 * Math.sin((Math.PI * b.act.ticks) / 60) ** 2;
  b.wings += (open - b.wings) * 0.25;
};

// A tick for the aphids and every flier.
export const stepFliers = (world) => {
  stepAphids(world);
  for (const b of world.fliers) {
    b.hunger = Math.min(1, b.hunger + HUNGER * (0.6 + 0.8 * b.genome.appetite));
    if (world.held?.flier === b) {
      hold(world, b);
      continue;
    }
    if (b.mode === 'held') airborne(b, false); // let go some other way: it drops
    if (b.mode === 'tree' && !there(world, b.perch)) airborne(b, false); // what it was on is gone
    if ((b.mode === 'tree' || b.mode === 'ground' || b.mode === 'back') && wet(world, b.x, b.y - 1)) {
      offWater(world, b);
    }
    if ((b.mode === 'ground' || b.mode === 'back') && solid(world, b.x, b.y - 2)) airborne(b, true); // buried: out
    if (b.mode === 'tree' || b.mode === 'ground') live(world, b);
    else if (b.mode === 'air') air(world, b);
    else if (b.mode === 'back' && --b.dead <= 0) Object.assign(b, { mode: 'ground', think: 0 }); // rights itself
    pose(b);
  }
};
