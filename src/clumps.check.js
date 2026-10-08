// Run with `node src/clumps.check.js`: clump plants grow a full crown, a trimmed leaf's stump is replaced by a new
// leaf, they save and load, and a cutting grows a crown of its own.
import assert from 'node:assert/strict';
import { makeClump } from './decor.js';
import { mulberry32 } from './geom.js';
import {
  createWorld,
  exportWorld,
  importWorld,
  pointerDown,
  pointerUp,
  propagatable,
  setTool,
  startPlacing,
  step,
} from './sim.js';

const world = createWorld(240, 320, { seed: 5, scene: false });
world.coins = 1e6;
const steps = (w, n) => {
  for (let i = 0; i < n; i++) step(w);
};
const tap = (x, y) => {
  pointerDown(world, x, y);
  pointerUp(world, x, y);
};
// A clump plant of the given form, put in from the shop at x.
const plant = (form, x) => {
  let seed = 1;
  while (makeClump(mulberry32(seed)).form !== form) seed++;
  startPlacing(world, 'plant', { id: seed, kind: 'plant', type: 'clump', seed, price: 5, name: form, sold: false });
  tap(x, 300);
  return world.objects.at(-1);
};
const leaves = (p) => p.stems.filter((s) => !s.parent && s.role === 'leaf' && !s.trimmed).length;
const chain = (p, root) => {
  const out = [root];
  for (let s = root, next; (next = p.stems.find((c) => c.parent === s)); s = next) out.push(next);
  return out;
};

const tussock = plant('tussock', 60);
const bird = plant('strelitzia', 170);
steps(world, 40000);
assert.equal(leaves(tussock), tussock.species.leaves, 'the tussock grows its full crown');
assert.equal(leaves(bird), bird.species.leaves, 'and the strelitzia');
assert.ok(propagatable(bird), 'a grown strelitzia in flower can be propagated');

// Trim a leaf half way along: the clipping sells, the stump stays, and later a new leaf replaces it.
const leaf = tussock.stems.find((s) => !s.parent && s.role === 'leaf');
const mid = chain(tussock, leaf)[Math.floor(chain(tussock, leaf).length / 2)];
const coins = world.coins;
setTool(world, 'prune');
tap((mid.root.x + mid.tip.x) / 2, (mid.root.y + mid.tip.y) / 2);
setTool(world, 'hand');
assert.ok(world.coins > coins, 'the clipping sells');
assert.ok(leaf.trimmed && tussock.stems.includes(leaf), 'the stump stays, trimmed');
steps(world, 20000);
assert.ok(!tussock.stems.includes(leaf), 'a new leaf replaced the stump');
assert.equal(leaves(tussock), tussock.species.leaves, 'and the crown is full again');

// Saved and loaded into a taller tank, they come back the same and carry on.
const loaded = importWorld(JSON.parse(JSON.stringify(exportWorld(world))), 240, 360);
const back = loaded.objects.filter((o) => o.kind === 'plant');
assert.deepEqual(
  back.map((o) => o.stems.length),
  [tussock.stems.length, bird.stems.length],
  'saved and loaded',
);
steps(loaded, 2000);
assert.ok(back.every((o) => o.stems.every((s) => Number.isFinite(s.tip.x + s.tip.y))), 'and carry on');

// Propagated, the strelitzia starts over from a first leaf, and its cutting grows a crown of its own.
setTool(world, 'propagate');
const top = bird.stems.reduce((a, s) => (s.tip.y < a.tip.y ? s : a));
tap(top.tip.x, top.tip.y);
tap(215, 300);
const cutting = world.objects.at(-1);
assert.ok(cutting !== bird && cutting.species.name === bird.species.name, 'a cutting of the same species');
assert.equal(bird.stems.length, 1, 'the parent starts over');
steps(world, 40000);
assert.equal(leaves(cutting), cutting.species.leaves, 'the cutting grows a full crown');
console.log('ok');
