// Run with `node src/life.check.js`: old leaves yellow, drop and grow back, fallen leaves lie on the ground or float
// and sink in the water, flowers wilt, drop their petals and flower again, fireflies come to the plants, keep to the
// air and fall into step, bubbles rise only in the water, dust stays in the air, and gusts come along.
import assert from 'node:assert/strict';
import { createWorld, propagatable, step } from './sim.js';
import { cellAt, EMPTY, paintTerrain, WATER } from './terrain.js';
import { wind } from './life.js';
import { params } from './tuning.js';

const steps = (world, n, each = () => {}) => {
  for (let i = 0; i < n; i++) {
    step(world);
    each();
  }
};
const cell = (world, p) => world.terrain.cells[cellAt(world.terrain, p.x, p.y)];
// Water depth px deep on the floor between x0 and x1, walled in with stone.
const pool = (world, x0, x1, depth) => {
  const floor = world.ground.y0;
  const paint = (x, y, m, size) => paintTerrain(world.terrain, x, y, m, size, () => 0);
  for (let y = floor - depth - 4; y < floor; y += 2) for (const x of [x0 - 4, x1 + 4]) paint(x, y, 'stone', 1);
  for (let y = floor - depth; y < floor; y += 2) for (let x = x0; x < x1; x += 2) paint(x, y, 'water', 0);
};

{
  // The starting plant, its leaves living a tenth as long as usual, and its flowers out of the way: they never wilt.
  Object.assign(params, { leafLife: 0.1, bloomLife: 1000 });
  const world = createWorld(256, 341, { seed: 2 });
  const plant = world.objects.find((o) => o.kind === 'plant');
  const leaves = () => plant.stems.flatMap((st) => st.leaves);
  steps(world, 15000); // fully grown
  assert.ok(plant.stems.every((st) => !st.growing));
  const count = leaves().length;
  const fallen = new Set();
  let mostYellowing = 0;
  let seenLying = false;
  steps(world, 20000, () => {
    for (const it of world.litter) fallen.add(it);
    mostYellowing = Math.max(mostYellowing, leaves().filter((l) => l.fade > 0).length);
    seenLying ||= world.litter.some((it) => it.state === 'lie' && it.y > world.ground.y0 - 2);
  });
  assert.ok(fallen.size >= 10, `old leaves drop (${fallen.size})`);
  assert.equal(leaves().length, count, 'and grow back, so the plant keeps its leaves');
  assert.equal(mostYellowing, 1, 'one yellows at a time');
  assert.ok(seenLying, 'they lie on the ground');

  // Left alone, those lying on the ground brown, curl up and are gone in a minute or so.
  params.leafLife = 1000;
  steps(world, 6000);
  assert.equal(world.litter.length, 0, 'fallen leaves are gone in time');

  // One that lands on water floats a while, rippling it, then sinks to the bottom.
  const floor = world.ground.y0;
  pool(world, 60, 160, 40);
  steps(world, 300);
  const look = { shape: 'round', color: { h: 120, s: 50, l: 40 }, grown: 1, scale: 1, flip: 1 };
  const leaf = { x: 110, y: floor - 80, look, state: 'fall', phase: 0, rot: 0, size: 1, life: 1 };
  world.litter.push(leaf);
  let floated = false;
  let rippled = false;
  steps(world, 3000, () => {
    floated ||= leaf.state === 'float' && cell(world, { x: leaf.x, y: leaf.y + 1 }) === WATER;
    rippled ||= world.ripples.length > 0;
  });
  assert.ok(floated && rippled, 'it floats on the water, rippling it');
  assert.equal(leaf.state, 'lie', 'then sinks to the bottom');
  assert.ok(leaf.y > floor - 3);
  Object.assign(params, { leafLife: 1, bloomLife: 1 });
}

{
  // The starting plant's flowers, each open a tenth as long as usual: in time one wilts and drops its petals, and its
  // bare tip buds and flowers again. All the while, the plant can be propagated.
  params.bloomLife = 0.1;
  const world = createWorld(256, 341, { seed: 2 });
  const plant = world.objects.find((o) => o.kind === 'plant');
  steps(world, 15000); // fully grown
  const flower = plant.stems.find((st) => st.bud);
  let [wilted, bare, again, petals, alwaysPropagatable] = [false, false, false, 0, true];
  steps(world, 30000, () => {
    wilted ||= flower.wilt > 0;
    bare ||= wilted && flower.flower === 0;
    again ||= bare && flower.flower === 1;
    petals = Math.max(petals, world.litter.filter((it) => it.look.petal).length);
    alwaysPropagatable &&= propagatable(plant);
  });
  assert.ok(wilted, 'an open flower wilts');
  assert.ok(petals > 0, 'dropping its petals');
  assert.ok(bare && again, 'and its bare tip flowers again');
  assert.ok(alwaysPropagatable, 'the plant can be propagated all along');
  params.bloomLife = 1;
}

{
  // An empty tank: no fireflies or bubbles, just dust.
  const world = createWorld(256, 341, { seed: 3, scene: false });
  steps(world, 3000);
  assert.equal(world.fireflies.length, 0, 'no fireflies without plants');
  assert.equal(world.bubbles.length, 0, 'no bubbles with nothing growing under water');
  assert.ok(world.motes.length > 0 && world.motes.every((m) => cell(world, m) === EMPTY), 'dust drifts in the air');
}

{
  // Fireflies come to the starting plant, keep to the air over it and fall into step. Flooded, it gives off bubbles.
  params.fireflies = 12;
  const world = createWorld(256, 341, { seed: 5 });
  steps(world, 1200);
  let inAir = true;
  steps(world, 6000, () => {
    inAir &&= world.fireflies.every((f) => cell(world, f) === EMPTY);
  });
  assert.equal(world.fireflies.length, 2, 'as many as one plant has room for');
  assert.ok(inAir, 'they keep out of the terrain and water');
  // In step: at a flash, they all flash within a few ticks of each other.
  const apart = (a, b) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
  const [a, b] = world.fireflies;
  assert.ok(apart(a.clock, b.clock) < 0.02, 'they flash together');

  pool(world, 180, 248, 30);
  params.bubbleRate = 0.01; // bubbling hard, to see some soon
  let bubbles = 0;
  steps(world, 3000, () => {
    bubbles = Math.max(bubbles, world.bubbles.length);
    assert.ok(world.bubbles.every((bb) => cell(world, bb) === WATER), 'bubbles are only ever in the water');
  });
  assert.ok(bubbles > 0, 'the plant under water gives off bubbles');
  Object.assign(params, { fireflies: 6, bubbleRate: 0.0005 });
}

{
  // Gusts: now and then the breeze blows far harder than its swell, and with no breeze there's none.
  const world = createWorld(256, 341, { seed: 1, scene: false });
  let strongest = 0;
  for (world.time = 0; world.time < 2400 * 5; world.time++) strongest = Math.max(strongest, Math.abs(wind(world, 128)));
  assert.ok(strongest > 1, `gusts come along (${strongest})`);
  params.breeze = 0;
  assert.equal(wind(world, 128), 0, 'still air');
  params.breeze = 1;
}

console.log('ok');
