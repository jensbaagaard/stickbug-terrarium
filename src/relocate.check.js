// Run with `node src/relocate.check.js`: Relocate drags a stick somewhere else, and everything on it comes along, the
// bugs walking on it included; it keeps clear of the glass at the sides, and any of it that would poke out of the
// top of the tank is cut off there.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld, importWorld, pointerDown, pointerUp, setTool, step } from './sim.js';
import { distToSeg } from './geom.js';
import { MID } from './anatomy.js';
import { STONE } from './terrain.js';

const sample = JSON.parse(readFileSync(new URL('./samples/tank-1.stickbug.json', import.meta.url))).tank;
const middleOf = (g) => ({ x: (g.root.x + g.tip.x) / 2, y: (g.root.y + g.tip.y) / 2 });
const drag = (world, from, dx, dy) => {
  setTool(world, 'move');
  pointerDown(world, from.x, from.y);
  pointerUp(world, from.x + dx, from.y + dy);
};
const inside = (world, stick) => stick.segs.every((g) => g.x0 >= 2 && g.x1 <= world.W - 3);

{
  // The sample tank's stick, both bugs on it: dragged across, it lands on what's below, and they come along.
  const world = importWorld(sample, sample.W, sample.H, 1);
  for (let i = 0; i < 300; i++) step(world);
  const stick = world.objects.find((o) => o.kind === 'stick');
  const riders = world.bugs.filter((b) => stick.segs.includes(b.surf));
  assert.ok(riders.length, 'bugs on the stick to begin with');
  const was = { ...stick.base };
  const low = world.ground.y0 - 30 - stick.base.y; // let go low down, so it has something to land on
  drag(world, middleOf(stick.segs[0]), -60, low);
  assert.ok(Math.abs(stick.base.x - (was.x - 60)) < 1, 'the stick moves as far as the pointer did');
  assert.ok(inside(world, stick), 'inside the tank');
  for (const bug of riders) {
    assert.ok(stick.segs.includes(bug.surf), 'its bugs stay on it');
    assert.ok(distToSeg(bug.surf, bug.pts[MID].x, bug.pts[MID].y) < 12, 'and moved with it');
  }
  for (let i = 0; i < 600; i++) step(world);
  assert.equal(world.bugs.length, 2);

  // Dragged far off to the side, it stops at the glass.
  drag(world, middleOf(stick.segs[0]), 600, world.ground.y0 - 30 - stick.base.y);
  assert.ok(inside(world, stick), 'it keeps clear of the glass');
}

{
  // The starting stick put up on a shelf near the top of the tank: what would poke out at the top is cut off.
  const world = createWorld(256, 341, { seed: 1 });
  const { cols, cells, top } = world.terrain;
  const shelf = 40; // px from the top
  for (let r = Math.floor((shelf - top) / 2); r < Math.floor((shelf - top) / 2) + 3; r++) {
    for (let c = 0; c < cols; c++) cells[r * cols + c] = STONE;
  }
  world.terrain.skyDirty = true;
  step(world);
  const stick = world.objects.find((o) => o.kind === 'stick');
  const from = middleOf(stick.segs[0]);
  drag(world, from, 60, shelf - 6 - stick.base.y); // its foot let go just over the shelf
  assert.ok(Math.abs(stick.base.y - shelf) <= 2, 'it stands on the shelf');
  assert.ok(stick.segs.length > 0, 'some of it is left');
  assert.ok(stick.segs.every((g) => Math.min(g.root.y, g.tip.y) >= 3.99), 'none of it pokes out of the top');
  assert.ok(world.debris.length > 0, 'what was cut off falls');
}

console.log('ok');
