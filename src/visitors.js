// Visitors: small bugs that come and go on their own when the tank has what they're after: dragonflies to still water,
// bees to open flowers, and gnats dancing over the plants. How many come goes with how green the tank is and how much
// of it is air (see life.js's room). They draw on the tank's life's own random numbers, and none of them is saved:
// they come back on their own. Pure data + functions, like the rest of the simulation.
import { dist, pick } from './geom.js';
import { CELL, cellAt, EMPTY, WATER } from './terrain.js';
import { ripple, room, wind } from './life.js';
import { flowersOf, wayThrough } from './fliers.js';
import { params } from './tuning.js';

const ARRIVE_TICKS = 300; // how often a visitor might turn up
const POND_TICKS = 120; // how often the water is looked over for still ponds
const MIN_POND = 30; // px across open water must be to count as a pond
const STILL = 0.85; // share of a pond's surface that mustn't have moved since the last look, for it to be still
const REPLAN_TICKS = 60;
const LOST_TICKS = 300; // no pond for a dragonfly this long (not just a level bobbing a moment), it leaves early


// ---------- still water ----------

const looks = new WeakMap(); // by world: the ponds when the water was last looked over, and its surface then

// The tank's ponds: stretches of open water surface at least MIN_POND px across, {x0, x1, y: the water's top}, each
// still if at least STILL of its surface hasn't moved since the last look, so a splash where a fountain or a trickle
// comes in doesn't count, but a pond filling or draining does.
const pondsOf = (world) => {
  const known = looks.get(world);
  if (known && world.time - known.at < POND_TICKS) return known.ponds;
  const { cols, rows, cells, top } = world.terrain;
  const surface = new Set();
  const ponds = [];
  for (let r = 1; r < rows; r++) {
    for (let c = 0, start = -1; c <= cols; c++) {
      const i = r * cols + c;
      if (c < cols && cells[i] === WATER && cells[i - cols] === EMPTY) {
        surface.add(i);
        if (start < 0) start = c;
      } else if (start >= 0) {
        if ((c - start) * CELL >= MIN_POND) {
          let kept = 0;
          for (let k = start; k < c; k++) kept += known?.surface.has(r * cols + k) ? 1 : 0;
          ponds.push({ x0: start * CELL, x1: c * CELL, y: top + r * CELL, still: kept >= (c - start) * STILL });
        }
        start = -1;
      }
    }
  }
  looks.set(world, { at: world.time, ponds, surface });
  return ponds;
};

// The pond v came to as it is now (still or not: that only matters for coming to it), or if a splash has broken it
// up, the piece of it nearest v; null if it's gone.
const pondNow = (world, v) => {
  const was = v.pond;
  const near = (p) => Math.max(p.x0 - v.x, v.x - p.x1, 0);
  const same = (p) => Math.abs(p.y - was.y) <= 2 * CELL && p.x0 < was.x1 + 20 && was.x0 - 20 < p.x1;
  const pieces = pondsOf(world).filter(same);
  return pieces.reduce((a, p) => (!a || near(p) < near(a) ? p : a), null);
};

// ---------- getting about ----------

// Fly v toward p at up to speed, by the way through the air round the terrain (worked out again now and then, or
// after v.way is cleared for somewhere new), turning as sharply as turn lets it. True once it's there.
const flyTo = (world, v, p, speed, turn = 0.15) => {
  if (!v.way || --v.replan <= 0) Object.assign(v, { way: wayThrough(world, v, p) ?? [p], replan: REPLAN_TICKS });
  v.way[v.way.length - 1] = p; // it may be moving
  while (v.way.length > 1 && dist(v.way[0], v) < 3) v.way.shift();
  const next = v.way[0];
  const d = dist(next, v) || 1;
  const k = (speed * (v.way.length > 1 ? 1 : Math.min(1, d / 6))) / d; // slowing as it gets there
  v.vx += ((next.x - v.x) * k - v.vx) * turn;
  v.vy += ((next.y - v.y) * k - v.vy) * turn;
  [v.x, v.y] = [v.x + v.vx, v.y + v.vy];
  if (Math.abs(v.vx) > 0.05) v.dir = Math.sign(v.vx);
  return v.way.length === 1 && dist(p, v) < 1.5;
};

// Make for somewhere new, `to`, in `state`.
const head = (v, state, to) => Object.assign(v, { state, to, way: null });

// Off out of the top of the tank (or the side it's nearest, for a bee), and gone once it's out.
const leave = (world, v, speed) => {
  if (v.state !== 'leave') {
    const out = v.kind === 'bee' ? { x: v.x < world.W / 2 ? -6 : world.W + 6, y: v.y - 20 } : { x: v.x, y: -8 };
    head(v, 'leave', out);
  }
  if (v.kind === 'bee') flyTo(world, v, bumble(world, v, v.to), speed, 0.08);
  else flyTo(world, v, v.to, speed);
  return v.y > -6 && v.x > -4 && v.x < world.W + 4;
};

// ---------- dragonflies ----------

const DRAGON_COLORS = [
  { h: 200, s: 75, l: 55 }, // blue
  { h: 5, s: 75, l: 50 }, // red
  { h: 140, s: 55, l: 45 }, // green
  { h: 45, s: 75, l: 52 }, // gold
];

// Somewhere to hover over the pond: over the water, a little way up.
const overPond = (world, pond) => ({
  x: pond.x0 + 4 + world.lifeRand() * (pond.x1 - pond.x0 - 8),
  y: pond.y - 6 - world.lifeRand() * 20,
});

// A stem tip by the pond to rest on, out of the water, if there is one.
const perchBy = (world, pond) => {
  const tips = world.objects
    .filter((o) => o.kind === 'plant')
    .flatMap((o) => o.stems.map((part) => ({ obj: o, part })))
    .filter(({ part: { tip } }) => tip.x > pond.x0 - 20 && tip.x < pond.x1 + 20 && tip.y < pond.y - 2);
  return tips.length ? pick(world.lifeRand, tips) : null;
};

const newDragonfly = (world, pond) => {
  const r = world.lifeRand;
  const v = { kind: 'dragonfly', x: pond.x0 + r() * (pond.x1 - pond.x0), y: -6, vx: 0, vy: 0, dir: 1, pond };
  Object.assign(v, { color: pick(r, DRAGON_COLORS), seed: r() * 100, ticks: 0, gone: 0 });
  Object.assign(v, { age: 0, life: 5400 + r() * 7200 }); // a few minutes
  return head(v, 'dart', overPond(world, pond));
};

const stepDragonfly = (world, v) => {
  const r = world.lifeRand;
  const near = (p) => Math.abs((p.x0 + p.x1) / 2 - v.x) + Math.abs(p.y - v.y);
  const now = pondNow(world, v) ?? pondsOf(world).reduce((a, p) => (!a || near(p) < near(a) ? p : a), null);
  v.gone = now ? 0 : v.gone + 1;
  if (++v.age > v.life || v.gone > LOST_TICKS || v.state === 'leave') return leave(world, v, 0.8);
  const pond = (v.pond = now ?? v.pond);
  if (v.state === 'dart' && flyTo(world, v, v.to, 0.8, 0.15)) {
    Object.assign(v, { state: 'hover', ticks: 40 + r() * 120 });
  } else if (v.state === 'hover') {
    // Hanging in the air, just about still; then off to another spot, down to dip the water, or to a stem to rest.
    [v.vx, v.vy] = [0, 0];
    v.y += Math.sin(world.time * 0.2 + v.seed) * 0.04;
    if (--v.ticks > 0) return true;
    const roll = r();
    const perch = roll > 0.8 && perchBy(world, pond);
    if (perch) head(v, 'toPerch', perch);
    else if (roll < 0.2) head(v, 'dip', { x: v.x + (r() - 0.5) * 20, y: pond.y - 1 });
    else head(v, 'dart', overPond(world, pond));
  } else if (v.state === 'dip' && flyTo(world, v, v.to, 0.6, 0.15)) {
    ripple(world, v.x, pond.y + 1); // touches the water
    head(v, 'dart', overPond(world, pond));
  } else if (v.state === 'toPerch' || v.state === 'perch') {
    const stem = v.to.part;
    const gone = !world.objects.includes(v.to.obj) || !v.to.obj.stems.includes(stem); // pruned, or the plant taken out
    if (gone) return !!head(v, 'dart', overPond(world, pond));
    const at = { x: stem.tip.x, y: stem.tip.y - 1 };
    if (v.state === 'toPerch' && flyTo(world, v, at, 0.6, 0.15)) {
      Object.assign(v, { state: 'perch', ticks: 300 + r() * 600 });
    }
    if (v.state === 'perch') {
      Object.assign(v, at, { vx: 0, vy: 0 });
      if (--v.ticks <= 0) head(v, 'dart', overPond(world, pond));
    }
  }
  return true;
};

// ---------- bees ----------

// A bumblebee's way of getting anywhere: in lazy loops either side of the way, tightening as it gets near so it
// bumbles in and settles, weaving and bobbing as it goes. Where to make for now.
const bumble = (world, v, p) => {
  const loop = Math.min(18, dist(p, v) / 2);
  const t = world.time * 0.05 + v.seed;
  v.x += Math.cos(t * 2.4) * 0.3; // weaving a couple of px side to side, and bobbing gently up and down
  v.y += Math.sin(t * 2.8) * 0.2;
  return { x: p.x + Math.cos(t) * loop, y: p.y + Math.sin(t * 1.7) * loop * 0.7 };
};

const newBee = (world) => {
  const r = world.lifeRand;
  const x = r() < 0.5 ? -4 : world.W + 4;
  const v = { kind: 'bee', x, y: 20 + r() * world.H * 0.4, vx: 0, vy: 0, dir: x < 0 ? 1 : -1, seed: r() * 100 };
  return Object.assign(v, { visits: 2 + Math.floor(r() * 4), pollen: 0, last: null, ticks: 0, state: 'fly', to: null });
};

// One open flower after another (not the one it's just been to), sitting a while on each and packing its legs with
// pollen, then off out of the tank.
const stepBee = (world, v) => {
  const r = world.lifeRand;
  if (v.state === 'leave') return leave(world, v, 0.5);
  const open = (f) =>
    f.part.flower >= 1 && !(f.part.wilt > 0.2) && world.objects.includes(f.obj) && f.obj.stems.includes(f.part);
  if (!v.to || !open(v.to)) {
    const flowers = flowersOf(world).filter((f) => f.part !== v.last);
    if (!flowers.length || v.visits <= 0) return leave(world, v, 0.5);
    head(v, 'fly', pick(r, flowers));
  }
  const at = { x: v.to.part.tip.x, y: v.to.part.tip.y - 1 };
  if (v.state === 'fly') {
    flyTo(world, v, bumble(world, v, at), 0.45, 0.08);
    if (dist(at, v) < 1.5) Object.assign(v, { state: 'sit', ticks: 90 + r() * 90 });
  }
  if (v.state === 'sit') {
    Object.assign(v, at, { vx: 0, vy: 0 });
    v.pollen = Math.min(1, v.pollen + 1 / 250);
    if (--v.ticks <= 0) {
      Object.assign(v, { visits: v.visits - 1, last: v.to.part, to: null });
      v.state = 'fly';
    }
  }
  return true;
};

// ---------- gnats ----------

const newGnats = (world, at) => {
  const r = world.lifeRand;
  const v = { kind: 'gnats', x: at.x, y: at.y, n: 5 + Math.floor(r() * 5), seed: r() * 100 };
  return Object.assign(v, { age: 0, life: 5400 + r() * 7200, spread: 1 });
};

// The cloud drifts a little on the breeze, and comes back together after it's been scattered; the gnats in it dance
// about its middle (draw/life.js works out where each one is).
const stepGnats = (world, v) => {
  const drift = wind(world, v.x) * 0.02 + Math.sin(world.time * 0.01 + v.seed) * 0.03;
  v.x = Math.min(Math.max(v.x + drift, 6), world.W - 7);
  v.spread += (1 - v.spread) * 0.02;
  return ++v.age < v.life;
};

// ---------- arriving ----------

const STEPS = { dragonfly: stepDragonfly, bee: stepBee, gnats: stepGnats };

// Now and then, one turns up: a dragonfly to a still pond, a bee (rarely) to a tank with a few open flowers, gnats over
// a plant; never more of each than the tank has room for.
const arrive = (world) => {
  const r = world.lifeRand;
  const count = (kind) => world.visitors.filter((v) => v.kind === kind).length;
  const chance = (p) => r() < p * params.visitors;
  const still = pondsOf(world).filter((p) => p.still);
  if (still.length && count('dragonfly') < room(world, 2) && chance(0.06)) {
    world.visitors.push(newDragonfly(world, pick(r, still)));
  }
  if (flowersOf(world).length >= 2 && count('bee') < room(world, 1) && chance(0.03)) world.visitors.push(newBee(world));
  const plants = world.objects.filter((o) => o.kind === 'plant' && o.stems.length);
  if (plants.length && count('gnats') < room(world, 2) && chance(0.1 / 3)) {
    const top = pick(r, plants).stems.reduce((a, st) => (st.tip.y < a.y ? st.tip : a), { y: Infinity });
    const at = { x: top.x, y: top.y - 12 - r() * 12 };
    const cell = world.terrain.cells[cellAt(world.terrain, at.x, at.y)];
    if (at.y > 8 && (cell === EMPTY || cell === undefined)) world.visitors.push(newGnats(world, at)); // in the air
  }
};

export const stepVisitors = (world) => {
  if (world.time % ARRIVE_TICKS === 0) arrive(world);
  world.visitors = world.visitors.filter((v) => STEPS[v.kind](world, v));
};

// Something sudden at (x, y): a dragonfly darts off somewhere else over its pond, a bee leaves, and gnats scatter.
export const startleVisitors = (world, x, y) => {
  for (const v of world.visitors) {
    const d = Math.hypot(v.x - x, v.y - y);
    if (d > 30) continue;
    if (v.kind === 'dragonfly' && v.state !== 'leave') head(v, 'dart', overPond(world, v.pond));
    else if (v.kind === 'bee') Object.assign(v, { visits: 0, to: null });
    else if (v.kind === 'gnats') v.spread = 3;
  }
};
