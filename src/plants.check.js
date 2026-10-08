// Run with `node src/plants.check.js`: plants bend when pulled and spring back, only flower out of the water, and
// grass grows on under water.
import assert from 'node:assert/strict';
import { buyReroll, createWorld, pointerDown, pointerMove, pointerUp, startPlacing, step } from './sim.js';
import { EMPTY, WATER } from './terrain.js';

const world = createWorld(240, 320, { seed: 1 });
world.coins = 1e6;
// Some grass, sown from the shop in the middle of the floor.
let grassOffer;
while (!(grassOffer = world.shop.plant.find((o) => o.type === 'grass'))) buyReroll(world);
startPlacing(world, 'plant', grassOffer);
pointerDown(world, 100, 312);
pointerUp(world, 100, 312);
const grass = world.objects.find((o) => o.kind === 'grass');
for (let i = 0; i < 10000; i++) step(world); // fully grown
const plant = world.objects.find((o) => o.kind === 'plant');
const top = plant.stems.reduce((a, s) => (s.tip.y < a.tip.y ? s : a));
const rest = { ...top.tip };
const near = (a, b, d) => Math.hypot(a.x - b.x, a.y - b.y) < d;

// Pulled by the stem, its tip follows the pointer.
pointerDown(world, top.tip.x, top.tip.y);
pointerMove(world, top.tip.x + 30, top.tip.y + 10);
for (let i = 0; i < 30; i++) step(world);
assert.ok(near(top.tip, { x: rest.x + 30, y: rest.y + 10 }, 1), 'the pulled tip is at the pointer');

// Let go, it springs back.
pointerUp(world, rest.x + 30, rest.y + 10);
for (let i = 0; i < 600; i++) step(world);
assert.ok(near(top.tip, rest, 0.5), 'it springs back where it was');

// A tap still prunes, and the clipping sells.
const coins = world.coins;
const mid = { x: (top.root.x + top.tip.x) / 2, y: (top.root.y + top.tip.y) / 2 };
pointerDown(world, mid.x, mid.y);
pointerUp(world, mid.x, mid.y);
assert.ok(world.coins > coins, 'a tap cuts it');

// Under water its flowers close, and open again once the water's gone.
const flowers = () => plant.stems.filter((s) => s.flower > 0).length;
for (let i = 0; i < 3000; i++) step(world);
assert.ok(flowers() > 0);
const tufts = grass.tufts.length;
world.terrain.cells.fill(WATER);
for (let i = 0; i < 200; i++) step(world);
assert.equal(flowers(), 0, 'no flowers under water');
assert.ok(world.objects.includes(grass) && grass.tufts.length >= tufts, 'grass grows on under water');
world.terrain.cells.fill(EMPTY);
for (let i = 0; i < 200; i++) step(world);
assert.ok(flowers() > 0, 'they open again in the air');

console.log('ok');
