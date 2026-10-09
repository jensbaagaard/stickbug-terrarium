// Plants: flowering plants growing node by node (their leaves ageing and dropping, their flowers budding, opening and
// wilting), clump plants growing a crown of leaves and then flower stalks or runners, grass spreading tuft by tuft,
// and vines hanging as swaying ropes; how they sway and spring back when pulled, and pruning them. Pure data +
// functions.
import { params } from './tuning.js';
import { add, clamp, dirOf, dist, lerp } from './geom.js';
import { cellAt, EMPTY, WATER } from './terrain.js';
import { wet } from './fish.js';
import { wind } from './life.js';
import { floorBelow, LEAF_GROWTH } from './surfaces.js';
import { faceAt, groundTop, isSoil, removeObject, solidAt, wetAt } from './objects.js';
import { earn, fling, MAX_LITTER } from './effects.js';

const LEAF_LIFE = 180000; // ticks a plant leaf lasts, for species from before leaves aged
const LEAF_FADE = 1200; // ticks an old leaf takes to yellow before it drops
const BLOOM_LIFE = 12000; // ticks a flower stays open, give or take half
const WILT_TICKS = 1800; // ticks a flower takes to wilt, dropping its petals as it goes
const REST_TICKS = 3600; // ticks a bare tip rests, give or take half, before it buds again
const SPROUT_TICKS = 120; // a pruned stem waits this long before sprouting new shoots
const CHAIN_SEG = 5; // px per segment of a clump plant's leaf, flower stalk or runner
const CROWN_CHANCE = 1 / 200; // chance a tick that a clump plant with room for it starts a new leaf, stalk or runner
const MAX_TUFTS = 400; // per grass patch
const GRASS_CLIMB = 12; // px: grass spreads up or down the face of a pile this tall in one go
const GRASS_STUB = 0.25; // grass cut down to less than this share of its full height dies
const CLIPPING_LEN = 6; // px of pruned plant stem per coin; clippings are the only income
const BEND_STIFFNESS = 0.06; // how hard a bent stem springs back
const BEND_DAMPING = 0.9;
const CURRENT = 0.0015; // how hard the water rocks a stem, radians per tick per tick
const VINE_CURRENT = 0.04; // and a vine's nodes, px per tick per tick
const PLANT_WIND = 0.001; // how hard the breeze pushes a stem in the air, radians per tick per tick
const VINE_WIND = 0.015; // and a vine's nodes, px per tick per tick
const FLEX = 0.15; // how hard pulled grass springs back

// ---------- plants ----------

// Each tick every plant grows (and its leaves and flowers age), and every grass patch and vine.
export const stepPlants = (world) => {
  for (const obj of [...world.objects]) {
    if (obj.kind === 'plant') {
      growPlant(world, obj, params.plantGrowth);
      ageLeaves(world, obj);
      ageFlowers(world, obj);
    } else if (obj.kind === 'grass') growGrass(world, obj, params.plantGrowth);
    else if (obj.kind === 'vine') growVine(world, obj, params.plantGrowth);
  }
};

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

export const growPlant = (world, plant, rate) => {
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
export const ageLeaves = (world, plant) => {
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
export const ageFlowers = (world, plant) => {
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
export const prunePlant = (world, plant, stem, p) => {
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
export const seedling = (world, plant) =>
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
export const crownFull = (plant) => {
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

// Grass grows tuft by tuft. Grown tufts seed neighbours a few px along the same dirt or sand, over bumps and up
// and down the faces of piles (but not cliffs, or onto a ledge with a gap under it); tufts that get buried or
// lose their soil (sand slides away, say) wither away. Under water they grow on (wet), but don't blossom.
export const growGrass = (world, patch, rate) => {
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
export const growVine = (world, vine, rate) => {
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
export const mow = (world, patch, x, y, r = 6) => {
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
export const pruneVine = (world, vine, i) => {
  const cut = vine.nodes.slice(i - 1);
  for (let k = 2; k < cut.length; k += 2) fling(world, cut[k - 2], cut[k], { kind: 'vine', vine });
  vine.nodes = vine.nodes.slice(0, i);
  vine.growth = 0;
  sellClippings(world, (cut.length - 1) * vine.genome.spacing, cut[0].x, cut[0].y);
};
