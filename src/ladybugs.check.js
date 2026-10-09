// Run with `node src/ladybugs.check.js`: a ladybug put in flies to a plant or stick and lands on it, aphids settle on
// the plants and breed, a hungry ladybug hunts them down or with none about eats pollen, startled a shy one plays dead
// and a bold one flies off, they save and load, dropped over water one flies off rather than fall in, one in a nook
// behind a wall finds its way round it, in tanks full of caves and nooks none gets stuck, and in a busy tank with a
// pond and a fountain none of them goes hungry or into the water.
import assert from 'node:assert/strict';
import {
  buyReroll,
  createWorld,
  exportWorld,
  importWorld,
  pointerDown,
  pointerMove,
  pointerUp,
  snapshot,
  startPlacing,
  step,
} from './sim.js';
import { ladybugShape, startleLadybugs } from './ladybugs.js';
import { cellAt, EMPTY, paintTerrain, WATER } from './terrain.js';
import { mulberry32 } from './geom.js';
import { stressWorld } from './stress.js';
import { params } from './tuning.js';

const steps = (world, n, each = () => {}) => {
  for (let i = 0; i < n; i++) {
    step(world);
    each();
  }
};
// A ladybug from the shop, let go at (x, y).
const putIn = (world, x, y) => {
  let offer;
  while (!(offer = world.shop.ladybug.find((o) => !o.sold))) buyReroll(world);
  startPlacing(world, 'ladybug', offer);
  pointerDown(world, x, y);
  pointerUp(world, x, y);
  return world.ladybugs.at(-1);
};

{
  // The starting plant, grown, and no aphids yet.
  params.aphids = 0;
  const world = createWorld(256, 341, { seed: 2 });
  world.coins = 1e6;
  const plant = world.objects.find((o) => o.kind === 'plant');
  steps(world, 6000);
  const lady = putIn(world, 40, 80);
  let landed = false;
  steps(world, 1200, () => (landed ||= lady.mode === 'tree'));
  assert.ok(landed, 'put in, it flies to the nearest plant or stick and lands');

  // Aphids settle on it and breed.
  params.aphids = 5;
  let most = 0;
  steps(world, 12000, () => (most = Math.max(most, world.aphids.length)));
  assert.ok(most >= 5, `aphids settle and breed (${most})`);
  assert.ok(world.aphids.every((a) => a.obj === plant));

  // Hungry, it hunts them down.
  params.aphids = 0;
  lady.hunger = 1;
  const before = world.aphids.length;
  steps(world, 4000);
  assert.ok(world.aphids.length < before, `it eats aphids (${before} -> ${world.aphids.length})`);
  assert.ok(lady.hunger < 0.8, 'and is fed');

  // With none left, a hungry one goes to the flowers for pollen.
  world.aphids = [];
  lady.hunger = 1;
  let pollen = false;
  steps(world, 6000, () => (pollen ||= lady.act?.kind === 'pollen'));
  assert.ok(pollen, 'no aphids: it eats pollen');

  // Startled, a shy one drops and plays dead on its back, then gets up again; a bold one flies off.
  lady.genome.boldness = 0;
  steps(world, 600);
  startleLadybugs(world, lady.x, lady.y);
  assert.ok(lady.mode === 'air' && !lady.flying, 'a shy one drops');
  let onBack = false;
  steps(world, 300, () => (onBack ||= lady.mode === 'back'));
  assert.ok(onBack, 'and plays dead');
  steps(world, 600);
  assert.notEqual(lady.mode, 'back', 'then gets up');
  lady.genome.boldness = 1;
  steps(world, 1200);
  startleLadybugs(world, lady.x, lady.y);
  let flew = false;
  steps(world, 60, () => (flew ||= lady.mode === 'air' && lady.flying));
  assert.ok(flew, 'a bold one flies off');

  // Tapped, it's the one shown in the panel. Picked up, it's held; let go, a bold one flies off.
  steps(world, 600);
  pointerDown(world, lady.x, lady.y - 1);
  pointerUp(world, lady.x, lady.y - 1);
  assert.equal(snapshot(world).selected?.name, lady.name, 'tapped, it shows in the panel');
  pointerDown(world, lady.x, lady.y - 1);
  pointerMove(world, lady.x + 10, lady.y - 20);
  step(world);
  assert.equal(lady.mode, 'held', 'picked up');
  pointerUp(world, lady.x, lady.y);
  step(world);
  assert.ok(lady.mode === 'air' && lady.flying, 'let go, it flies off');

  // Saved and loaded, it comes back and lands again.
  const loaded = importWorld(JSON.parse(JSON.stringify(exportWorld(world))), 256, 341);
  assert.deepEqual(
    loaded.ladybugs.map((b) => [b.name, b.genome]),
    [[lady.name, lady.genome]],
    'saved and loaded',
  );
  let back = false;
  steps(loaded, 1200, () => (back ||= loaded.ladybugs[0].mode === 'tree'));
  assert.ok(back, 'and lands again');
  params.aphids = 1;
}

{
  // A shy one, picked up and let go over a pond, drops playing dead, but gets its wings out and flies off before it
  // drops in.
  params.aphids = 0;
  const world = createWorld(256, 341, { seed: 2 });
  world.coins = 1e6;
  const floor = world.ground.y0;
  const paint = (x, y, m) => paintTerrain(world.terrain, x, y, m, 0, () => 0);
  for (let y = floor - 34; y < floor; y += 2) for (const x of [56, 164]) paint(x, y, 'stone');
  for (let y = floor - 30; y < floor; y += 2) for (let x = 60; x < 160; x += 2) paint(x, y, 'water');
  steps(world, 3000);
  const lady = putIn(world, 110, 150);
  steps(world, 900);
  lady.genome.boldness = 0;
  pointerDown(world, lady.x, lady.y - 1);
  pointerMove(world, 110, floor - 60);
  step(world);
  pointerUp(world, 110, floor - 60);
  const wet = () => world.terrain.cells[cellAt(world.terrain, lady.x, lady.y)] === WATER;
  let [dropped, inWater, flew] = [false, false, false];
  steps(world, 300, () => {
    dropped ||= lady.mode === 'air' && !lady.flying;
    inWater ||= wet();
    flew ||= dropped && lady.flying;
  });
  assert.ok(dropped && flew && !inWater, 'it flies off rather than drop in the water');
  params.aphids = 1;
}

{
  // A tall stone wall between a ladybug let go in the nook under an overhang and the only plant: it finds its way out
  // and over the wall, never into it, to the plant.
  params.aphids = 0;
  const world = createWorld(256, 341, { seed: 2 });
  world.coins = 1e6;
  const floor = world.ground.y0;
  const stone = (x, y) => paintTerrain(world.terrain, x, y, 'stone', 0, () => 0);
  for (let y = 120; y < floor; y += 2) for (let x = 140; x < 150; x += 2) stone(x, y);
  for (let x = 20; x < 100; x += 2) for (let y = 200; y < 206; y += 2) stone(x, y);
  steps(world, 3000);
  const plant = world.objects.find((o) => o.kind === 'plant');
  const lady = putIn(world, 60, 225);
  const cell = (x, y) => world.terrain.cells[cellAt(world.terrain, x, y)];
  const rock = (x, y) => y >= floor || ![undefined, EMPTY, WATER].includes(cell(x, y));
  const { len, high } = ladybugShape(lady.genome);
  const body = () => [[0, 1], [0.5 - len / 2, 1], [len / 2 - 0.5, 1], [0, high - 0.5]];
  let [inWall, onPlant] = [0, false];
  steps(world, 6000, () => {
    if (lady.mode === 'air' && body().some(([dx, dy]) => rock(lady.x + dx, lady.y - dy))) inWall++;
    onPlant ||= lady.mode === 'tree' && lady.perch.obj === plant;
  });
  assert.equal(inWall, 0, 'it never flies into the wall');
  assert.ok(onPlant, 'and gets over it to the plant');
  params.aphids = 1;
}

// A tank full of stone shelves and blobs, nooks and caves, with plants and a stick among them and eight ladybugs let go
// at random: none of them gets stuck flying anywhere, or goes hungry. Layout 4 has perches tucked in against the rock,
// layout 5 a pocket sealed off from the rest.
const caves = (layout) => {
  params.aphids = 1;
  const world = createWorld(256, 341, { seed: layout });
  world.coins = 1e9;
  const r = mulberry32(layout);
  const floor = world.ground.y0;
  for (let k = 0; k < 40; k++) {
    const [x0, y0, w, h] = [r() * 256, floor - r() * 170, 6 + r() * 30, 4 + r() * 12];
    for (let y = y0; y < y0 + h; y += 2) {
      for (let x = x0; x < x0 + w; x += 2) paintTerrain(world.terrain, x, y, 'stone', 0, () => 0);
    }
  }
  const place = (kind, type, x, y) => {
    let offer;
    while (!(offer = world.shop[kind].find((o) => !o.sold && (o.type ?? o.kind) === type))) buyReroll(world);
    startPlacing(world, kind, offer);
    pointerDown(world, x, y);
    pointerUp(world, x, y);
  };
  for (const x of [30, 80, 130, 180, 230]) place('plant', 'plant', x, floor - 200);
  place('stick', 'stick', 120, floor - 150);
  steps(world, 4000);
  for (let i = 0; i < 8; i++) place('ladybug', 'ladybug', 20 + i * 30, floor - 40 - r() * 100);
  const flying = world.ladybugs.map(() => 0);
  let longest = 0;
  steps(world, 20000, () =>
    world.ladybugs.forEach((b, i) => {
      flying[i] = b.mode === 'air' ? flying[i] + 1 : 0;
      longest = Math.max(longest, flying[i]);
    }),
  );
  assert.ok(longest < 1800, `layout ${layout}: no flight goes on and on (${longest} ticks)`);
  assert.ok(world.ladybugs.every((b) => b.hunger < 0.9), `layout ${layout}: none goes hungry`);
};
caves(4);
caves(5);

{
  // A tank full of everything, a fountain topping up a pond: they get about it, feed, and don't get stuck in the
  // water or anywhere else.
  const saved = { ...params };
  const world = stressWorld(1);
  const wet = (b) => world.terrain.cells[cellAt(world.terrain, b.x, b.y - 1)] === WATER;
  let soaked = 0;
  steps(world, 20000, () => (soaked += world.ladybugs.filter(wet).length));
  assert.ok(world.ladybugs.every((b) => b.hunger < 0.9), 'none goes hungry');
  assert.ok(soaked / (20000 * world.ladybugs.length) < 0.01, 'or into the water');
  Object.assign(params, saved);
}

console.log('ok');
