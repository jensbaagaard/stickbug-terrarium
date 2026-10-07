// Stickbug terrarium simulation: world, branches, bugs and their behaviour.
// Everything here is pure data + functions; rendering lives in render.js.

// Tunable body shape. Mutated live by the tuning panel.
export const params = {
  seg: 5,
  thigh: 5,
  kneeDrop: 2,
  shin: 5,
  leg: 9,
  antenna: 14,
  front: 0.4,
  mid: -0.4,
  hind: -0.6,
  spacing: 2.1,
  size: 1.5,
  legLength: 1.25,
  thickness: 1.3,
};

export const SEGMENTS = 7; // body points, index 0 is the head
export const MID = (SEGMENTS - 1) / 2;
const GRAVITY = 0.15;
const GRAB_RADIUS = 16;
const JUNCTION_DIST = 6; // surfaces closer than this connect
const FLOOR_SLOPE = 1.2; // branches flatter than this catch falling bugs
const MAX_BUGS = 8;
const MIN_BRANCH = 8;
const WALK_SPEED = 0.25;
const TURN_TICKS = 36;
const TRANSFER_TICKS = 45;
const HUNGER_RATE = 1 / 2700;
const HUNGRY_AT = 0.5;
const BITE = 0.003;
const LEAF_GROWTH = 1 / 1200;
const LEAF_SPAWN_CHANCE = 1 / 360;
const LEAF_SPACING = 16;
const DANCE_COOLDOWN = 1500;
const DOUBLE_TAP_TICKS = 20;

// ---------- math helpers ----------

export const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const smoothstep = (t) => t * t * (3 - 2 * t);

// A segment / surface is {x0, y0, x1, y1}.
export const segLength = (g) => Math.hypot(g.x1 - g.x0, g.y1 - g.y0) || 1;
export const segDir = (g) => {
  const l = segLength(g);
  return { x: (g.x1 - g.x0) / l, y: (g.y1 - g.y0) / l };
};
// Normal pointing "up" off the surface (for left-to-right segments).
export const segNormal = (g) => {
  const d = segDir(g);
  return { x: d.y, y: -d.x };
};
export const pointAt = (g, s) => {
  const d = segDir(g);
  return { x: g.x0 + d.x * s, y: g.y0 + d.y * s };
};
// Arc-length position of the closest point on g to (x, y).
export const project = (g, x, y) => {
  const d = segDir(g);
  return clamp((x - g.x0) * d.x + (y - g.y0) * d.y, 0, segLength(g));
};
const distToSeg = (g, x, y) => {
  const p = pointAt(g, project(g, x, y));
  return Math.hypot(x - p.x, y - p.y);
};

// ---------- body geometry ----------

export const standHeight = () => (params.leg + params.kneeDrop) * params.size * params.legLength;
export const bodySegLen = () => params.seg * params.size;

// Keep a bug's centre far enough from the ends that its body fits.
const clampS = (surf, s) => {
  const len = segLength(surf);
  const half = MID * bodySegLen();
  return len < 2 * half ? len / 2 : clamp(s, half, len - half);
};

const maxLeaves = (br) => Math.floor(segLength(br) / LEAF_SPACING);

// Target body points for a bug standing on surf at s, facing dir.
const bodyPose = (surf, s, dir, squash) => {
  const d = segDir(surf);
  const n = segNormal(surf);
  const h = standHeight();
  const step = bodySegLen() * squash;
  return Array.from({ length: SEGMENTS }, (_, i) => {
    const along = s + dir * (MID - i) * step;
    return { x: surf.x0 + d.x * along + n.x * h, y: surf.y0 + d.y * along + n.y * h };
  });
};

// ---------- surfaces ----------

const isFloorLike = (br) => Math.abs(br.y1 - br.y0) <= Math.abs(br.x1 - br.x0) * FLOOR_SLOPE;
const yAt = (br, x) => br.y0 + ((br.y1 - br.y0) * (x - br.x0)) / (br.x1 - br.x0 || 1);

// Highest floor-like surface at x that is at or below y.
export const floorBelow = (world, x, y) => {
  let best = { y: world.ground.y0, g: world.ground };
  for (const br of world.branches) {
    if (!isFloorLike(br) || x < br.x0 || x > br.x1) continue;
    const by = yAt(br, x);
    if (by >= y && by < best.y) best = { y: by, g: br };
  }
  return best;
};

const cross = (ax, ay, bx, by) => ax * by - ay * bx;

// Closest approach between two segments: arc positions on each and the gap.
const closestApproach = (a, b) => {
  const ax = a.x1 - a.x0, ay = a.y1 - a.y0;
  const bx = b.x1 - b.x0, by = b.y1 - b.y0;
  const den = cross(ax, ay, bx, by);
  if (Math.abs(den) > 1e-9) {
    const ta = cross(b.x0 - a.x0, b.y0 - a.y0, bx, by) / den;
    const tb = cross(b.x0 - a.x0, b.y0 - a.y0, ax, ay) / den;
    if (ta >= 0 && ta <= 1 && tb >= 0 && tb <= 1) {
      return { sa: ta * segLength(a), sb: tb * segLength(b), d: 0 };
    }
  }
  let best = { sa: 0, sb: 0, d: Infinity };
  for (const [from, onto, swapped] of [[a, b, false], [b, a, true]]) {
    for (const [x, y] of [[from.x0, from.y0], [from.x1, from.y1]]) {
      const sOnto = project(onto, x, y);
      const sFrom = project(from, x, y);
      const p = pointAt(onto, sOnto);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < best.d) {
        best = swapped ? { sa: sOnto, sb: sFrom, d } : { sa: sFrom, sb: sOnto, d };
      }
    }
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

// ---------- bugs ----------

const setState = (bug, state, timer) => {
  bug.state = state;
  bug.timer = timer;
};

const newBug = (world, x, y) => ({
  pts: Array.from({ length: SEGMENTS }, (_, i) => {
    const px = x + (i - MID) * bodySegLen();
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
  transfer: null,
  partner: null,
  cooldown: 0,
  gait: 0,
  rest: 0,
  seed: world.rand() * 1000,
});

const land = (world, bug, surf, s, facing) => {
  Object.assign(bug, {
    surf,
    s: clampS(surf, s),
    dir: facing < 0 ? -1 : 1,
    squash: 1,
    rest: 0,
    goal: null,
    route: [],
    transfer: null,
  });
  setState(bug, 'idle', 30 + world.rand() * 90);
};

const detach = (bug, state) => {
  if (bug.partner) bug.partner.partner = null;
  Object.assign(bug, { surf: null, partner: null, goal: null, route: [], transfer: null, squash: 1, rest: 0 });
  setState(bug, state, 0);
};

const addBug = (world, x, y) => {
  if (world.bugs.length >= MAX_BUGS) return null;
  const bug = newBug(world, x, y);
  world.bugs.push(bug);
  return bug;
};

const placeBug = (world, surf, s, facing) => {
  const bug = newBug(world, 0, 0);
  land(world, bug, surf, s, facing);
  bodyPose(surf, bug.s, bug.dir, 1).forEach((p, i) =>
    Object.assign(bug.pts[i], { x: p.x, y: p.y, px: p.x, py: p.y }),
  );
  world.bugs.push(bug);
  return bug;
};

// ---------- branches ----------

const addBranch = (world, seg) => {
  let { x0, y0, x1, y1 } = seg;
  if (x1 < x0) [x0, y0, x1, y1] = [x1, y1, x0, y0];
  const floor = world.ground.y0;
  const br = {
    x0: clamp(x0, 0, world.W - 1),
    y0: Math.min(y0, floor),
    x1: clamp(x1, 0, world.W - 1),
    y1: Math.min(y1, floor),
    leaves: [],
  };
  if (Math.hypot(br.x1 - br.x0, br.y1 - br.y0) < MIN_BRANCH) return null;
  world.branches.push(br);
  rebuildJunctions(world);
  return br;
};

const removeBranch = (world, br) => {
  world.branches.splice(world.branches.indexOf(br), 1);
  rebuildJunctions(world);
  for (const bug of world.bugs) {
    if (bug.surf === br || bug.transfer?.from === br) {
      detach(bug, 'fall');
    } else if (bug.goal && (bug.goal.surf === br || bug.route.some((h) => h.to === br))) {
      bug.goal = null;
      bug.route = [];
      if (bug.state === 'walk' || bug.state === 'eat') setState(bug, 'idle', 30);
    }
  }
};

// ---------- world ----------

export const createWorld = (W, H, { seed = Date.now(), scene = true } = {}) => {
  const world = {
    W,
    H,
    ground: { x0: 0, y0: H - 6, x1: W - 1, y1: H - 6 },
    branches: [],
    bugs: [],
    junctions: [],
    time: 0,
    rand: mulberry32(seed),
    held: null,
    pointer: { x: 0, y: 0 },
    draft: null,
    lastTap: null,
  };
  if (scene) seedScene(world);
  return world;
};

const seedScene = (world) => {
  const { W, H } = world;
  const along = (br, t) => ({ x: br.x0 + (br.x1 - br.x0) * t, y: br.y0 + (br.y1 - br.y0) * t });
  const trunk = addBranch(world, { x0: W * 0.1, y0: world.ground.y0, x1: W * 0.48, y1: H * 0.5 });
  const fork = along(trunk, 0.8);
  const limb = addBranch(world, { x0: fork.x, y0: fork.y, x1: W * 0.93, y1: H * 0.4 });
  const tip = along(limb, 0.55);
  addBranch(world, { x0: W * 0.22, y0: H * 0.2, x1: tip.x, y1: tip.y });
  for (const br of world.branches) {
    for (let i = 0; i < maxLeaves(br) / 2; i++) {
      br.leaves.push({
        t: 0.1 + 0.8 * world.rand(),
        size: 0.6 + 0.4 * world.rand(),
        lean: world.rand() < 0.5 ? -1 : 1,
      });
    }
  }
  placeBug(world, world.ground, W * 0.72, -1);
  placeBug(world, limb, segLength(limb) * 0.6, 1);
};

export const resizeWorld = (world, W, H) => {
  world.W = W;
  world.H = H;
  Object.assign(world.ground, { x0: 0, y0: H - 6, x1: W - 1, y1: H - 6 });
  rebuildJunctions(world);
  for (const bug of world.bugs) if (bug.surf) bug.s = clampS(bug.surf, bug.s);
};

// ---------- input ----------

export const pointerDown = (world, x, y) => {
  world.pointer = { x, y };
  let best = GRAB_RADIUS ** 2;
  let hit = null;
  for (const bug of world.bugs) {
    for (let i = 0; i < SEGMENTS; i++) {
      const d2 = (bug.pts[i].x - x) ** 2 + (bug.pts[i].y - y) ** 2;
      if (d2 < best) [best, hit] = [d2, { bug, i }];
    }
  }
  if (hit) {
    detach(hit.bug, 'held');
    world.held = hit;
  } else {
    world.draft = { x0: x, y0: y, x1: x, y1: y };
  }
};

export const pointerMove = (world, x, y) => {
  world.pointer = { x, y };
  if (world.draft) Object.assign(world.draft, { x1: x, y1: y });
};

export const pointerUp = (world, x, y) => {
  pointerMove(world, x, y);
  if (world.held) setState(world.held.bug, 'fall', 0);
  world.held = null;
  const draft = world.draft;
  world.draft = null;
  if (!draft) return;
  if (Math.hypot(draft.x1 - draft.x0, draft.y1 - draft.y0) >= MIN_BRANCH) addBranch(world, draft);
  else tap(world, x, y);
};

export const pointerCancel = (world) => {
  if (world.held) setState(world.held.bug, 'fall', 0);
  world.held = null;
  world.draft = null;
};

// Tap a branch to remove it; double-tap empty space to add a bug.
const tap = (world, x, y) => {
  const br = world.branches.find((b) => distToSeg(b, x, y) < 5);
  if (br) return removeBranch(world, br);
  const last = world.lastTap;
  if (last && world.time - last.time < DOUBLE_TAP_TICKS && Math.hypot(last.x - x, last.y - y) < 12) {
    world.lastTap = null;
    addBug(world, x, y);
  } else {
    world.lastTap = { x, y, time: world.time };
  }
};

// ---------- simulation step ----------

export const step = (world) => {
  world.time++;
  growLeaves(world);
  for (const bug of world.bugs) {
    bug.hunger = Math.min(1, bug.hunger + HUNGER_RATE);
    bug.cooldown = Math.max(0, bug.cooldown - 1);
    if (bug.surf) {
      think(world, bug);
      followSurface(bug);
    } else {
      simulateLoose(world, bug);
    }
  }
  matchDancers(world);
};

const growLeaves = (world) => {
  for (const br of world.branches) {
    for (const leaf of br.leaves) leaf.size = Math.min(1, leaf.size + LEAF_GROWTH);
    if (br.leaves.length < maxLeaves(br) && world.rand() < LEAF_SPAWN_CHANCE) {
      br.leaves.push({ t: 0.1 + 0.8 * world.rand(), size: 0, lean: world.rand() < 0.5 ? -1 : 1 });
    }
  }
};

// Ease body points toward their pose on the surface (blending across a transfer).
const followSurface = (bug) => {
  let target = bodyPose(bug.surf, bug.s, bug.dir, bug.squash);
  const tr = bug.transfer;
  if (tr) {
    const from = bodyPose(tr.from, tr.s, tr.dir, 1);
    target = target.map((p, i) => {
      const k = smoothstep(clamp(tr.u * 2 - i / (SEGMENTS - 1), 0, 1));
      return { x: from[i].x + (p.x - from[i].x) * k, y: from[i].y + (p.y - from[i].y) * k };
    });
    tr.u += 1 / TRANSFER_TICKS;
    if (tr.u >= 1) bug.transfer = null;
  }
  bug.pts.forEach((p, i) => {
    p.x += (target[i].x - p.x) * 0.3;
    p.y += (target[i].y - p.y) * 0.3;
    p.px = p.x;
    p.py = p.y;
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
  if (isHeld) bug.gait += 0.6;
  for (const p of bug.pts) {
    const vx = (p.x - p.px) * 0.99;
    const vy = (p.y - p.py) * 0.99;
    p.px = p.x;
    p.py = p.y;
    p.x += vx;
    p.y += vy + GRAVITY;
  }
  const h = standHeight();
  const len = bodySegLen();
  let landed = null;
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
        if (i === MID) landed = floor.g;
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

const startTurn = (bug, dir, next, nextTimer) => {
  bug.turnTo = dir;
  bug.next = next;
  bug.nextTimer = nextTimer;
  setState(bug, 'turn', TURN_TICKS);
};

const think = (world, bug) => {
  if (bug.transfer) return;
  bug.timer--;
  switch (bug.state) {
    case 'turn': {
      const t = 1 - bug.timer / TURN_TICKS;
      bug.squash = 0.2 + 0.8 * Math.abs(Math.cos(Math.PI * t));
      if (t >= 0.5) bug.dir = bug.turnTo;
      if (bug.timer <= 0) {
        bug.squash = 1;
        setState(bug, bug.next, bug.nextTimer);
      }
      return;
    }
    case 'idle':
      if (bug.timer <= 0) decide(world, bug);
      return;
    case 'dance':
      if (bug.partner && bug.partner.partner !== bug) bug.partner = null;
      if (bug.timer <= 0) {
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
  bug.goal = null;
  bug.route = [];
  if (bug.hunger > HUNGRY_AT && seekFood(world, bug)) return;
  const r = world.rand();
  if (r < 0.15) return setState(bug, 'dance', 180 + world.rand() * 180);
  if (r < 0.4) return setState(bug, 'idle', 90 + world.rand() * 240);
  const reachable = surfaces(world).filter((s) => findRoute(world, bug.surf, s));
  const surf = reachable[Math.floor(world.rand() * reachable.length)];
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
  let best = null;
  for (const br of world.branches) {
    if (!findRoute(world, bug.surf, br)) continue;
    for (const leaf of br.leaves) {
      if (leaf.size < 0.4) continue;
      const p = pointAt(br, leaf.t * segLength(br));
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (!best || d < best.d) best = { br, leaf, d };
    }
  }
  return best ? goTo(world, bug, best.br, best.leaf.t * segLength(best.br), best.leaf) : false;
};

// Where to stand so the head reaches s, preferring not to turn around.
const eatingSpot = (bug, s) => {
  const reach = MID * bodySegLen();
  const behind = s - bug.dir * reach;
  return (behind - bug.s) * bug.dir >= -WALK_SPEED ? behind : s + bug.dir * reach;
};

const walk = (world, bug) => {
  const surf = bug.surf;
  const goal = bug.goal;
  if (!goal) return setState(bug, 'idle', 30);
  const hop = bug.route[0];
  const target = clampS(surf, hop ? hop.sFrom : goal.leaf ? eatingSpot(bug, goal.s) : goal.s);
  const delta = target - bug.s;
  if (Math.abs(delta) > WALK_SPEED) {
    const dir = Math.sign(delta);
    if (dir !== bug.dir) return startTurn(bug, dir, 'walk', 0);
    bug.s += dir * WALK_SPEED;
    bug.gait += WALK_SPEED;
    return;
  }
  bug.s = target;
  if (!hop) return goal.leaf ? setState(bug, 'eat', 0) : setState(bug, 'idle', 60 + world.rand() * 180);
  // Cross a junction onto the next surface.
  bug.route.shift();
  const sTo = clampS(hop.to, hop.sTo);
  const next = bug.route[0] ? bug.route[0].sFrom : goal.s;
  bug.transfer = { from: surf, s: bug.s, dir: bug.dir, u: 0 };
  bug.surf = hop.to;
  bug.s = sTo;
  bug.dir = Math.sign(next - sTo) || bug.dir;
};

const eat = (world, bug) => {
  const leaf = bug.goal?.leaf;
  const br = bug.goal?.surf;
  if (!leaf || !br?.leaves.includes(leaf)) return setState(bug, 'idle', 30);
  leaf.size -= BITE;
  bug.hunger = Math.max(0, bug.hunger - BITE * 1.5);
  if (leaf.size <= 0.05) br.leaves.splice(br.leaves.indexOf(leaf), 1);
  if (leaf.size <= 0.05 || bug.hunger <= 0.02) setState(bug, 'idle', 60 + world.rand() * 60);
};

const canDance = (bug) =>
  bug.surf &&
  !bug.transfer &&
  bug.cooldown === 0 &&
  (bug.state === 'idle' || bug.state === 'walk' || (bug.state === 'dance' && !bug.partner));

// Two free bugs close together on the same surface turn to face each other and dance.
const matchDancers = (world) => {
  const range = (SEGMENTS - 1) * bodySegLen() * 1.3;
  for (const a of world.bugs) {
    for (const b of world.bugs) {
      if (a === b || !canDance(a) || !canDance(b) || a.surf !== b.surf || Math.abs(a.s - b.s) > range) continue;
      const dur = 300 + world.rand() * 120;
      for (const [me, other] of [[a, b], [b, a]]) {
        me.partner = other;
        me.goal = null;
        me.route = [];
        me.cooldown = dur + DANCE_COOLDOWN;
        const face = Math.sign(other.s - me.s) || 1;
        if (face !== me.dir) startTurn(me, face, 'dance', dur);
        else setState(me, 'dance', dur);
      }
    }
  }
};
