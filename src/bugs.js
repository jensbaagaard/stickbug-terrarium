// Stick insects: their bodies (a chain of points sprung toward a pose along the surface they're on) and their
// tripod-stepping feet planted in the world; walking, rounding corners, falling, swimming and being carried; and how
// they behave: wandering, seeking food and eating, dancing together, and their quirks. Pure data + functions.
import { params } from './tuning.js';
import { randomGenes, randomName, traitsOf } from './genome.js';
import {
  bodySegLen,
  FOOT_CLEAR,
  idealFoot,
  legLayout,
  MID,
  sampleBody,
  SEGMENTS,
  standHeight,
  strideLen,
} from './anatomy.js';
import { add, clamp, dist, dot, lerp, pointAt, project, segDir, segLength, segNormal, smoothstep } from './geom.js';
import { CELL } from './terrain.js';
import { wet } from './fish.js';
import { findRoute, floorBelow, JUNCTION_DIST, reachable, replan } from './surfaces.js';
import { solidAt, wetAt } from './objects.js';
import { dropCrumbs } from './effects.js';

const ARRIVE = 0.5; // close enough to a walk target to stop stepping
export const HUNGER_RATE = 1 / 2700;
const QUIRKS = [
  ['wave', 0.4],
  ['twig', 0.33],
  ['groom', 0.27],
];

// ---------- bodies and feet ----------

// Keep a bug's centre far enough from the ends that its body fits.
export const clampS = (surf, s, t) => {
  const len = segLength(surf);
  const half = MID * bodySegLen(t);
  return len < 2 * half ? len / 2 : clamp(s, half, len - half);
};

// Target body points for a bug standing on surf at s, facing dir, lifted off it by lift.
export const bodyPose = (surf, s, dir, squash, t, lift = 0) => {
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

export const resetLegs = (bug) => {
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

export const newBug = (world, x, y, genes = randomGenes(world.rand, params.variety)) => {
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

export const setState = (bug, state, timer) => {
  bug.state = state;
  bug.timer = timer;
  if (state !== 'walk' && bug.step) {
    // An interrupted step stops the body; feet already in the air still land.
    bug.feet[1 - bug.step.stance] = bug.step.len - bug.step.from;
    bug.step = null;
  }
};

export const land = (world, bug, surf, s, facing) => {
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

export const detach = (bug, state) => {
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

export const addBug = (world, x, y, genes, name) => {
  if (world.bugs.length >= params.maxBugs) return null;
  const bug = newBug(world, x, y, genes);
  if (name) bug.name = name;
  world.bugs.push(bug);
  return bug;
};

export const placeBug = (world, surf, s, facing, genes) => {
  const bug = newBug(world, 0, 0, genes);
  land(world, bug, surf, s, facing);
  bodyPose(surf, bug.s, bug.dir, 1, bug.t).forEach((p, i) =>
    Object.assign(bug.pts[i], { x: p.x, y: p.y, px: p.x, py: p.y }),
  );
  world.bugs.push(bug);
  return bug;
};

// Spring the body toward its pose and move the feet. Turns are little hops, and steps bob the body but not
// the feet.
export const followSurface = (world, bug) => {
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
export const standingAt = (surf, s, t) => add(pointAt(surf, s), segNormal(surf), standHeight(t));

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
export const simulateLoose = (world, bug) => {
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

// Each tick every bug: its traits worked out afresh (the sliders may have moved), getting hungrier, its moods easing
// toward what it's doing, then thinking and moving: along its surface, or loose (falling, swimming, held). Then any
// two dancing near each other fall into step.
export const stepBugs = (world) => {
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
    const wading = bug.surf && wetAt(world.terrain, standingAt(bug.surf, bug.s, bug.t));
    if (wading) detach(bug, 'swim'); // in over its back: it floats
    if (bug.surf) think(world, bug);
    if (bug.surf) followSurface(world, bug);
    else simulateLoose(world, bug);
  }
  matchDancers(world);
};

// ---------- behaviour ----------

const startTurn = (bug, dir, next, nextTimer) => {
  bug.turnTo = dir;
  bug.next = next;
  bug.nextTimer = nextTimer;
  setState(bug, 'turn', bug.t.turnTicks);
};

export const think = (world, bug) => {
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
export const matchDancers = (world) => {
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
