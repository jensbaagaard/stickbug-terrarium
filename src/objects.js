// The things put in the tank (sticks, plants, grass and vines): where something put down stands or hangs, putting
// it in and taking it out, and what holds it up. Pure data + functions.
import { clamp, dist, pointAt, project } from './geom.js';
import { CELL, cellAt, DIRT, EMPTY, SAND, WATER } from './terrain.js';
import { isFloorLike, makeSeg, rebuildJunctions, removeSegments, sprinkleLeaves, yAt } from './surfaces.js';
import { seedling } from './plants.js';
import { fling } from './effects.js';

const VINE_REACH = 14; // px: a vine hangs from anything this close to where you tap
const PLACE_REACH = 50; // px: plants and sticks land on the first thing at most this far below where you tap

// Where a vine hung near (x, y) hangs from: the nearest branch or stick, or underside or face of the terrain,
// or else the top of the tank. The top of the terrain is no place to hang from: the vine would just lie on it.
export const vineAnchor = (world, x, y) => {
  let best = null;
  for (const g of world.branches) {
    if (g.kind === 'terrain') continue;
    const q = pointAt(g, project(g, x, y));
    const d = dist(q, { x, y });
    if (d < VINE_REACH && (!best || d < best.d)) best = { d, q, g };
  }
  const hook = terrainHook(world, x, y);
  if (hook && (!best || hook.d < best.d)) return { base: hook.at, hold: hook.hold, on: null };
  // Hang from just under a branch, so the vine trails down rather than resting on top of it.
  const base = best ? { x: best.q.x, y: best.q.y + 1.5 } : { x: clamp(x, 2, world.W - 3), y: 1 };
  return { base, on: best?.g ?? null };
};

// Where something put down at (x, y) stands: straight down from there, the first of the top of a stick, the
// terrain (to the cell, so caves and ledges count; from inside it, its top) or the tank floor, if that's within
// PLACE_REACH. On the terrain it remembers the cell holding it up (hold) and comes down if that goes. Null if
// there's nothing near enough. A stick being moved doesn't stand on itself: skip is its surfaces.
export const standAt = (world, x, y, skip = null) => {
  const gx = clamp(x, 3, world.W - 4);
  const top = groundTop(world, gx, y);
  let best = { y: top, on: top >= world.ground.y0 ? world.ground : null };
  for (const g of world.branches) {
    if (g.kind === 'terrain' || skip?.has(g) || !isFloorLike(g) || gx < g.x0 || gx > g.x1) continue;
    const gy = yAt(g, gx);
    if (gy >= y && gy < best.y) best = { y: gy, on: g };
  }
  if (best.y - y > PLACE_REACH) return null;
  const base = { x: gx, y: best.y };
  return best.on ? { base, on: best.on } : { base, on: null, hold: { x: gx, y: best.y + CELL / 2 } };
};

export const addDecor = (world, spec) => {
  const obj = { kind: spec.kind, base: spec.base, on: spec.on, hold: spec.hold };
  if (spec.kind === 'stick') {
    Object.assign(obj, { style: spec.style ?? 'branch', wood: spec.wood, foliage: spec.foliage });
    const segs = [];
    for (const p of spec.pieces) {
      segs.push(makeSeg(world, p.a, p.b, { kind: 'stick', obj, parent: segs[p.parent] ?? null, depth: p.depth }));
    }
    obj.segs = segs.filter((g) => dist(g.root, g.tip) >= 3);
    for (const g of obj.segs) sprinkleLeaves(world, g, 0.6);
  } else if (spec.kind === 'grass') {
    const tuft = { x: spec.base.x, y: spec.base.y, size: 0.3, seed: world.rand() * 1000, dying: false };
    Object.assign(obj, { genome: spec.genome, tufts: [tuft] });
  } else if (spec.kind === 'vine') {
    const { x, y } = spec.base;
    Object.assign(obj, { genome: spec.genome, hold: spec.hold, nodes: [{ x, y, px: x, py: y }], growth: 0 });
  } else {
    obj.species = spec.species;
    obj.stems = [];
    obj.stems.push(seedling(world, obj));
  }
  world.objects.push(obj);
  if (obj.segs) {
    world.branches.push(...obj.segs);
    rebuildJunctions(world);
  }
  return obj;
};

// Plants and sticks standing on the terrain come down if the cell holding them goes, or they're buried.
export const checkFooting = (world) => {
  const ter = world.terrain;
  for (const obj of [...world.objects]) {
    if (!obj.hold || obj.kind === 'vine' || !world.objects.includes(obj)) continue;
    const buried = solidAt(ter, obj.base.x, obj.base.y - 3);
    if (buried || !solidAt(ter, obj.hold.x, obj.hold.y)) removeObject(world, obj, true);
  }
};

// Take an object out. Knocked-down sticks, plants and vines tumble to the floor as debris.
export const removeObject = (world, obj, knocked = false) => {
  world.objects = world.objects.filter((o) => o !== obj);
  if (knocked && obj.kind === 'stick') {
    for (const g of obj.segs) fling(world, g.root, g.tip, { kind: 'stick', wood: obj.wood });
  }
  if (knocked && obj.kind === 'plant') {
    for (const st of obj.stems) fling(world, st.root, st.tip, { kind: 'stem', plant: obj });
  }
  if (knocked && obj.kind === 'vine') {
    const look = { kind: 'vine', vine: obj };
    for (let i = 2; i < obj.nodes.length; i += 2) fling(world, obj.nodes[i - 2], obj.nodes[i], look);
  }
  if (obj.segs) removeSegments(world, obj.segs);
};

// ---------- the terrain under things ----------

// Is (x, y) ground that grass can grow in: painted dirt or sand, or the bare tank floor?
export const isSoil = (world, x, y) => {
  const ter = world.terrain;
  const i = cellAt(ter, x, y + 1);
  if (i >= 0 && ter.cells[i] !== EMPTY) return ter.cells[i] === DIRT || ter.cells[i] === SAND;
  return Math.abs(y - world.ground.y0) < 1;
};

// The top of the ground at x, at or below y, to the cell: the first solid cell going down, or the tank floor.
// From inside the terrain or the floor strip under it, the top of that solid stretch instead. Grass needs this
// rather than the walkable outline, which smooths over bumps and can float a cell above the dirt.
export const groundTop = (world, x, y) => {
  const ter = world.terrain;
  const c = clamp(Math.floor(x / CELL), 0, ter.cols - 1);
  const solid = (r) => ter.cells[r * ter.cols + c] !== EMPTY && ter.cells[r * ter.cols + c] !== WATER;
  let r = clamp(Math.floor((y - ter.top) / CELL), 0, ter.rows - 1);
  if (solid(r)) {
    while (r > 0 && solid(r - 1)) r--;
  } else {
    while (r < ter.rows && !solid(r)) r++;
  }
  return ter.top + r * CELL; // ter.rows down is the floor
};

// Is the column at x solid (terrain or the floor) all the way down from y0 to y1? Then grass at one end can
// spread to the other: it's the face of a pile, not a ledge with a gap under it.
export const faceAt = (world, x, y0, y1) => {
  for (let y = y0 + CELL / 2; y < Math.min(y1, world.ground.y0); y += CELL) {
    if (!solidAt(world.terrain, x, y)) return false;
  }
  return true;
};

// Where grass sown near (x, y) takes root: whatever ground is below, within PLACE_REACH, whether or not it's
// soil. Null if there's none.
export const sowAt = (world, x, y) => {
  const gx = clamp(x, 3, world.W - 4);
  const gy = groundTop(world, gx, y);
  return gy - y > PLACE_REACH ? null : { base: { x: gx, y: gy }, on: null }; // tufts mind their own soil
};

export const solidAt = (ter, x, y) => {
  const i = cellAt(ter, x, y);
  return i >= 0 && ter.cells[i] !== EMPTY && ter.cells[i] !== WATER;
};

export const wetAt = (ter, p) => ter.cells[cellAt(ter, p.x, p.y)] === WATER;

// Where to hang a vine off the terrain near (x, y): under a solid cell with open space below it (an overhang
// or a ledge), or against the face of one with open space beside and below it. at is where it hangs from,
// hold the middle of the cell holding it.
const terrainHook = (world, x, y) => {
  const ter = world.terrain;
  const reach = Math.ceil(VINE_REACH / CELL);
  const c0 = Math.floor(x / CELL);
  const r0 = Math.floor((y - ter.top) / CELL);
  const solid = (c, r) =>
    c >= 0 && c < ter.cols && r >= 0 && r < ter.rows && solidAt(ter, (c + 0.5) * CELL, ter.top + (r + 0.5) * CELL);
  let best = null;
  for (let r = Math.max(0, r0 - reach); r <= Math.min(ter.rows - 2, r0 + reach); r++) {
    for (let c = c0 - reach; c <= c0 + reach; c++) {
      if (!solid(c, r)) continue;
      const hold = { x: (c + 0.5) * CELL, y: ter.top + (r + 0.5) * CELL };
      const spots = [];
      if (!solid(c, r + 1)) spots.push({ x: hold.x, y: ter.top + (r + 1) * CELL + 0.5 });
      for (const dc of [-1, 1]) {
        if (solid(c + dc, r) || solid(c + dc, r + 1)) continue;
        spots.push({ x: dc < 0 ? c * CELL - 0.5 : (c + 1) * CELL + 0.5, y: hold.y });
      }
      for (const at of spots) {
        const d = dist(at, { x, y });
        if (d < VINE_REACH && (!best || d < best.d)) best = { d, at, hold };
      }
    }
  }
  return best;
};
