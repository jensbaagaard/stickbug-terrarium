// Run with `node src/fish.check.js`: guppies keep to the water, school (turning as one) and play tag, eat when fed,
// dart off when startled, and flop back into the water when stranded.
import assert from 'node:assert/strict';
import { createWorld, feedFish, pointerDown, pointerUp, startPlacing, step } from './sim.js';
import { wet } from './fish.js';
import { paintTerrain } from './terrain.js';

const world = createWorld(256, 341, { seed: 3, scene: false });
world.coins = 1000;
const floor = world.ground.y0;
const steps = (n) => {
  for (let i = 0; i < n; i++) step(world);
};
// A pool between two stone walls, with dry floor beyond them.
for (let y = floor - 70; y < floor; y += 2) {
  paintTerrain(world.terrain, 40, y, 'stone', 2, () => 0);
  paintTerrain(world.terrain, 216, y, 'stone', 2, () => 0);
}
for (let y = floor - 60; y < floor; y += 2) {
  for (let x = 46; x < 211; x += 2) paintTerrain(world.terrain, x, y, 'water', 0, () => 0);
}
steps(300);

// Bought from the shop and let go in the pool.
for (const [i, offer] of world.shop.fish.entries()) {
  startPlacing(world, 'fish', offer);
  pointerDown(world, 80 + i * 30, floor - 30);
  pointerUp(world, 80 + i * 30, floor - 30);
}
assert.equal(world.fish.length, 4);

// They keep to the water, and now and then form up into a school, which turns as one, or play tag.
const seen = new Set();
const schooling = { inStep: 0, all: 0 };
for (let i = 0; i < 18000; i++) {
  step(world);
  assert.ok(world.fish.every((f) => wet(world, f.x, f.y)), 'every fish stays in the water');
  for (const f of world.fish) {
    seen.add(f.goal?.kind);
    const lead = f.goal?.kind === 'school' && f.goal.leader;
    if (lead?.goal?.kind !== 'lead' || f.turn || lead.turn) continue;
    schooling.all++;
    if (f.facing === lead.facing) schooling.inStep++;
  }
}
assert.ok(seen.has('school') && seen.has('tag'), 'they school and play');
assert.ok(schooling.inStep > schooling.all * 0.95, 'a school turns as one'); // a fish just joining lags a tick

// Fed, they eat.
const hunger = () => world.fish.reduce((sum, f) => sum + f.hunger, 0);
const before = hunger();
feedFish(world);
steps(1200);
assert.ok(hunger() < before - 0.2, 'they ate the flakes');

// A tap close beside one (not on it, which picks it out) sends it darting off, out into the open water.
const [fish] = world.fish;
const from = { x: fish.x, y: fish.y };
const tap = fish.x + (fish.x < 128 ? -14 : 14);
pointerDown(world, tap, fish.y);
pointerUp(world, tap, fish.y);
steps(40);
assert.ok(Math.hypot(fish.x - from.x, fish.y - from.y) > 15, 'it darts away');

// A tap on it picks it out, to look at.
steps(120);
pointerDown(world, fish.x, fish.y);
pointerUp(world, fish.x, fish.y);
assert.equal(world.selected, fish);

// Dropped on the dry floor beyond the wall, it flops about, hopping toward the water.
const drop = (x, y) => {
  world.held = { fish };
  world.pointer = { x, y };
  steps(2); // held still there a moment, so it isn't thrown
  world.held = null;
};
drop(12, floor - 10);
steps(600);
assert.ok(!wet(world, fish.x, fish.y) && fish.x > 24, 'it hops toward the water, up against the wall');

// Dropped over the pool, it falls in and swims again.
drop(120, floor - 90);
steps(120);
assert.ok(wet(world, fish.x, fish.y), "it's back in the water");

console.log('ok');
