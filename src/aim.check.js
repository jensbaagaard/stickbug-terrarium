// Run with `node src/aim.check.js`: what the mark under the pointer says a press would do.
import assert from 'node:assert/strict';
import { aimAt, createWorld, setTool } from './sim.js';

const world = createWorld(240, 320, { seed: 1 });
const pointAt = ({ x, y }) => Object.assign(world, { hover: true, pointer: { x, y } });
const stick = world.branches.find((g) => g.kind === 'stick');
const plant = world.objects.find((o) => o.kind === 'plant');

pointAt(world.bugs[0].pts[3]);
assert.equal(aimAt(world).kind, 'bug');

pointAt({ x: (stick.root.x + stick.tip.x) / 2, y: (stick.root.y + stick.tip.y) / 2 });
assert.equal(aimAt(world).kind, 'cut');
assert.equal(aimAt(world).hit.seg, stick);

setTool(world, 'move');
assert.equal(aimAt(world), null, "sticks can't be relocated");
pointAt({ x: plant.base.x, y: plant.base.y - 2 });
assert.equal(aimAt(world).kind, 'lift');
assert.equal(aimAt(world).obj, plant);

world.hover = false;
assert.equal(aimAt(world), null, 'nothing is marked when the pointer is off the tank');

console.log('ok');
