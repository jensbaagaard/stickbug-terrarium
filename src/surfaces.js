// The surfaces bugs walk on and things stand on: the sticks' pieces (segments, leafing out as they go), the walkable
// outline traced round the terrain, and the tank floor; where they meet (junctions), and the routes along them.
// Pure data + functions.
import { params } from './tuning.js';
import {
  add,
  clamp,
  closestApproach,
  dist,
  distToSeg,
  dot,
  pointAt,
  project,
  segDir,
  segLength,
  segNormal,
} from './geom.js';
import { CELL, EMPTY, WATER } from './terrain.js';
import { clampS, detach, resetLegs, setState } from './bugs.js';
import { removeObject, wetAt } from './objects.js';

export const JUNCTION_DIST = 6; // surfaces closer than this connect
const FLOOR_SLOPE = 1.2; // surfaces flatter than this catch falling things
const OUTLINE_TOLERANCE = 2.5; // px the walkable outline may stray from the terrain's edge
export const LEAF_GROWTH = 1 / 1200;
const LEAF_SPAWN_CHANCE = 1 / 360;
const LEAF_SPACING = 16;

// ---------- surfaces ----------

export const isFloorLike = (g) => Math.abs(g.y1 - g.y0) <= Math.abs(g.x1 - g.x0) * FLOOR_SLOPE;
export const yAt = (g, x) => g.y0 + ((g.y1 - g.y0) * (x - g.x0)) / (g.x1 - g.x0 || 1);

// Highest floor-like surface at x that is at or below y. The terrain's outline (the open floor included) counts at
// any slope short of a wall: it's the ground. Below everything, the tank floor itself.
export const floorBelow = (world, x, y) => {
  let best = null;
  for (const g of world.branches) {
    if (!(g.kind === 'terrain' ? g.x1 > g.x0 : isFloorLike(g)) || x < g.x0 || x > g.x1) continue;
    const gy = yAt(g, x);
    if (gy >= y && (!best || gy < best.y)) best = { y: gy, g };
  }
  return best ?? { y: world.ground.y0, g: world.ground };
};

// The outline along the open floor at x or, where the terrain covers it, the tank floor itself.
export const floorAt = (world, x) => floorBelow(world, x, world.ground.y0 - 1).g;

// A surface under water all along it: no way for a bug to go.
const submerged = (world, g) => {
  const n = segNormal(g);
  return [0.1, 0.5, 0.9].every((k) => wetAt(world.terrain, add(pointAt(g, k * segLength(g)), n, 1)));
};

export const rebuildJunctions = (world) => {
  const all = world.branches;
  world.junctions = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const c = closestApproach(all[i], all[j]);
      if (c.d <= JUNCTION_DIST) world.junctions.push({ a: all[i], sa: c.sa, b: all[j], sb: c.sb });
    }
  }
};

// BFS over junctions, keeping out of the water. Returns a list of hops ([] if from === to) or null.
export const findRoute = (world, from, to) => {
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length && !prev.has(to)) {
    const cur = queue.shift();
    for (const j of world.junctions) {
      for (const [a, sa, b, sb] of [[j.a, j.sa, j.b, j.sb], [j.b, j.sb, j.a, j.sa]]) {
        if (a !== cur || prev.has(b) || submerged(world, b)) continue;
        prev.set(b, { from: a, sFrom: sa, to: b, sTo: sb });
        queue.push(b);
      }
    }
  }
  if (!prev.has(to)) return null;
  const route = [];
  for (let hop = prev.get(to); hop; hop = prev.get(hop.from)) route.unshift(hop);
  return route;
};

// Every surface reachable from `from` without going through water, in one flood fill.
export const reachable = (world, from) => {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const j of world.junctions) {
      const next = j.a === cur ? j.b : j.b === cur ? j.a : null;
      if (next && !seen.has(next) && !submerged(world, next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
};

// ---------- segments ----------

// Surfaces run left to right so their normal points up. They also remember their root and tip, which way
// they were drawn or grew, for pruning.
export const setEnds = (seg, root, tip) => {
  const [a, b] = tip.x < root.x ? [tip, root] : [root, tip];
  return Object.assign(seg, { root, tip, x0: a.x, y0: a.y, x1: b.x, y1: b.y });
};

export const makeSeg = (world, a, b, extra) => {
  const fit = (p) => ({ x: clamp(p.x, 0, world.W - 1), y: clamp(p.y, 1, world.ground.y0) });
  return setEnds({ leaves: [], obj: null, parent: null, ...extra }, fit(a), fit(b));
};

const maxLeaves = (g) => Math.floor(segLength(g) / LEAF_SPACING);

export const sprinkleLeaves = (world, g, share = 0.5) => {
  for (let i = 0; i < maxLeaves(g) * share; i++) {
    g.leaves.push({ t: 0.1 + 0.8 * world.rand(), size: 0.6 + 0.4 * world.rand(), lean: world.rand() < 0.5 ? -1 : 1 });
  }
};

// Take surfaces out of the world: bugs standing on them fall, and bugs heading for them give up.
export const removeSegments = (world, segs) => {
  const gone = new Set(segs);
  world.branches = world.branches.filter((g) => !gone.has(g));
  for (const obj of world.objects) if (obj.segs) obj.segs = obj.segs.filter((g) => !gone.has(g));
  world.objects = world.objects.filter((obj) => !(obj.segs ?? obj.stems) || (obj.segs ?? obj.stems).length);
  rebuildJunctions(world);
  for (const bug of world.bugs) if (gone.has(bug.surf) || gone.has(bug.transfer?.from)) detach(bug, 'fall');
  replan(world);
  // Whatever stood on a surface that's gone, or that was cut back from under it, comes down too. (The terrain's
  // outline is never cut: rebuildOutline looks after what stands on it.)
  for (const obj of [...world.objects]) {
    const on = obj.on;
    if (!on || on === world.ground || on.kind === 'terrain' || !world.objects.includes(obj)) continue;
    if (gone.has(on) || distToSeg(on, obj.base.x, obj.base.y) > 2) removeObject(world, obj, true);
  }
};

// Surfaces changed shape, so junctions moved: work out every walking bug's route again, or give up if its
// goal is gone or out of reach.
export const replan = (world) => {
  for (const bug of world.bugs) {
    if (!bug.goal || !bug.surf) continue;
    const route = world.branches.includes(bug.goal.surf) ? findRoute(world, bug.surf, bug.goal.surf) : null;
    if (route) {
      bug.route = route;
      continue;
    }
    bug.goal = null;
    bug.route = [];
    if (bug.state === 'walk' || bug.state === 'eat') setState(bug, 'idle', 30);
  }
};

// Everything growing out of seg within its stick.
export const descendants = (seg) => {
  const out = [];
  const visit = (s) => {
    for (const c of seg.obj?.segs ?? []) {
      if (c.parent !== s) continue;
      out.push(c);
      visit(c);
    }
  };
  visit(seg);
  return out;
};

// Cut seg back to p, keeping the root side and the leaves on it.
export const shorten = (seg, p) => {
  const leaves = seg.leaves.map((leaf) => ({ leaf, at: pointAt(seg, leaf.t * segLength(seg)) }));
  setEnds(seg, seg.root, p);
  seg.leaves = leaves
    .filter(({ at }) => distToSeg(seg, at.x, at.y) < 1)
    .map(({ leaf, at }) => ({ ...leaf, t: project(seg, at.x, at.y) / segLength(seg) }));
};

// ---------- the terrain's outline ----------

// Ramer-Douglas-Peucker: keep only the points that stray more than tol from a straight run.
const simplify = (pts, tol) => {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const line = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  let worst = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSeg(line, pts[i].x, pts[i].y);
    if (d > worst) [worst, at] = [d, i];
  }
  if (worst <= tol) return [a, b];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
};

// The terrain's outline, as walkable surfaces: wherever open space (air or water) meets solid ground (the terrain,
// or the tank floor under it). It's traced cell edge by cell edge with the open side on the left, so each run's
// normal points out into the open (and it only ever goes right, up or down), then simplified into a few straight
// runs. Floors, slopes and walls are kept; undersides, which nothing could stand on, are dropped, as are walls with
// no room beside them (in a crack, or up against the tank's side). Unchanged segments keep their old objects, so
// bugs on them don't notice a rebuild.
const outlineSegs = (world, old) => {
  const ter = world.terrain;
  const { cols, rows } = ter;
  const solid = (c, r) => {
    if (r >= rows) return true;
    const m = r >= 0 && c >= 0 && c < cols ? ter.cells[r * cols + c] : EMPTY;
    return m !== EMPTY && m !== WATER;
  };
  const next = new Map(); // corner "c,r" -> the corners its edges lead on to
  const into = new Set(); // corners some edge leads to
  const edge = (c0, r0, c1, r1) => {
    const k = `${c0},${r0}`;
    if (!next.has(k)) next.set(k, []);
    next.get(k).push(`${c1},${r1}`);
    into.add(`${c1},${r1}`);
  };
  // Room beside a wall to stand out from it: a few open cells, inside the tank.
  const room = (c, r, dc) => [1, 2, 3].every((k) => c + dc * k >= 0 && c + dc * k < cols && !solid(c + dc * k, r));
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!solid(c, r)) continue;
      if (!solid(c, r - 1)) edge(c, r, c + 1, r); // a top, going right
      if (room(c, r, -1)) edge(c, r + 1, c, r); // a wall facing left, going up
      if (room(c, r, 1)) edge(c + 1, r, c + 1, r + 1); // a wall facing right, going down
    }
  }
  const follow = (k) => {
    const pts = [];
    for (;;) {
      const [c, r] = k.split(',').map(Number);
      pts.push({ x: Math.min(c * CELL, world.W - 1), y: ter.top + r * CELL });
      if (!next.get(k)?.length) return pts;
      k = next.get(k).pop();
    }
  };
  // Runs from where they start, then whatever's left where two meet corner to corner.
  const runs = [...next.keys()].filter((k) => !into.has(k)).map(follow);
  for (const k of next.keys()) while (next.get(k).length) runs.push(follow(k));
  const reuse = new Map([...old].map((g) => [`${g.root.x},${g.root.y},${g.tip.x},${g.tip.y}`, g]));
  const segs = [];
  for (const run of runs) {
    const pts = simplify(run, OUTLINE_TOLERANCE);
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      if (dist(a, b) < 1) continue;
      segs.push(reuse.get(`${a.x},${a.y},${b.x},${b.y}`) ?? makeSeg(world, a, b, { kind: 'terrain' }));
    }
  }
  return segs;
};

// The terrain moved: redo its outline. Bugs and things planted on outline that changed move onto the new outline
// where they were, or let go and come down if it's gone from under them.
export const rebuildOutline = (world) => {
  const ter = world.terrain;
  ter.skyDirty = false;
  const old = new Set(world.branches.filter((g) => g.kind === 'terrain'));
  const fresh = outlineSegs(world, old);
  const added = fresh.filter((g) => !old.has(g));
  for (const g of fresh) old.delete(g);
  if (!old.size && !added.length) return;
  world.branches = world.branches.filter((g) => g.kind !== 'terrain').concat(fresh);
  rebuildJunctions(world);
  // The new outline nearest p, if it's close enough to be what was there.
  const near = (p) => {
    let best = null;
    for (const g of added) {
      const d = distToSeg(g, p.x, p.y);
      if (d < 3 && (!best || d < best.d)) best = { d, g };
    }
    return best?.g;
  };
  for (const bug of world.bugs) {
    if (!bug.surf || !(old.has(bug.surf) || old.has(bug.transfer?.from))) continue;
    const at = pointAt(bug.surf, bug.s);
    const g = !bug.transfer && near(at);
    if (!g) {
      detach(bug, 'fall');
      continue;
    }
    const facing = dot(segDir(bug.surf), segDir(g)) * bug.dir;
    Object.assign(bug, { surf: g, s: clampS(g, project(g, at.x, at.y), bug.t), dir: facing < 0 ? -1 : 1, step: null });
    resetLegs(bug);
  }
  for (const obj of [...world.objects]) {
    if (!old.has(obj.on)) continue;
    const g = near(obj.base);
    if (g) obj.on = g;
    else removeObject(world, obj, true);
  }
  replan(world);
};

export const growLeaves = (world) => {
  for (const g of world.branches) {
    if (g.kind === 'terrain') continue;
    for (const leaf of g.leaves) leaf.size = Math.min(1, leaf.size + LEAF_GROWTH * params.leafGrowth);
    if (g.leaves.length < maxLeaves(g) && world.rand() < LEAF_SPAWN_CHANCE * params.leafGrowth) {
      g.leaves.push({ t: 0.1 + 0.8 * world.rand(), size: 0, lean: world.rand() < 0.5 ? -1 : 1 });
    }
  }
};
