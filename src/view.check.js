// Run with `node src/view.check.js`: the zoom keeps the point zoomed about under the pointer, steps through ZOOMS and
// stops at either end, and never shows anything outside the tank.
import assert from 'node:assert/strict';
import { UNZOOMED, ZOOMS, clampView, nextZoom, panBy, zoomAbout, zoomMiddle } from './view.js';

const [W, H] = [256, 341];
const onScreen = (v, x, y) => [(x - v.x) * v.z, (y - v.y) * v.z]; // where world (x, y) shows, in 1:1 px
const inside = (v) => v.x >= 0 && v.y >= 0 && v.x + W / v.z <= W && v.y + H / v.z <= H;

assert.equal(nextZoom(1, 1), 2);
assert.equal(nextZoom(1, -1), 1, 'no zooming out past 1:1');
assert.equal(nextZoom(ZOOMS.at(-1), 1), ZOOMS.at(-1), 'nor in past the most');

// Zoomed in about a point well inside, it stays where it was on screen, all the way in and back out.
let v = UNZOOMED;
for (const dir of [1, 1, 1, -1, -1, -1]) {
  const was = onScreen(v, 100, 150);
  v = zoomAbout(v, nextZoom(v.z, dir), 100, 150, W, H);
  assert.deepEqual(onScreen(v, 100, 150), was, `zoomed to ${v.z}, the point stays put`);
  assert.ok(inside(v));
}
assert.deepEqual(v, UNZOOMED, 'and all the way out, the whole tank shows again');

// Zoomed out about the top left of a view in the bottom right corner, the view stops at the tank's edge.
v = clampView({ z: 8, x: W, y: H }, W, H);
v = zoomAbout(v, 2, v.x, v.y, W, H);
assert.ok(inside(v));
assert.equal(v.x + W / 2, W, 'pinned to the right');
assert.equal(v.y + H / 2, H, 'and the bottom');

// Moved, it goes as far as the edge and no further.
v = panBy(zoomAbout(UNZOOMED, 2, 128, 170, W, H), -1000, 5, W, H);
assert.equal(v.x, 0);
assert.ok(inside(v));
assert.deepEqual(clampView({ z: 8, x: 999, y: -5 }, W, H), { z: 8, x: W - W / 8, y: 0 });

// Zoomed out from the middle of the view, what was in the middle still is.
v = zoomAbout(UNZOOMED, 8, 120, 160, W, H);
const middle = [v.x + W / 16, v.y + H / 16];
v = zoomMiddle(v, 4, W, H);
assert.deepEqual([v.x + W / 8, v.y + H / 8], middle);

console.log('ok');
