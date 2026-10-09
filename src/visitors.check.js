// Run with `node src/visitors.check.js`: how much flying life a tank gets goes with how green it is and how much of it
// is air (the starting tank one firefly, the sample tank all of them, a tank full of water none), and visitors come
// when there's what they're after: dragonflies over still water, water striders on it, a bee to the open flowers (it
// leaves with pollen on its legs), and gnats over the plants; but not to a pond still filling up.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld, importWorld, step } from './sim.js';
import { CELL, cellAt, EMPTY, paintTerrain, STONE, WATER } from './terrain.js';
import { params } from './tuning.js';

const sample = JSON.parse(readFileSync(new URL('./samples/tank-1.stickbug.json', import.meta.url))).tank;
const steps = (world, n, each = () => {}) => {
  for (let i = 0; i < n; i++) {
    step(world);
    each();
  }
};
const cell = (world, x, y) => world.terrain.cells[cellAt(world.terrain, x, y)];
// The first thing under p, going down: water, or some terrain.
const below = (world, p) => {
  let y = p.y;
  while (cell(world, p.x, y) === EMPTY && y < world.ground.y0) y++;
  return cell(world, p.x, y);
};

{
  // The starting tank, its one plant: one firefly. The sample tank, a dozen plants, grass and vines: all of them.
  const starting = createWorld(256, 341, { seed: 4 });
  let most = 0;
  steps(starting, 6000, () => (most = Math.max(most, starting.fireflies.length)));
  assert.equal(most, 1, 'one firefly to the starting tank');
  const full = importWorld(sample, sample.W, sample.H, 1);
  most = 0;
  steps(full, 6000, () => (most = Math.max(most, full.fireflies.length)));
  assert.equal(most, params.fireflies, 'the sample tank gets them all');

  // Walled in at the sides (or the water runs out of them) and filled up with water, an aquarium: no fireflies, and
  // nothing flying comes.
  params.visitors = 5;
  const aquarium = importWorld(sample, sample.W, sample.H, 1);
  const { cols, cells } = aquarium.terrain;
  cells.forEach((m, i) => (cells[i] = i % cols === 0 || i % cols === cols - 1 ? STONE : m === EMPTY ? WATER : m));
  let flying = 0;
  steps(aquarium, 6000, () => {
    flying += aquarium.fireflies.length + aquarium.visitors.filter((v) => v.kind !== 'strider').length;
  });
  assert.equal(flying, 0, 'nothing flies in a tank full of water');
}

{
  // The sample tank, visitors coming ten times as often: a dragonfly comes and keeps over the pond, water striders
  // skate on it, gnats dance in the air, and a bee works the flowers and leaves with its legs laden.
  params.visitors = 10;
  const world = importWorld(sample, sample.W, sample.H, 1);
  const seen = { dragonfly: false, strider: false, gnats: false };
  let [overPond, onWater, bee, beeLeftLaden] = [true, true, null, false];
  steps(world, 18000, () => {
    for (const v of world.visitors) {
      seen[v.kind] = true;
      if (v.kind === 'dragonfly' && v.state === 'hover') overPond &&= below(world, v) === WATER;
      if (v.kind === 'strider' && v.state === 'skate') onWater &&= cell(world, v.x, v.y + 1) === WATER;
      if (v.kind === 'bee') bee = v;
    }
    if (bee && !world.visitors.includes(bee)) beeLeftLaden ||= bee.pollen > 0.5;
  });
  assert.ok(seen.dragonfly && overPond, 'a dragonfly comes, and hovers over the pond');
  assert.ok(seen.strider && onWater, 'water striders skate on the water');
  assert.ok(seen.gnats, 'gnats come');
  assert.ok(beeLeftLaden, 'a bee comes, and goes with its legs laden with pollen');
}

{
  // The sample tank walled in at the sides (or the water runs out of them), its pond filling up, a cell higher every
  // hundred ticks: it never lies still, so no dragonfly or water strider comes to it.
  params.visitors = 5;
  const world = importWorld(sample, sample.W, sample.H, 1);
  const { cols, rows, cells, top } = world.terrain;
  cells.forEach((m, i) => (cells[i] = i % cols === 0 || i % cols === cols - 1 ? STONE : m));
  let came = 0;
  steps(world, 6000, () => {
    if (world.time % 100 === 0) {
      for (let i = cols; i < cols * rows; i++) {
        if (cells[i] === WATER && cells[i - cols] === EMPTY) {
          const [x, y] = [(i % cols) * CELL, top + Math.floor(i / cols) * CELL];
          paintTerrain(world.terrain, x, y - CELL, 'water', 0, () => 0);
        }
      }
    }
    came += world.visitors.filter((v) => v.kind === 'dragonfly' || v.kind === 'strider').length;
  });
  assert.equal(came, 0, 'none come to a pond still filling');
}

params.visitors = 1;
console.log('ok');
