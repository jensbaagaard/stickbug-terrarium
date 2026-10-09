// The pointer and the tools: picking up and dragging bugs, fish and fliers, pulling plants about, pruning (a tap or a
// dragged cut), painting the terrain, putting in what's bought, relocating plants and sticks, and propagating; and
// what a press would do, for the marks under the pointer (aimAt). Pure data + functions.
import { SEGMENTS } from './anatomy.js';
import { clamp, dist, distToSeg, lerp, pointAt, project, segIntersect } from './geom.js';
import { CELL, paintTerrain } from './terrain.js';
import { fishAt, startle } from './fish.js';
import { startleVisitors } from './visitors.js';
import { flierAt, letGo, startleFliers } from './fliers.js';
import { descendants, rebuildJunctions, removeSegments, replan, setEnds, shorten } from './surfaces.js';
import { clampS, detach, resetLegs, setState } from './bugs.js';
import { crownFull, mow, prunePlant, pruneVine, seedling } from './plants.js';
import { addDecor, groundTop, sowAt, standAt, vineAnchor } from './objects.js';
import { placeItem } from './shop.js';
import { fling } from './effects.js';

const GRAB_RADIUS = 16;
const PRESS_SLOP = 3; // a press that moves further than this grabs the creature (else selects it) or pulls the plant
const TAP_SLOP = 8; // a press that moves less than this is a tap

// ---------- tools and the brush ----------

export const setBrush = (world, brush) => Object.assign(world.brush, brush);

export const paintAt = (world, p) =>
  paintTerrain(world.terrain, p.x, p.y, world.brush.material, world.brush.size, world.rand);

export const setTool = (world, tool) => {
  if (tool !== world.tool) world.demo = tool === 'hand' ? null : { kind: tool, at: world.time };
  Object.assign(world, { tool, placing: null, painting: false, moving: null });
};

// ---------- pruning ----------

// Prune a stick's seg at p: it's cut back to p, and everything growing out of it beyond the cut falls.
const pruneSegment = (world, seg, p) => {
  const look = { kind: 'stick', wood: seg.obj.wood };
  const doomed = descendants(seg);
  for (const g of doomed) fling(world, g.root, g.tip, look);
  fling(world, p, seg.tip, look);
  // Bugs standing on the part that's cut off fall with it; the rest shuffle onto what's left.
  const keep = dist(seg.root, p);
  const riders = world.bugs.filter((bug) => bug.surf === seg);
  for (const bug of riders) if (dist(seg.root, pointAt(seg, bug.s)) > keep) detach(bug, 'fall');
  if (keep < 3) doomed.push(seg);
  else shorten(seg, p);
  removeSegments(world, doomed);
  for (const bug of riders) {
    if (bug.surf !== seg) continue;
    const s = clampS(seg, bug.s, bug.t);
    if (Math.abs(s - bug.s) > 1) resetLegs(bug);
    bug.s = s;
  }
};

// The closest prunable thing within reach of (x, y).
const prunableAt = (world, x, y, plantsOnly = false) => {
  let best = null;
  const consider = (d, hit) => {
    if (!best || d < best.d) best = { d, ...hit };
  };
  for (const seg of world.branches) {
    if (seg.kind === 'terrain' || plantsOnly) continue;
    const d = distToSeg(seg, x, y);
    if (d < 5) consider(d, { seg, p: pointAt(seg, project(seg, x, y)) });
  }
  for (const obj of world.objects) {
    if (obj.kind === 'grass') {
      for (const tuft of obj.tufts) {
        const top = tuft.y - obj.genome.height * tuft.size;
        const d = Math.hypot(tuft.x - x, Math.max(0, top - y, y - tuft.y));
        if (d < 4) consider(d + 0.5, { grass: obj, p: { x, y } });
      }
    }
    if (obj.kind === 'vine') {
      for (let i = 1; i < obj.nodes.length; i++) {
        const [a, b] = [obj.nodes[i - 1], obj.nodes[i]];
        const d = distToSeg({ x0: a.x, y0: a.y, x1: b.x, y1: b.y }, x, y);
        if (d < 4) consider(d, { vine: obj, at: i, p: { x, y } });
      }
    }
    if (obj.kind !== 'plant') continue;
    for (const stem of obj.stems) {
      const g = { x0: stem.root.x, y0: stem.root.y, x1: stem.tip.x, y1: stem.tip.y };
      const d = distToSeg(g, x, y);
      const wide = stem.role === 'leaf' ? obj.species.leafWidth * 0.6 : 0; // a clump plant's broad leaves
      if (d < 4 + wide) consider(d, { plant: obj, stem, p: pointAt(g, project(g, x, y)) });
    }
  }
  return best;
};

const pruneHit = (world, hit) => {
  if (hit.grass) return mow(world, hit.grass, hit.p.x, hit.p.y);
  if (hit.vine) return pruneVine(world, hit.vine, hit.at);
  return hit.plant ? prunePlant(world, hit.plant, hit.stem, hit.p) : pruneSegment(world, hit.seg, hit.p);
};

// Cut everything a dragged line crosses, like trimming a hedge.
const cutAlong = (world, line) => {
  for (const seg of [...world.branches]) {
    if (seg.kind === 'terrain' || !world.branches.includes(seg)) continue;
    const p = segIntersect(seg, line);
    if (p) pruneSegment(world, seg, p);
  }
  for (const obj of world.objects.filter((o) => o.kind === 'grass' || o.kind === 'vine')) {
    if (obj.kind === 'vine') {
      const link = (a, b) => ({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
      const i = obj.nodes.findIndex((b, k) => k > 0 && segIntersect(link(obj.nodes[k - 1], b), line));
      if (i > 0) pruneVine(world, obj, i);
      continue;
    }
    for (const tuft of obj.tufts) {
      const blade = { x0: tuft.x, y0: tuft.y, x1: tuft.x, y1: tuft.y - obj.genome.height * tuft.size };
      const p = segIntersect(blade, line);
      if (p) mow(world, obj, p.x, p.y, 1);
    }
  }
  for (const plant of world.objects.filter((o) => o.kind === 'plant')) {
    for (const stem of [...plant.stems]) {
      if (!plant.stems.includes(stem)) continue;
      const p = segIntersect({ x0: stem.root.x, y0: stem.root.y, x1: stem.tip.x, y1: stem.tip.y }, line);
      if (p) prunePlant(world, plant, stem, p);
    }
  }
};

// ---------- input ----------

const bugAt = (world, x, y) => {
  let best = GRAB_RADIUS ** 2;
  let hit = null;
  for (const bug of world.bugs) {
    for (let i = 0; i < SEGMENTS; i++) {
      const d2 = (bug.pts[i].x - x) ** 2 + (bug.pts[i].y - y) ** 2;
      if (d2 < best) [best, hit] = [d2, { bug, i, d: Math.sqrt(d2) }];
    }
  }
  return hit;
};

// The bug, fish or flier nearest (x, y), within reach.
const creatureAt = (world, x, y) => {
  const hits = [bugAt(world, x, y), fishAt(world, x, y), flierAt(world, x, y)].filter(Boolean);
  return hits.reduce((a, h) => (!a || h.d < a.d ? h : a), null);
};

export const pointerDown = (world, x, y) => {
  world.pointer = { x, y };
  world.demo = null; // they've got the idea
  if (world.tool === 'paint') {
    world.painting = true;
    return paintAt(world, world.pointer);
  }
  if (world.placing) return placeItem(world, x, y);
  if (world.tool === 'move') {
    const obj = liftable(prunableAt(world, x, y));
    if (obj) world.moving = { obj, x, y };
    return;
  }
  if (world.tool === 'propagate') {
    // Two taps: one on a grown plant to take a cutting from, one where its seedling goes. Tapping the plant
    // again puts it back.
    const plant = prunableAt(world, x, y, true)?.plant;
    const picked = world.moving?.obj;
    if (!picked) {
      if (plant && propagatable(plant)) world.moving = { obj: plant, x, y };
    } else if (plant === picked) {
      world.moving = null;
    } else {
      const to = standAt(world, x, y);
      if (!to) return; // nowhere to plant it there: keep it picked
      world.moving = null;
      if (world.objects.includes(picked) && propagatable(picked)) propagate(world, picked, to);
    }
    return;
  }
  if (world.tool === 'prune') {
    world.cut = { x0: x, y0: y, x1: x, y1: y };
    return;
  }
  const hit = creatureAt(world, x, y);
  if (hit) world.press = { ...hit, x, y };
  else world.touch = { x, y, hit: prunableAt(world, x, y, true) }; // a plant there, to pull if it's dragged
  if (!hit?.fish) startle(world, x, y); // a tap on the glass
  if (!hit?.flier) startleFliers(world, x, y);
  startleVisitors(world, x, y);
};

// Take hold of a plant, vine or grass where it was pressed (hit, as prunableAt gives it), to pull it about: a
// plant by the stem, a vine by the node below, grass where it was grabbed.
const grab = (hit) => {
  const off = (p) => ({ x: p.x - hit.p.x, y: p.y - hit.p.y });
  if (hit.plant) return { obj: hit.plant, stem: hit.stem, off: off(hit.stem.tip) };
  if (hit.vine) return { obj: hit.vine, i: hit.at, off: off(hit.vine.nodes[hit.at]) };
  return { obj: hit.grass, x: hit.p.x };
};

export const pointerMove = (world, x, y) => {
  const last = world.pointer;
  world.pointer = { x, y };
  if (world.painting) {
    // Paint along the way so a quick stroke leaves no gaps.
    const n = Math.ceil(dist(last, world.pointer) / CELL);
    for (let i = 1; i <= n; i++) paintAt(world, lerp(last, world.pointer, i / n));
    return;
  }
  const press = world.press;
  if (press && Math.hypot(x - press.x, y - press.y) > PRESS_SLOP) {
    world.press = null;
    if (press.fish) {
      world.held = { fish: press.fish };
    } else if (press.flier) {
      world.held = { flier: press.flier };
    } else {
      detach(press.bug, 'held');
      world.held = { bug: press.bug, i: press.i };
    }
  }
  const touch = world.touch;
  if (touch?.hit && Math.hypot(x - touch.x, y - touch.y) > PRESS_SLOP) {
    world.touch = null;
    world.pull = grab(touch.hit);
  }
  if (world.cut) Object.assign(world.cut, { x1: x, y1: y });
};

export const pointerUp = (world, x, y) => {
  pointerMove(world, x, y);
  if (world.painting) {
    world.painting = false;
    return;
  }
  const moving = world.moving;
  if (moving && world.tool === 'move') {
    world.moving = null;
    const [dx, dy] = [x - moving.x, y - moving.y];
    const to = Math.hypot(dx, dy) >= TAP_SLOP && destination(world, moving.obj, dx, dy);
    if (to && world.objects.includes(moving.obj)) relocate(world, moving.obj, to);
    return;
  }
  if (world.press) {
    world.selected = world.press.bug ?? world.press.fish ?? world.press.flier;
    world.press = null;
    return;
  }
  if (world.held) {
    const { bug, fish, flier } = world.held;
    world.held = null;
    if (bug) setState(bug, 'fall', 0);
    if (flier) letGo(world, flier);
    if (fish) Object.assign(fish, { fear: 40, fearDelay: 0, from: { x, y: y - 5 } }); // let go, it shoots off
  }
  if (world.pull) {
    world.pull = null; // let go, it springs back
    return;
  }
  const cut = world.cut;
  world.cut = null;
  if (cut) {
    if (Math.hypot(cut.x1 - cut.x0, cut.y1 - cut.y0) >= TAP_SLOP) cutAlong(world, cut);
    else tap(world, x, y);
    return;
  }
  const touch = world.touch;
  world.touch = null;
  if (touch && Math.hypot(x - touch.x, y - touch.y) < TAP_SLOP) tap(world, x, y);
};

export const pointerCancel = (world) => {
  if (world.held?.bug) setState(world.held.bug, 'fall', 0);
  Object.assign(world, { held: null, press: null, touch: null, pull: null, cut: null, painting: false, moving: null });
};

// What a press at the pointer would do, to show it before it's done: grab a creature, cut something there (hit, as
// prunableAt gives it), lift something to move it, pick a plant to take a cutting from, or put down what's lifted
// or picked. Null if nothing, or the pointer isn't over the tank.
export const aimAt = (world) => {
  if (!world.hover || world.placing || world.held || world.pull || world.cut || world.painting) return null;
  const { x, y } = world.pointer;
  const tool = world.tool;
  const who = tool === 'hand' && creatureAt(world, x, y);
  if (who) return { kind: who.bug ? 'bug' : who.fish ? 'fish' : 'flier' };
  if (tool === 'hand' || tool === 'prune') {
    const hit = prunableAt(world, x, y);
    return hit && { kind: 'cut', hit };
  }
  if (tool !== 'move' && tool !== 'propagate') return null;
  if (world.moving) return { kind: 'drop' };
  const hit = prunableAt(world, x, y, tool === 'propagate');
  if (tool === 'move' && hit) return { kind: 'lift', obj: liftable(hit) };
  return hit?.plant && tool === 'propagate' && propagatable(hit.plant) ? { kind: 'pick', obj: hit.plant } : null;
};

// Tap something to prune it; tap empty space to deselect.
const tap = (world, x, y) => {
  const hit = prunableAt(world, x, y);
  if (hit) pruneHit(world, hit);
  else world.selected = null;
};

// ---------- relocating and propagating ----------

const LID = 4; // px from the top of the tank: a stick moved up so far it would poke out is cut off here

// What Relocate would lift, of what a press there hit: a plant, grass patch, vine or stick.
const liftable = (hit) => hit && (hit.plant ?? hit.grass ?? hit.vine ?? hit.seg?.obj);

// A stick and everything that stands on it or hangs from it: plants, vines, other sticks and whatever is on those.
const carried = (world, stick) => {
  const out = [stick];
  for (let i = 0; i < out.length; i++) {
    const segs = out[i].segs ?? [];
    for (const o of world.objects) if (!out.includes(o) && segs.includes(o.on)) out.push(o);
  }
  return out;
};

// Where a plant, grass patch, vine or stick dragged by (dx, dy) ends up: its base moves as far as the pointer did,
// then lands the way a new one would. A stick keeps clear of the glass at the sides, and doesn't land on itself or
// anything it carries.
const destination = (world, obj, dx, dy) => {
  const [x, y] = [obj.base.x + dx, obj.base.y + dy];
  if (obj.kind === 'vine') return vineAnchor(world, x, y);
  if (obj.kind === 'grass') return sowAt(world, x, y);
  if (obj.kind !== 'stick') return standAt(world, x, y);
  const segs = new Set(carried(world, obj).flatMap((o) => o.segs ?? []));
  const xs = [...segs].flatMap((g) => [g.x0, g.x1]);
  const fit = clamp(x, obj.base.x + 2 - Math.min(...xs), obj.base.x + world.W - 3 - Math.max(...xs));
  return standAt(world, fit, y, segs);
};

// What's being dragged (with everything it carries, for a stick) and where it would land (or, propagating, where
// its seedling would go), for drawing.
export const relocationAt = (world) => {
  const m = world.moving;
  if (!m || !world.objects.includes(m.obj)) return null;
  const { x, y } = world.pointer;
  const to = world.tool === 'propagate' ? standAt(world, x, y) : destination(world, m.obj, x - m.x, y - m.y);
  if (!to) return null;
  const loads = m.obj.kind === 'stick' ? carried(world, m.obj) : [m.obj];
  return { obj: m.obj, loads, base: to.base, dx: to.base.x - m.obj.base.x, dy: to.base.y - m.obj.base.y };
};

// Move a stick so its base is at to.base, with everything it carries and the bugs walking on any of it (one
// rounding a corner just then lets go). Whatever now pokes out of the top of the tank is cut off at LID.
const moveStick = (world, stick, to) => {
  const [dx, dy] = [to.base.x - stick.base.x, to.base.y - stick.base.y];
  const loads = carried(world, stick);
  const segs = new Set(loads.flatMap((o) => o.segs ?? []));
  const by = (p) => p && { x: p.x + dx, y: p.y + dy };
  for (const o of loads) {
    if (o.kind !== 'stick') relocate(world, o, { base: by(o.base), on: o.on, hold: by(o.hold) });
    else {
      for (const g of o.segs) setEnds(g, by(g.root), by(g.tip));
      Object.assign(o, { base: by(o.base), hold: by(o.hold) });
    }
  }
  Object.assign(stick, { base: to.base, on: to.on, hold: to.hold });
  for (const bug of world.bugs) {
    if (bug.transfer && (segs.has(bug.surf) || segs.has(bug.transfer.from))) detach(bug, 'fall');
    if (!segs.has(bug.surf)) continue;
    for (const p of bug.pts) Object.assign(p, { x: p.x + dx, y: p.y + dy, px: p.px + dx, py: p.py + dy });
    resetLegs(bug);
    bug.step = null;
  }
  rebuildJunctions(world);
  replan(world);
  for (const g of segs) {
    if (!world.branches.includes(g) || Math.min(g.root.y, g.tip.y) >= LID) continue;
    const t = g.root.y < LID ? 0 : (g.root.y - LID) / (g.root.y - g.tip.y);
    pruneSegment(world, g, { x: g.root.x + (g.tip.x - g.root.x) * t, y: g.root.y + (g.tip.y - g.root.y) * t });
  }
};

// Move a plant, grass patch, vine or stick so its base is at to.base.
const relocate = (world, obj, to) => {
  if (obj.kind === 'stick') return moveStick(world, obj, to);
  const [dx, dy] = [to.base.x - obj.base.x, to.base.y - obj.base.y];
  if (obj.kind === 'plant') {
    // Stems share their joints (and the first one its root with the base), so move each point once.
    const moved = new Map([[obj.base, to.base]]);
    const at = (p) => {
      if (!moved.has(p)) moved.set(p, { x: p.x + dx, y: p.y + dy });
      return moved.get(p);
    };
    for (const stem of obj.stems) Object.assign(stem, { root: at(stem.root), tip: at(stem.tip) });
  } else if (obj.kind === 'vine') {
    obj.nodes = obj.nodes.map((p) => ({ x: p.x + dx, y: p.y + dy, px: p.px + dx, py: p.py + dy }));
  } else {
    // Each tuft settles onto whatever is below it; any that land off soil wither.
    for (const tuft of obj.tufts) {
      tuft.x = clamp(tuft.x + dx, 1, world.W - 2);
      tuft.y = groundTop(world, tuft.x, tuft.y + dy - 3);
    }
  }
  Object.assign(obj, { base: to.base, on: to.on, hold: to.hold });
};

// A flowering plant that has finished growing: nothing still growing or about to sprout, and its flowers out (or
// come and gone, to come again). A clump plant once its crown is full, flowers (or baby plants) and all.
export const propagatable = (obj) => {
  if (obj.kind !== 'plant') return false;
  const flowered = (st) => st.bud && (st.flower >= 1 || st.age !== undefined);
  const settled = obj.stems.every((st) => !st.growing && st.sprout <= 0 && (!st.bud || flowered(st)));
  if (obj.species.form) return settled && crownFull(obj);
  return settled && obj.stems.some(flowered);
};

// Take a cutting: a seedling of the same species goes in at to, and the parent is cut right back to a seedling
// too, so both start again.
const propagate = (world, plant, to) => {
  for (const st of plant.stems) fling(world, st.root, st.tip, { kind: 'stem', plant, leaf: st.role === 'leaf' });
  plant.stems = [seedling(world, plant)];
  addDecor(world, { kind: 'plant', base: to.base, on: to.on, species: structuredClone(plant.species) });
};

// Let a bug, fish or flier go: it leaves the tank.
export const release = (world, who) => {
  if (who.partner) who.partner.partner = null;
  world.bugs = world.bugs.filter((b) => b !== who);
  world.fish = world.fish.filter((f) => f !== who);
  world.fliers = world.fliers.filter((b) => b !== who);
  if (world.held?.bug === who || world.held?.fish === who || world.held?.flier === who) world.held = null;
  if (world.selected === who) world.selected = null;
};
