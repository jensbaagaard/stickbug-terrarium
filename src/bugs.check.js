// Run with `node src/bugs.check.js`: bugs walk over the terrain and up and over walls, never through it or on thin
// air, and in the water they float, paddle for the bank and climb out.
import assert from 'node:assert/strict';
import { command, createWorld, pointerDown, pointerUp, startPlacing, step } from './sim.js';
import { cellAt, EMPTY, paintTerrain, WATER } from './terrain.js';
import { pointAt } from './geom.js';

const W = 256;
const H = 341;
const fill = (ter, x0, x1, y0, y1, material) => {
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) paintTerrain(ter, x, y, material, 0, () => 0);
};

{
  // A stone pile, a tall stone wall, and a ledge floating over the floor, which the starting stick runs through.
  const world = createWorld(W, H, { seed: 4 });
  const ter = world.terrain;
  const floor = world.ground.y0;
  for (let k = 0; k < 15; k++) fill(ter, 95 + k * 2, 155 - k * 2, floor - 2 * k - 2, floor - 2 * k, 'stone');
  fill(ter, 200, 208, floor - 70, floor, 'stone');
  fill(ter, 30, 80, floor - 60, floor - 54, 'stone');
  const solid = (x, y) => y >= floor || ![EMPTY, WATER, undefined].includes(ter.cells[cellAt(ter, x, y)]);
  const besideSolid = (p) => [-3, 0, 3].some((dx) => [-3, 0, 3].some((dy) => solid(p.x + dx, p.y + dy)));
  const bug = world.bugs[0];
  let overTheWall = false;
  for (let i = 0; i < 150000; i++) { // 40 minutes: a stick insect takes its time
    if (bug.state === 'idle' && bug.surf) command(world, 'walk');
    step(world);
    if (!bug.surf) continue;
    const body = bug.pts[3];
    assert.ok(!solid(body.x, body.y), 'it never walks through the terrain');
    if (bug.surf.kind === 'terrain') assert.ok(besideSolid(pointAt(bug.surf, bug.s)), 'it never walks on thin air');
    overTheWall ||= body.x > 212;
  }
  assert.ok(overTheWall, 'it climbs up and over the wall');
}

{
  // A pond between two stone banks.
  const world = createWorld(W, H, { seed: 3, scene: false });
  world.coins = 1000;
  const ter = world.terrain;
  const floor = world.ground.y0;
  const wet = (p) => ter.cells[cellAt(ter, p.x, p.y)] === WATER;
  fill(ter, 60, 68, floor - 50, floor, 'stone');
  fill(ter, 190, 198, floor - 50, floor, 'stone');
  const drop = (x, y) => {
    startPlacing(world, 'bug', world.shop.bug.find((o) => !o.sold));
    pointerDown(world, x, y);
    pointerUp(world, x, y);
    return world.bugs.at(-1);
  };
  const outWithin = (bug, ticks) => {
    for (let i = 0; i < ticks; i++) {
      step(world);
      if (bug.surf && !wet(bug.pts[3])) return true;
    }
    return false;
  };

  // Standing on the bottom when the pond fills: it floats up and climbs out.
  const flooded = drop(128, floor - 20);
  for (let i = 0; i < 600; i++) step(world);
  fill(ter, 68, 190, floor - 40, floor, 'water');
  assert.ok(outWithin(flooded, 1800), 'flooded, it floats up and climbs out');

  // Dropped in the middle: it floats at the surface rather than sinking, paddles to a bank and climbs out.
  const dropped = drop(128, floor - 70);
  for (let i = 0; i < 120; i++) step(world);
  assert.ok(Math.abs(dropped.pts[3].y - (floor - 40)) < 4, 'it floats at the surface');
  assert.ok(outWithin(dropped, 1800), 'it paddles to the bank and climbs out');
}

console.log('ok');
