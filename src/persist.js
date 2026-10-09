// Saving: the whole tank as plain data (exportWorld) and back again (importWorld), fitted to a tank of another size
// if need be; and the sizes a tank comes in. Pure data + functions.
import { MID } from './anatomy.js';
import { clamp, dist, distToSeg, pointAt, project, segDir } from './geom.js';
import { CELL, resizeTerrain } from './terrain.js';
import { newFish } from './fish.js';
import { addFlier } from './fliers.js';
import { createWorld } from './sim.js';
import { floorBelow, makeSeg, rebuildJunctions, rebuildOutline } from './surfaces.js';
import { addBug, placeBug } from './bugs.js';
import { makeOffer, OFFERS } from './shop.js';

const SAVE_VERSION = 1;

// Run-length encoding for the terrain grid: [value, count, value, count, ...].
const rle = (cells) => {
  const out = [];
  for (let i = 0; i < cells.length; ) {
    let n = 1;
    while (i + n < cells.length && cells[i + n] === cells[i]) n++;
    out.push(cells[i], n);
    i += n;
  }
  return out;
};
const unrle = (pairs, n) => {
  const cells = new Uint8Array(n);
  for (let k = 0, i = 0; k < pairs.length; i += pairs[k + 1], k += 2) cells.fill(pairs[k], i, i + pairs[k + 1]);
  return cells;
};

const exportObject = (obj) => {
  const { kind, base } = obj;
  if (kind === 'stick') {
    const segs = obj.segs.map((g) => ({
      root: g.root,
      tip: g.tip,
      parent: obj.segs.indexOf(g.parent),
      depth: g.depth,
      leaves: g.leaves,
    }));
    return { kind, base, hold: obj.hold, style: obj.style, wood: obj.wood, foliage: obj.foliage, segs };
  }
  if (kind === 'plant') {
    const stems = obj.stems.map(({ parent, ...st }) => ({ ...st, parent: obj.stems.indexOf(parent) }));
    return { kind, base, hold: obj.hold, species: obj.species, stems };
  }
  if (kind === 'grass') return { kind, base, genome: obj.genome, tufts: obj.tufts };
  if (kind === 'vine') return { kind, base, genome: obj.genome, hold: obj.hold, nodes: obj.nodes, growth: obj.growth };
  return null;
};

// The whole tank as plain data, for saving: no references, just enough to build it again. Bugs are kept as where
// they stand and which way they face; they start over idle when the tank is loaded.
export const exportWorld = (world) => ({
  version: SAVE_VERSION,
  W: world.W,
  H: world.H,
  time: world.time,
  coins: world.coins,
  clippings: world.clippings ?? 0,
  rerolls: world.rerolls ?? null,
  wallpaper: world.wallpaper,
  wallpapers: world.wallpapers,
  found: world.found,
  shop: world.shop,
  offers: world.offers,
  terrain: {
    cols: world.terrain.cols,
    rows: world.terrain.rows,
    cells: rle(world.terrain.cells),
    tint: rle(world.terrain.tint),
  },
  objects: world.objects.map(exportObject).filter(Boolean),
  bugs: world.bugs.map((bug) => ({
    name: bug.name,
    genes: bug.genes,
    hunger: bug.hunger,
    at: bug.surf ? pointAt(bug.surf, bug.s) : bug.pts[MID],
    standing: !!bug.surf,
    facing: bug.surf ? Math.sign(segDir(bug.surf).x * bug.dir) || 1 : 1,
  })),
  fish: world.fish.map((f) => ({ name: f.name, genome: f.genome, at: { x: f.x, y: f.y }, hunger: f.hunger })),
  fliers: world.fliers.map((b) => ({ name: b.name, genome: b.genome, at: { x: b.x, y: b.y }, hunger: b.hunger })),
});

// The sizes a tank comes in, world px wide and tall (the large one on its side: wider than it's tall), and which
// of them W by H is (null if none).
export const TANK_SIZES = { small: [256, 341], medium: [320, 427], large: [512, 384] };
export const tankSize = (W, H) => {
  const [key] = Object.entries(TANK_SIZES).find(([, [w, h]]) => w === W && h === H) ?? [null];
  return key;
};

// Build a tank from saved data, at this tank's size: everything keeps to the floor and the middle, and what no
// longer fits is lost.
export const importWorld = (data, W, H, seed = undefined) => {
  const world = createWorld(W, H, { seed, scene: false });
  const dy = world.ground.y0 - (data.H - 6);
  const dx = Math.round((W - data.W) / 2 / CELL) * CELL; // whole cells, so the terrain moves with everything else
  const at = (p) => ({ x: clamp(p.x + dx, 0, W - 1), y: p.y + dy });
  Object.assign(world, {
    time: data.time,
    coins: data.coins,
    clippings: data.clippings,
    rerolls: data.rerolls,
    wallpaper: data.wallpaper,
    // Saved before wallpapers were kept: the one up is the start of the collection.
    wallpapers: data.wallpapers ?? (data.wallpaper ? [data.wallpaper] : []),
    found: data.found ?? [],
    shop: data.shop,
    offers: data.offers,
  });
  // Saved before there were fish: stock some. Saved when every flier was a ladybug: they're ladybugs.
  if (world.shop) world.shop.fish ??= Array.from({ length: OFFERS }, () => makeOffer(world, 'fish'));
  const oldLadybug = (genome) => ({ kind: 'ladybug', ...genome });
  for (const o of world.shop?.bug ?? []) {
    if (o.type === 'ladybug') Object.assign(o, { type: 'flier', genome: oldLadybug(o.genome) });
  }
  const t = data.terrain;
  const n = t.cols * t.rows;
  const saved = { cols: t.cols, rows: t.rows, cells: unrle(t.cells, n), tint: unrle(t.tint, n) };
  world.terrain = resizeTerrain(saved, W, world.ground.y0, dx / CELL);
  for (const o of data.objects) {
    const obj = { kind: o.kind, base: at(o.base) };
    if (o.kind === 'stick' || o.kind === 'plant') obj.hold = o.hold && at(o.hold); // standing on the terrain
    if (o.kind === 'stick') {
      Object.assign(obj, { style: o.style ?? 'branch', wood: o.wood, foliage: o.foliage, segs: [] });
      for (const g of o.segs) {
        const extra = { kind: 'stick', obj, parent: obj.segs[g.parent] ?? null, depth: g.depth };
        obj.segs.push(Object.assign(makeSeg(world, at(g.root), at(g.tip), extra), { leaves: g.leaves }));
      }
      world.branches.push(...obj.segs);
    } else if (o.kind === 'plant') {
      obj.species = o.species;
      const fresh = (st) => ({ len: dist(st.root, st.tip), bend: 0, spin: 0, turn: 0, bud: st.flower > 0 });
      obj.stems = o.stems.map((st) => ({ ...fresh(st), ...st, root: at(st.root), tip: at(st.tip) }));
      obj.stems.forEach((st) => (st.parent = obj.stems[st.parent] ?? null));
    } else if (o.kind === 'grass') {
      Object.assign(obj, { genome: o.genome, tufts: o.tufts.map((tuft) => ({ ...tuft, ...at(tuft) })) });
    } else if (o.kind === 'vine') {
      const nodes = o.nodes.map((p) => ({ ...at(p), px: p.px + dx, py: p.py + dy }));
      Object.assign(obj, { genome: o.genome, hold: o.hold && at(o.hold), nodes, growth: o.growth });
    }
    world.objects.push(obj);
  }
  rebuildJunctions(world);
  rebuildOutline(world);
  // What each thing stands on (or hangs from), now the surfaces are back.
  for (const obj of world.objects) {
    if ((obj.kind === 'stick' || obj.kind === 'plant') && !obj.hold) {
      obj.on = floorBelow(world, obj.base.x, obj.base.y - 0.5).g;
    }
    if (obj.kind === 'vine' && !obj.hold && obj.base.y > 4) {
      obj.on = world.branches.find((g) => g.kind !== 'terrain' && distToSeg(g, obj.base.x, obj.base.y) < 3) ?? null;
    }
  }
  for (const b of data.bugs) {
    const p = at(b.at);
    let near = null;
    for (const g of b.standing ? world.branches : []) {
      const d = distToSeg(g, p.x, p.y);
      if (d < 4 && (!near || d < near.d)) near = { d, g };
    }
    const bug = near
      ? placeBug(world, near.g, project(near.g, p.x, p.y), Math.sign(segDir(near.g).x || 1) * b.facing, b.genes)
      : addBug(world, p.x, p.y - 10, b.genes);
    if (bug) Object.assign(bug, { name: b.name, hunger: b.hunger });
  }
  for (const f of data.fish ?? []) {
    const { x, y } = at(f.at);
    world.fish.push(Object.assign(newFish(world, x, y, f.genome, f.name), { hunger: f.hunger }));
  }
  // Fliers come back in the air where they were, and fly to the nearest place to land.
  for (const b of data.fliers ?? data.ladybugs ?? []) {
    const { x, y } = at(b.at);
    addFlier(world, x, y - 2, oldLadybug(b.genome), b.name).hunger = b.hunger;
  }
  return world;
};
