// Run with `node src/terrain.check.js`: the falling sand comes to rest once nothing can move (so it stops being
// stepped): dirt stacked in pillars stays put, poured sand slides into a slope, sand held in on a ledge by a kerb
// stays there, and water levels out in a basin; and painting wakes it up again.
import assert from 'node:assert/strict';
import { mulberry32 } from './geom.js';
import { DIRT, EMPTY, makeTerrain, paintTerrain, SAND, stepTerrain, STONE, WATER } from './terrain.js';

const [W, FLOOR] = [256, 335];
const rand = mulberry32(5);
// Steps ter until it rests (or `most` ticks); how many ticks that took, or -1.
const settle = (ter, most = 3000) => {
  for (let t = 1; t <= most; t++) {
    stepTerrain(ter, rand, t);
    if (!ter.active) return t;
  }
  return -1;
};
const count = (ter, m) => ter.cells.filter((c) => c === m).length;
const fill = (ter, c0, c1, r0, r1, m) => {
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) ter.cells[r * ter.cols + c] = m;
  ter.active = true;
};

{
  // Dirt in pillars a cell wide, a gap between each: dirt only ever falls straight down, so they stand, and rest.
  const ter = makeTerrain(W, FLOOR);
  for (let c = 2; c < ter.cols - 2; c += 2) fill(ter, c, c + 1, ter.rows - 12, ter.rows, DIRT);
  const before = ter.cells.slice();
  assert.ok(settle(ter) > 0, 'dirt pillars come to rest');
  assert.deepEqual(ter.cells, before, 'and stand as they were');

  // Painting wakes it up.
  paintTerrain(ter, W / 2, 40, 'sand', 1, rand);
  assert.ok(ter.active, 'painting wakes it');
}

{
  // A column of sand poured in the middle slides into a slope, wider than it was, then rests.
  const ter = makeTerrain(W, FLOOR);
  const mid = ter.cols / 2;
  fill(ter, mid - 2, mid + 2, ter.rows - 60, ter.rows, SAND);
  const sand = count(ter, SAND);
  assert.ok(settle(ter) > 0, 'poured sand comes to rest');
  assert.equal(count(ter, SAND), sand);
  const wide = new Set();
  ter.cells.forEach((m, i) => m === SAND && wide.add(i % ter.cols));
  assert.ok(wide.size > 20, `it slid into a slope (${wide.size} cells wide)`);

  // Sand on a ledge up against a kerb at its end: the drop is diagonally below the grains by the kerb, but they can't
  // slide out past it, so they stay, and it all rests.
  const ledge = makeTerrain(W, FLOOR);
  const r = ledge.rows - 40;
  fill(ledge, 30, 60, r, r + 2, STONE); // the ledge, in mid-air
  fill(ledge, 60, 61, r - 3, r, STONE); // the kerb, standing on nothing past the ledge's end
  fill(ledge, 50, 60, r - 3, r, SAND);
  assert.ok(settle(ledge) > 0, 'sand held in by a kerb comes to rest');
  assert.equal(ledge.cells[(r - 1) * ledge.cols + 59], SAND, 'still against the kerb');
}

{
  // Water poured in at one side of a stone basin, enough to fill it two cells deep, levels out, and rests. (A part
  // filled row never quite rests: its drops keep running about on top.)
  const ter = makeTerrain(W, FLOOR);
  fill(ter, 20, 22, ter.rows - 30, ter.rows, STONE);
  fill(ter, 100, 102, ter.rows - 30, ter.rows, STONE);
  fill(ter, 22, 34, ter.rows - 30, ter.rows - 17, WATER); // 12 by 13 cells: two rows of the 78 across
  assert.ok(settle(ter, 6000) > 0, 'water comes to rest');
  // Level: every column of the basin holds the same depth, give or take a cell.
  const depths = [];
  for (let c = 22; c < 100; c++) {
    let d = 0;
    for (let r = 0; r < ter.rows; r++) d += ter.cells[r * ter.cols + c] === WATER ? 1 : 0;
    depths.push(d);
  }
  const [lo, hi] = [Math.min(...depths), Math.max(...depths)];
  assert.ok(hi - lo <= 1, `it levels out (${lo}..${hi})`);
  assert.equal(count(ter, EMPTY) + count(ter, WATER) + count(ter, STONE), ter.cells.length);
}

console.log('ok');
