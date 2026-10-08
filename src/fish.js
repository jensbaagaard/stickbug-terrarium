// Guppies: their genome, and how they live in the tank's water. They cruise the upper water in a loose shoal, now and
// then forming up into a school that swims and turns as one, race for food and graze the plants and the surface
// between meals, beg at the pointer when they're hungry, play tag, dart off when startled (the fright spreading
// through the shoal) and the shy ones hide in the plants after, rest by the plants, and the males square up to each
// other with fins flared and court the females with a quivering S-shaped display. Out of the water they flop about,
// hopping toward the nearest water, until they're back in. Pure data + functions, like the rest of the simulation.
import { CELL, cellAt, EMPTY, WATER } from './terrain.js';
import { clamp, pick } from './geom.js';
import { ripple } from './life.js';

const HUNGER = 1 / 15000; // per tick, for an average appetite
const BITE = 0.12; // hunger a flake takes away
const TURN_TICKS = 8; // to turn round
const SETTLE_TICKS = 45; // after turning round, before it'll turn again (unless it's fleeing)
const DRAG = 0.985;
const EDGE = 3; // px a fish keeps between its middle and the edge of the water
const MAX_FLAKES = 80;

const range = (rand, lo, hi) => lo + rand() * (hi - lo);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- genome ----------

// Tail shapes, the rarer ones listed fewer times, and what each adds to a fish's price.
const TAILS = ['delta', 'delta', 'fan', 'fan', 'fan', 'round', 'spade', 'veil', 'sword', 'double', 'lyre'];
const TAIL_RARITY = { delta: 0, fan: 0, round: 1, spade: 1, veil: 2, sword: 2, double: 3, lyre: 3 };
const TAIL_PATTERNS = ['solid', 'solid', 'mosaic', 'leopard', 'grass', 'edge', 'half'];
const BODY_PATTERNS = ['plain', 'plain', 'spots', 'snakeskin', 'tuxedo'];

// A guppy's genome. Males are small and bright with big tails; females bigger and plainer, with smaller fins in
// duller colours. The personality genes run 0..1: speed, boldness (how easily it's startled, and whether it comes
// begging), sociability (how tightly it shoals), activity (how little it rests), appetite and depth (how deep in
// the water it likes to cruise).
export const makeGuppy = (rand) => {
  const male = rand() < 0.6;
  const hue = rand() * 360;
  const tailHue = rand() < 0.5 ? hue + range(rand, -40, 40) : rand() * 360;
  return {
    male,
    size: rand(),
    speed: rand(),
    boldness: rand(),
    sociability: rand(),
    activity: rand(),
    appetite: rand(),
    depth: rand(),
    body: male
      ? { h: hue, s: range(rand, 20, 60), l: range(rand, 52, 66) }
      : { h: range(rand, 30, 55), s: range(rand, 8, 25), l: range(rand, 54, 66) },
    pattern: male ? pick(rand, BODY_PATTERNS) : 'plain',
    spots: { h: rand() < 0.6 ? range(rand, 10, 35) : rand() * 360, s: range(rand, 70, 95), l: rand() < 0.35 ? 14 : 55 },
    metallic: rand() < (male ? 0.3 : 0.08), // scales that glint
    albino: rand() < 0.05, // pale, with red eyes
    tail: male ? pick(rand, TAILS) : pick(rand, ['delta', 'fan', 'round']),
    tailSize: rand(),
    dorsalSize: rand(),
    tailColor: male
      ? { h: tailHue, s: range(rand, 60, 95), l: range(rand, 45, 62) }
      : { h: tailHue, s: range(rand, 15, 40), l: range(rand, 55, 68) },
    tailPattern: male ? pick(rand, TAIL_PATTERNS) : 'solid',
    tailColor2: {
      h: tailHue + range(rand, 120, 240),
      s: range(rand, 50, 90),
      l: rand() < 0.35 ? 15 : range(rand, 40, 70),
    },
    seed: Math.floor(rand() * 1000),
  };
};

// Rarer looks cost more.
export const guppyPrice = (g) =>
  8 +
  (g.male ? 3 : 0) +
  TAIL_RARITY[g.tail] * 3 +
  (g.metallic ? 4 : 0) +
  (g.albino ? 8 : 0) +
  (g.pattern !== 'plain' ? 2 : 0) +
  (g.tailPattern !== 'solid' ? 2 : 0);

// A fish's build in px: body length and depth, tail length and half-height, dorsal fin height.
export const fishShape = (g) => {
  const s = g.male ? 0.9 + 0.2 * g.size : 1.15 + 0.3 * g.size;
  return {
    len: 7 * s,
    depth: (g.male ? 3.8 : 4) * s,
    tail: g.male ? 4 + 3 * g.tailSize : 2.5 + g.tailSize,
    spread: g.male ? 2.2 + 1.3 * g.tailSize : 1.6 + 0.6 * g.tailSize,
    dorsal: g.male ? 1 + 1.2 * g.dorsalSize : 0.8 + 0.5 * g.dorsalSize,
  };
};

const NAMES = [
  'Bubbles', 'Finn', 'Neon', 'Coral', 'Pebble', 'Sunny', 'Ripple', 'Splash', 'Flicker', 'Tango', 'Mango', 'Kiwi',
  'Comet', 'Blaze', 'Gilly', 'Wiggles', 'Zippy', 'Swish', 'Pearl', 'Sprite', 'Dash', 'Glimmer', 'Fizz', 'Twinkle',
  'Minnow', 'Puddle', 'Paprika', 'Saffron', 'Jelly', 'Noodle',
];
const TITLES = ['Little ', 'Big ', 'Captain ', 'Lady ', 'Sir ', 'Old '];
export const guppyName = (rand) => (rand() < 0.15 ? pick(rand, TITLES) : '') + pick(rand, NAMES);

// ---------- the water ----------

const cellOf = (world, x, y) => world.terrain.cells[cellAt(world.terrain, x, y)]; // undefined outside the grid
export const wet = (world, x, y) => cellOf(world, x, y) === WATER;
const solid = (world, x, y) => {
  if (y >= world.ground.y0) return true;
  const m = cellOf(world, x, y);
  return m !== undefined && m !== EMPTY && m !== WATER;
};

// The first solid row at or below y at x: the terrain, or the tank floor.
const floorUnder = (world, x, y) => {
  let fy = Math.max(0, Math.ceil(y));
  while (!solid(world, x, fy)) fy++;
  return fy;
};

// Where the water fish is in starts and ends, straight up and down from it.
const column = (world, f) => {
  let [top, bottom] = [f.y, f.y];
  while (top > 0 && wet(world, f.x, top - CELL)) top -= CELL;
  while (wet(world, f.x, bottom + CELL)) bottom += CELL;
  return { top, bottom };
};

// ---------- fish ----------

export const newFish = (world, x, y, genome, name = guppyName(world.rand)) => ({
  name,
  genome,
  x,
  y,
  vx: 0,
  vy: 0,
  facing: world.rand() < 0.5 ? -1 : 1,
  turn: 0, // ticks left of turning round
  turnedAt: 0,
  pitch: 0, // nose down, radians
  tail: 0, // tail-beat phase
  beat: 0, // ticks left of the tail stroke it's putting in; between strokes it glides
  dir: world.rand() < 0.5 ? -1 : 1, // which way it's cruising
  wander: 0,
  hunger: 0.3,
  goal: null, // {kind: 'food' | 'graze' | 'rest' | 'court', ...}
  think: 0, // ticks until it next decides what to do
  fear: 0, // ticks left of fleeing from `from`, once `fearDelay` has run out
  fearDelay: 0,
  from: null,
  cooldown: 0, // before a male courts again
  display: 0, // ticks left of a male's display
  flare: 0, // eases to 1 while its fins are flared, sparring or on display
  peck: 0, // ticks left of a bite
  hop: 0, // out of the water: ticks to the next flop
  dry: false,
  column: null,
  seed: world.rand() * 1000,
});

// The nearest fish within reach of (x, y), to pick up or look at.
export const fishAt = (world, x, y) => {
  let best = null;
  for (const fish of world.fish) {
    const d = Math.hypot(fish.x - x, fish.y - y);
    if (d < fishShape(fish.genome).len && (!best || d < best.d)) best = { d, fish };
  }
  return best && { fish: best.fish, d: best.d };
};

// Something sudden at (x, y): fish near it dart away, the ones further off a moment later, so the fright ripples out
// through the shoal. Bold fish hold their nerve closer in.
export const startle = (world, x, y, reach = 40) => {
  for (const f of world.fish) {
    const d = Math.hypot(f.x - x, f.y - y);
    if (d > reach * (1.2 - 0.6 * f.genome.boldness) || f.dry) continue;
    Object.assign(f, { fear: 40 + 60 * (1 - f.genome.boldness), fearDelay: Math.floor(d / 6), from: { x, y } });
  }
};

// Sprinkle food on the water above one of the fish. The flakes float a while, then sink.
export const feedFish = (world) => {
  const swimming = world.fish.filter((f) => !f.dry);
  const f = swimming.length ? pick(world.rand, swimming) : world.fish[0];
  if (!f) return;
  let y = f.y;
  while (y > 2 && wet(world, f.x, y - CELL)) y -= CELL;
  for (let i = 0; i < 8; i++) {
    world.flakes.push({
      x: clamp(f.x + (world.rand() - 0.5) * 24, 2, world.W - 3),
      y: y - 3 - world.rand() * 8,
      vy: 0,
      float: 0, // ticks it floats at the surface
      size: 1,
      life: 2400,
      seed: world.rand() * 1000,
    });
  }
  world.flakes.splice(0, world.flakes.length - MAX_FLAKES);
};

// Flakes fall through the air, float on the water a while, sink slowly and lie on the bottom until they're eaten
// or go to mush.
const stepFlakes = (world) => {
  world.flakes = world.flakes.filter((fl) => {
    const inWater = wet(world, fl.x, fl.y);
    if (!inWater) fl.vy = Math.min(fl.vy + 0.05, 1.5);
    else if (fl.vy > 0.1) {
      Object.assign(fl, { vy: 0, float: 150 + world.rand() * 150 }); // just landed on it
      ripple(world, fl.x, fl.y);
    } else if (fl.float > 0 && !wet(world, fl.x, fl.y - CELL)) fl.float--;
    else fl.vy = 0.06;
    if (inWater) fl.x = clamp(fl.x + Math.sin(world.time * 0.02 + fl.seed) * 0.03, 1, world.W - 2);
    fl.y = Math.min(fl.y + fl.vy, floorUnder(world, fl.x, fl.y) - 1);
    return --fl.life > 0 && fl.size > 0;
  });
};

// Food in the water: flakes, and crumbs and leaves that have fallen in.
const foodNear = (world, f, reach) => {
  let best = null;
  for (const it of [...world.flakes, ...world.crumbs, ...world.litter]) {
    if (it.life <= 0 || !wet(world, it.x, it.y + 1)) continue;
    const d = Math.hypot(it.x - f.x, it.y - f.y);
    if (d < reach && (!best || d < best.d)) best = { d, it };
  }
  return best?.it ?? null;
};

const mouthOf = (f) => ({ x: f.x + (f.facing * fishShape(f.genome).len) / 2, y: f.y });

// Where fish should be to put its mouth to p, coming at it from the side it's on.
const mouthTo = (f, p) => {
  const side = Math.sign(p.x - f.x) || f.facing;
  return { side, x: p.x - (side * fishShape(f.genome).len) / 2, y: p.y };
};

// Somewhere to graze: the surface just ahead now and then (guppies pick at it), else a plant or vine under water
// nearby, or the bottom.
const grazeSpot = (world, f) => {
  const graze = (p) => ({ kind: 'graze', x: p.x, y: p.y, ticks: 150 + world.rand() * 200 });
  const surface = { x: clamp(f.x + f.dir * 10, 4, world.W - 5), y: f.column.top + 1 };
  if (world.rand() < 0.3 && wet(world, surface.x, surface.y)) return graze(surface);
  const spots = [];
  for (const o of world.objects) {
    if (o.kind === 'plant') for (const st of o.stems) spots.push(st.tip);
    if (o.kind === 'vine') spots.push(...o.nodes);
  }
  const near = spots.filter((p) => wet(world, p.x, p.y) && dist(p, f) < 80);
  if (near.length) return graze(pick(world.rand, near));
  const x = clamp(f.x + (world.rand() - 0.5) * 40, 4, world.W - 5);
  const y = floorUnder(world, x, f.y) - 2;
  return wet(world, x, y) ? graze({ x, y }) : null;
};

// Somewhere to rest: by a plant or vine under water if there's one near (the cover makes it feel safe), or right
// here. Hiding, it's cover or nothing, and it gets there quick.
const restSpot = (world, f, reach = 50, hiding = false) => {
  const cover = (o) => (o.kind === 'plant' ? o.stems.map((st) => st.root) : o.kind === 'vine' ? o.nodes : []);
  const near = world.objects.flatMap(cover).filter((p) => wet(world, p.x, p.y) && dist(p, f) < reach);
  if (hiding && !near.length) return null;
  const at = near.length ? pick(world.rand, near) : f;
  const ticks = (hiding ? 300 : 200) + world.rand() * 500 * (1 - f.genome.activity);
  return { kind: 'rest', x: at.x, y: at.y, ticks, hiding };
};

// Fish near f with nothing else on: swimming about, not fleeing or out of the water.
const freeNear = (world, f, reach) =>
  world.fish.filter((o) => o !== f && !o.dry && !o.goal && !(o.fear > 0) && dist(o, f) < reach);

// A sociable fish joins a school passing by, or leads the free fish near it off as a new one.
const startSchool = (world, f) => {
  const leader = world.fish.find((o) => o.goal?.kind === 'lead' && dist(o, f) < 50);
  if (leader) return { kind: 'school', leader, slot: leader.goal.size++ };
  const crew = freeNear(world, f, 60);
  if (crew.length < 2) return null;
  const goal = { kind: 'lead', ticks: 400 + world.rand() * 500, size: 0 };
  for (const o of crew) o.goal = { kind: 'school', leader: f, slot: goal.size++ };
  return goal;
};

// Where the slot-th fish of a school keeps: in an arrowhead behind its leader, a row of two every fish-length or so
// back, one above and one below (that one a little further back, so they don't line up too neatly).
const slotOf = (leader, slot) => {
  const row = 1 + Math.floor(slot / 2);
  const below = slot % 2;
  return { x: leader.x - leader.facing * (row * 10 + below * 3), y: leader.y + (below ? 1 : -1) * (2 + row * 3) };
};

// A lively fish starts a game of tag with one nearby, and it's it.
const startTag = (world, f) => {
  const [other] = freeNear(world, f, 50);
  if (!other) return null;
  const game = { players: [f, other], it: f, wait: 0, rounds: 2 + Math.floor(world.rand() * 3), ticks: 600 };
  other.goal = { kind: 'tag', game };
  return { kind: 'tag', game };
};

// A male squares up to another one nearby.
const startSpar = (world, f) => {
  const rival = freeNear(world, f, 40).find((o) => o.genome.male);
  if (!rival) return null;
  const ticks = 120 + world.rand() * 120;
  rival.goal = { kind: 'spar', rival: f, ticks };
  return { kind: 'spar', rival, ticks };
};

// Cruising: on along the way it's going, wandering up and down (sweep says how far) and keeping to the depth it
// likes, and turning back where the water ends.
const cruiseWant = (world, f, speed, sweep) => {
  const { top, bottom } = f.column;
  if (!wet(world, f.x + f.dir * (fishShape(f.genome).len / 2 + 4), f.y)) f.dir = -f.dir;
  f.wander = clamp(f.wander + (world.rand() - 0.5) * 0.06, -sweep, sweep);
  const depth = top + (bottom - top) * (0.05 + 0.5 * f.genome.depth);
  return { x: f.dir * speed, y: Math.sin(f.wander) * speed * 0.4 + clamp((depth - f.y) * 0.02, -0.12, 0.12) };
};

const capped = (v, max) => {
  const m = Math.hypot(v.x, v.y);
  return m > max ? { x: (v.x / m) * max, y: (v.y / m) * max } : v;
};

// A male picks a female nearby to court.
const courtship = (world, f) => {
  const mate = world.fish.find((o) => !o.genome.male && !o.dry && dist(o, f) < 60);
  return mate ? { kind: 'court', mate, ticks: 240 + world.rand() * 240 } : null;
};

// Now and then a fish picks something to do, by its nature: graze when it's peckish, school if it's sociable, play
// tag if it's lively, square up to another male or court a female if it's a male, rest if it's a lazy one; or else
// cruise, sometimes turning back the other way.
const decide = (world, f) => {
  const g = f.genome;
  f.think = 60 + world.rand() * 120;
  if (f.goal) return;
  const roll = (p) => world.rand() < p;
  if (f.hunger > 0.3 && roll(f.hunger - 0.2)) f.goal = grazeSpot(world, f);
  else if (roll(0.1 + 0.25 * g.sociability)) f.goal = startSchool(world, f);
  else if (roll(0.03 + 0.1 * g.activity)) f.goal = startTag(world, f);
  else if (g.male && f.cooldown <= 0 && roll(0.2 + 0.3 * g.activity)) {
    f.goal = (roll(0.35) && startSpar(world, f)) || courtship(world, f);
  } else if (roll(0.1 + 0.4 * (1 - g.activity))) f.goal = restSpot(world, f);
  else if (roll(0.3)) f.dir = -f.dir;
};

// The pull of the shoal: keep a little apart, swim the way the others do, and stay with them.
const shoal = (world, f) => {
  let [n, cx, cy, ax, ay, sx, sy] = [0, 0, 0, 0, 0, 0, 0];
  for (const o of world.fish) {
    if (o === f || o.dry) continue;
    const [dx, dy] = [o.x - f.x, o.y - f.y];
    const d = Math.hypot(dx, dy);
    if (d > 30) continue;
    n++;
    [cx, cy, ax, ay] = [cx + dx, cy + dy, ax + o.vx, ay + o.vy];
    if (d < 6) [sx, sy] = [sx - ((dx / (d || 1)) * (6 - d)) / 6, sy - ((dy / (d || 1)) * (6 - d)) / 6];
  }
  if (!n) return { x: 0, y: 0 };
  const k = 0.3 + 0.7 * f.genome.sociability;
  return {
    x: sx * 0.25 + (ax / n - f.vx) * 0.25 * k + (cx / n) * 0.006 * k,
    y: sy * 0.25 + (ay / n - f.vy) * 0.25 * k + (cy / n) * 0.006 * k,
  };
};

// Keep to the water: a nudge off any edge close by, and if the way it wants to go runs out of water, the nearest
// way round that doesn't (or back the way it came). Going for food, it'll come right up to the edge for it.
const keepWet = (world, f, want) => {
  const out = { ...want };
  const food = f.goal?.kind === 'food' ? f.goal.it : null;
  for (let k = 0; k < 8 && !food; k++) {
    const [ex, ey] = [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)];
    if (!wet(world, f.x + ex * EDGE, f.y + ey * EDGE)) [out.x, out.y] = [out.x - ex * 0.1, out.y - ey * 0.1];
  }
  const speed = Math.hypot(out.x, out.y);
  if (speed < 0.01) return out;
  const look = Math.min(3 + speed * 10, food ? dist(food, f) : Infinity);
  if (look < 1) return out;
  const ahead = (a) => {
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return { x: ((out.x * c - out.y * s) / speed) * look, y: ((out.x * s + out.y * c) / speed) * look };
  };
  for (const a of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
    const d = ahead(a * f.dir);
    if (wet(world, f.x + d.x, f.y + d.y)) return { x: (d.x / look) * speed, y: (d.y / look) * speed };
  }
  return out;
};

// Head for p at up to speed, slowing to arrive.
const toward = (f, p, speed, slow = 8) => {
  const [dx, dy] = [p.x - f.x, p.y - f.y];
  const d = Math.hypot(dx, dy) || 1;
  const s = speed * Math.min(1, d / slow);
  return { x: (dx / d) * s, y: (dy / d) * s };
};

const swim = (world, f) => {
  const g = f.genome;
  const cruise = 0.13 + 0.16 * g.speed;
  const sprint = 0.65 + 0.5 * g.speed;
  if (f.dry) {
    // Splashed back in: the water slows it, and it shoots off.
    Object.assign(f, { vx: f.vx * 0.4, vy: f.vy * 0.4, dry: false, fear: 30, fearDelay: 0 });
    f.from = { x: f.x, y: f.y - 5 };
  }
  if (!f.column || (world.time + Math.floor(f.seed)) % 10 === 0) f.column = column(world, f);
  if (--f.think <= 0) decide(world, f);
  if (f.cooldown > 0) f.cooldown--;
  if (f.fearDelay > 0) f.fearDelay--;
  else if (f.fear > 0 && --f.fear <= 0 && g.boldness < 0.45) f.goal = restSpot(world, f, 90, true); // shy: hide
  if ((world.time + Math.floor(f.seed)) % 6 === 0 && f.goal?.kind !== 'food' && f.hunger > 0.1) {
    const it = foodNear(world, f, 25 + 90 * f.hunger);
    if (it) f.goal = { kind: 'food', it };
  }

  const goal = f.goal;
  const p = world.pointer;
  const begging =
    world.hover && f.hunger > 0.3 && g.boldness > 0.4 && wet(world, p.x, p.y) && dist(p, f) < 70 && !goal;
  let want;
  let force = 0.03 + 0.02 * g.speed; // a tail stroke's worth of push
  let look = 0; // which way to face when it's barely moving
  let sync = null; // the leader of the school it's in, to turn and beat its tail with
  let flare = f.display > 0;
  if (f.fear > 0 && f.fearDelay <= 0) {
    // Fleeing, flat out.
    const d = dist(f, f.from) || 1;
    want = { x: ((f.x - f.from.x) / d) * sprint, y: ((f.y - f.from.y) / d) * sprint };
    force = 0.1;
    f.goal = null;
  } else if (f.peck > 0) {
    // A bite: it stops to take it.
    f.peck--;
    want = { x: 0, y: 0 };
  } else if (goal?.kind === 'food') {
    const it = goal.it;
    if (it.life <= 0 || !wet(world, it.x, it.y + 1)) {
      f.goal = null;
      want = { x: 0, y: 0 };
    } else {
      // Race for it, the hungrier the faster, and take a bite once its mouth gets there.
      const target = { x: it.x, y: it.y + 1 };
      if (dist(mouthOf(f), target) < 2.5) {
        it.size = (it.size ?? 0) - 0.35;
        if (it.size <= 0) it.life = 0;
        f.hunger = Math.max(0, f.hunger - BITE);
        f.peck = 10;
        if (f.hunger < 0.05) f.goal = null;
      }
      // Bring its mouth to it, not its middle.
      const spot = mouthTo(f, target);
      want = toward(f, spot, cruise + (sprint * 0.7 - cruise) * f.hunger, 4);
      look = spot.side;
    }
  } else if (begging) {
    // Hungry and bold: come up to the pointer and hang there, facing it.
    const d = dist(p, f) || 1;
    want = toward(f, { x: p.x + ((f.x - p.x) / d) * 10, y: p.y + ((f.y - p.y) / d) * 10 }, cruise * 1.5);
    look = Math.sign(p.x - f.x);
  } else if (goal?.kind === 'graze') {
    // Nose up to it and pick at it now and then.
    const near = dist(mouthOf(f), goal) < 2.5;
    const spot = mouthTo(f, goal);
    want = toward(f, near ? f : spot, cruise);
    look = spot.side;
    if (near && world.rand() < 0.04) {
      f.peck = 8;
      f.hunger = Math.max(0, f.hunger - 0.006);
    }
    if (--goal.ticks <= 0 || !wet(world, goal.x, goal.y)) f.goal = null;
  } else if (goal?.kind === 'rest') {
    // Hover by the plant, finning gently (dashing there first, if it's hiding).
    want = toward(f, goal, goal.hiding ? cruise * 1.5 : 0.1, 20);
    if (--goal.ticks <= 0) f.goal = null;
  } else if (goal?.kind === 'lead') {
    // Leading a school round the water: a brisk cruise sweeping up and down, and now and then a sudden turn that
    // the whole school makes together.
    if (world.rand() < 0.004) f.dir = -f.dir;
    want = cruiseWant(world, f, cruise * 1.4, 0.7);
    if (--goal.ticks <= 0) f.goal = null;
  } else if (goal?.kind === 'school') {
    // In a school: keep its place and swim as the leader swims.
    const lead = goal.leader;
    if (lead.goal?.kind !== 'lead' || lead.dry || !world.fish.includes(lead)) {
      f.goal = null;
      want = { x: f.vx, y: f.vy };
    } else {
      const spot = slotOf(lead, goal.slot);
      want = capped({ x: lead.vx + (spot.x - f.x) * 0.06, y: lead.vy + (spot.y - f.y) * 0.06 }, sprint * 0.9);
      sync = lead;
    }
  } else if (goal?.kind === 'tag') {
    // Tag: whoever's it gives chase while the other dodges away, zigzagging. Caught, they swap, and the new it
    // counts a moment before it gives chase.
    const game = goal.game;
    const other = game.players.find((o) => o !== f);
    const playing = game.players.every((o) => o.goal?.game === game && world.fish.includes(o) && !o.dry);
    if (game.rounds <= 0 || game.ticks <= 0 || !playing) {
      for (const o of game.players) if (o.goal?.game === game) o.goal = null;
      want = { x: f.vx, y: f.vy };
    } else if (game.it === f && game.wait > 0) {
      game.wait--;
      want = { x: 0, y: 0 };
      look = Math.sign(other.x - f.x);
    } else if (game.it === f) {
      game.ticks--;
      want = toward(f, other, sprint * 0.9, 1);
      if (dist(f, other) < 4) Object.assign(game, { it: other, wait: 30, rounds: game.rounds - 1 });
    } else {
      const d = dist(f, game.it) || 1;
      const [ax, ay] = [(f.x - game.it.x) / d, (f.y - game.it.y) / d];
      const zig = Math.sin(world.time * 0.12 + f.seed) * 0.5;
      const speed = sprint * (d < 30 ? 0.65 : 0.3);
      want = { x: (ax - ay * zig) * speed, y: (ay + ax * zig) * speed };
    }
  } else if (goal?.kind === 'spar') {
    // Squared up to another male: nose to nose a little apart, fins flared, circling each other. When it's over,
    // the less bold of the two backs down and darts off.
    const rival = goal.rival;
    if (rival.goal?.rival !== f || rival.dry || !world.fish.includes(rival)) {
      f.goal = null;
      want = { x: 0, y: 0 };
    } else if (--goal.ticks <= 0) {
      const loser = g.boldness < rival.genome.boldness ? f : rival;
      const winner = loser === f ? rival : f;
      Object.assign(loser, { fear: 40, fearDelay: 0, from: { x: winner.x, y: winner.y } });
      f.goal = rival.goal = null;
      f.cooldown = rival.cooldown = 600 + world.rand() * 900;
      want = { x: 0, y: 0 };
    } else {
      const side = Math.sign(f.x - rival.x) || 1;
      const spot = { x: rival.x + side * 9, y: rival.y + Math.sin(world.time * 0.05) * 3 * side };
      want = toward(f, spot, cruise * 1.2, 4);
      look = -side;
      flare = true;
    }
  } else if (goal?.kind === 'court') {
    // Get in front of her, alongside, and now and then put on the display; she'd rather swim on.
    const mate = goal.mate;
    if (!world.fish.includes(mate) || mate.dry || --goal.ticks <= 0) {
      f.goal = null;
      f.cooldown = 600 + world.rand() * 900;
      want = { x: 0, y: 0 };
    } else {
      const spot = { x: mate.x + mate.facing * 5, y: mate.y - 1 };
      want = toward(f, spot, sprint * 0.6, 4);
      if (f.display > 0) {
        f.display--;
        want = { x: mate.vx + (spot.x - f.x) * 0.05, y: mate.vy + (spot.y - f.y) * 0.05 };
      } else if (dist(f, spot) < 4 && world.rand() < 0.03) {
        f.display = 40;
      }
      look = Math.sign(mate.x - f.x);
      const d = dist(f, mate) || 1;
      if (d < 10) [mate.vx, mate.vy] = [mate.vx + ((mate.x - f.x) / d) * 0.01, mate.vy + ((mate.y - f.y) / d) * 0.01];
    }
  } else {
    want = cruiseWant(world, f, cruise, 0.4);
  }
  if (!(f.fear > 0 && f.fearDelay <= 0)) {
    const pull = shoal(world, f);
    [want.x, want.y] = [want.x + pull.x, want.y + pull.y];
  }
  want = keepWet(world, f, want);

  // Burst and glide: a few ticks of tail strokes whenever it's going too slowly or the wrong way, then it coasts.
  if (f.beat <= 0 && Math.hypot(want.x - f.vx, want.y - f.vy) > 0.12) f.beat = 6 + world.rand() * 6;
  const push = f.beat-- > 0 ? force : 0.006;
  const [dx, dy] = [want.x - f.vx, want.y - f.vy];
  const k = Math.min(1, push / (Math.hypot(dx, dy) || 1));
  f.vx = (f.vx + dx * k) * DRAG;
  f.vy = (f.vy + dy * k) * DRAG;

  // Move, but never out of the water.
  const [nx, ny] = [f.x + f.vx, f.y + f.vy];
  if (wet(world, nx, ny)) [f.x, f.y] = [nx, ny];
  else if (wet(world, nx, f.y)) [f.x, f.vy] = [nx, -f.vy * 0.3];
  else if (wet(world, f.x, ny)) [f.y, f.vx] = [ny, -f.vx * 0.3];
  else [f.vx, f.vy] = [-f.vx * 0.3, -f.vy * 0.3];

  // Face the way it swims, or when it's barely moving, the way it's looking; but having just turned round, it
  // doesn't turn straight back. It noses up or down as it swims up or down, but barely at all when it's going
  // slowly, so it doesn't bob about as it hovers. In a school it turns, tilts and beats its tail with the leader.
  const turnTo = sync ? sync.facing : Math.abs(f.vx) > 0.1 ? Math.sign(f.vx) : look;
  const settled = world.time - f.turnedAt > SETTLE_TICKS || f.fear > 0 || sync;
  if (f.turn > 0) f.turn--;
  else if (turnTo && turnTo !== f.facing && settled) [f.facing, f.turn, f.turnedAt] = [turnTo, TURN_TICKS, world.time];
  const tilt = Math.hypot(f.vx, f.vy) > 0.15 ? clamp(Math.atan2(f.vy, Math.abs(f.vx) + 0.3), -0.4, 0.4) : 0;
  f.pitch += ((sync ? sync.pitch : tilt) - f.pitch) * 0.08;
  f.tail = sync ? sync.tail : f.tail + 0.06 + (f.beat > 0 ? 0.35 : 0.05) + (f.fear > 0 ? 0.25 : 0);
  f.flare += ((flare ? 1 : 0) - f.flare) * 0.15;
};

// Out of the water: fall, then lie flopping, every so often hopping toward the nearest water.
const flop = (world, f) => {
  Object.assign(f, { dry: true, goal: null, fear: 0, display: 0, flare: 0 });
  while (f.y > 1 && solid(world, f.x, f.y)) f.y--; // buried: wriggle up out of it
  const floor = floorUnder(world, f.x, f.y) - 1.5;
  const grounded = f.y >= floor - 0.1 && f.vy >= 0;
  if (grounded && --f.hop <= 0) {
    const way = waterSide(world, f) ?? (world.rand() < 0.5 ? -1 : 1);
    const [vx, vy] = [way * (0.3 + world.rand() * 0.4), -(0.9 + world.rand() * 0.8)];
    Object.assign(f, { vx, vy, hop: 25 + world.rand() * 40 });
    if (world.rand() < 0.5) [f.facing, f.turn] = [-f.facing, TURN_TICKS];
  } else if (grounded) {
    [f.vx, f.vy, f.y] = [f.vx * 0.7, 0, floor];
  } else {
    f.vy = Math.min(f.vy + 0.12, 3);
  }
  const x = f.x + f.vx;
  if (solid(world, x, f.y) || x < 2 || x > world.W - 3) f.vx = -f.vx * 0.3; // bumped into a wall, or the tank's side
  else f.x = x;
  f.y = Math.min(f.y + f.vy, floorUnder(world, f.x, f.y) - 1.5);
  if (f.turn > 0) f.turn--;
  f.pitch = grounded ? Math.sin(world.time * 0.4 + f.seed) * 0.3 : f.pitch + f.vx * 0.3;
  f.tail += 0.5;
};

// Which way the nearest water is, along the ground: -1, 1, or null if there's none in sight.
const waterSide = (world, f) => {
  for (let d = 2; d < 90; d += 2) {
    for (const side of [-1, 1]) {
      const x = f.x + side * d;
      for (let dy = -10; dy <= 6; dy += CELL) if (wet(world, x, f.y + dy)) return side;
    }
  }
  return null;
};

// Held by the pointer: it hangs there wriggling, and the fish near it scatter.
const hold = (world, f) => {
  const p = world.pointer;
  const [vx, vy] = [clamp(p.x - f.x, -3, 3), clamp(p.y - f.y, -3, 3)]; // let go, it's thrown, but not too hard
  Object.assign(f, { vx, vy, x: p.x, y: p.y, dry: !wet(world, p.x, p.y), goal: null, fear: 0 });
  f.tail += 0.6;
  f.pitch = Math.sin(world.time * 0.5) * 0.4;
  if (world.time % 20 === 0) startle(world, p.x, p.y, 25);
};

// A tick for every fish and the food in the water. A pointer swept fast through the water startles the fish near
// it.
export const stepFish = (world) => {
  stepFlakes(world);
  const p = world.pointer;
  const was = world.pointerWas ?? p;
  world.pointerWas = { ...p };
  if (world.hover && Math.hypot(p.x - was.x, p.y - was.y) > 3 && wet(world, p.x, p.y)) startle(world, p.x, p.y, 30);
  for (const f of world.fish) {
    f.hunger = Math.min(1, f.hunger + HUNGER * (0.6 + 0.8 * f.genome.appetite));
    if (world.held?.fish === f) hold(world, f);
    else if (wet(world, f.x, f.y)) swim(world, f);
    else flop(world, f);
  }
};

// Turning round, a fish narrows to nothing and widens again facing the other way: how wide it is now, signed by the
// way it faces.
export const facingNow = (f) => -f.facing * Math.cos(Math.PI * (1 - f.turn / TURN_TICKS));
