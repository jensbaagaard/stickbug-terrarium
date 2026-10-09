// The marks under the pointer and the previews: what a press would do (cut, lift, drop), the brush, plants ready to
// propagate, a plant or stick being relocated, and what's bought following the pointer before it goes in.
import { MID } from '../anatomy.js';
import { stickWidth } from '../sticks.js';
import { bodyHex, traitsOf } from '../genome.js';
import { add, hslHex, normalize } from '../geom.js';
import { propagatable } from '../sim.js';
import { FOUNTAIN } from '../terrain.js';
import { drawFish, posedFish } from './fish.js';
import { drawFlier } from './fliers.js';
import { COIN, line, plot, sprite } from './pixelart.js';
import { drawGrass, drawPlant, drawStick, drawVine, woodColors } from './plants.js';
import { MATERIAL_COLORS } from './terrain.js';

export const NOTE = ['..#.', '..##', '..#.', '..#.', '###.', '##..'];
export const ARROW = ['#####', '.###.', '..#..'];
const LIFT = [...ARROW].reverse();
export const CUT = '#e04a3a';
export const POINTER = '#e3d3b5';

// While propagating, a little blinking green plus over each plant that's grown enough to take a cutting from,
// and a steady yellow one over the plant picked.
export const READY = ['.#.', '###', '.#.'];
export const READY_GREEN = '#9fe07a';
export const drawReady = (ctx, world) => {
  const picked = world.moving?.obj;
  for (const obj of world.objects) {
    if (!propagatable(obj)) continue;
    const top = obj.stems.reduce((a, st) => (st.tip.y < a.y ? st.tip : a), obj.base);
    ctx.globalAlpha = obj === picked ? 1 : 0.6 + 0.4 * Math.sin(world.time * 0.1);
    ctx.fillStyle = obj === picked ? COIN : READY_GREEN;
    sprite(ctx, READY, top.x - 1, top.y - 8);
  }
  ctx.globalAlpha = 1;
};

// The top of a plant or grass patch, or where a vine hangs from: where arrows over it point.
const topOf = (obj) => {
  if (obj.kind === 'plant') return obj.stems.reduce((a, st) => (st.tip.y < a.y ? st.tip : a), obj.base);
  if (obj.kind === 'stick') {
    return obj.segs.flatMap((g) => [g.root, g.tip]).reduce((a, p) => (p.y < a.y ? p : a), obj.base);
  }
  if (obj.kind === 'grass') {
    return { x: obj.base.x, y: Math.min(...obj.tufts.map((t) => t.y - obj.genome.height * t.size)) };
  }
  return obj.base;
};

// A plant or stick being relocated: a ghost of it (a stick with everything on it) where it would land, with the
// arrow pointing at it.
export const drawRelocation = (ctx, world, move) => {
  const { obj } = move;
  // Propagating, what goes in is a seedling.
  if (world.tool === 'propagate') {
    return drawPreview(ctx, world, { kind: 'plant', base: move.base, species: obj.species });
  }
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.translate(Math.round(move.dx), Math.round(move.dy));
  for (const o of move.loads) {
    if (o.kind === 'stick') drawStick(ctx, o);
    else if (o.kind === 'plant') drawPlant(ctx, o);
    else if (o.kind === 'grass') drawGrass(ctx, world, [o]);
    else drawVine(ctx, o);
  }
  ctx.restore();
  const top = topOf(obj);
  dropArrow(ctx, world, top.x + move.dx, top.y + move.dy - (obj.kind === 'vine' ? 1 : 3));
};

// What a press would do, marked where it would happen: a blinking red notch across the stem, stick or vine
// it would cut (a line along grass it would mow), or an arrow lifting the plant it would pick up to move.
export const drawAim = (ctx, world, aim) => {
  if (aim.kind === 'lift') {
    const top = topOf(aim.obj);
    ctx.fillStyle = POINTER;
    sprite(ctx, LIFT, top.x - 2, top.y - 7 - (Math.floor(world.time / 15) % 2));
    return;
  }
  if (aim.kind !== 'cut') return;
  const { hit } = aim;
  ctx.globalAlpha = 0.75 + 0.25 * Math.sin(world.time * 0.2);
  ctx.fillStyle = CUT;
  if (hit.grass) {
    for (let dx = -6; dx <= 6; dx += 2) plot(ctx, hit.p.x + dx, hit.p.y, 1);
  } else {
    // A vine is cut back to the node above, a stem or stick right there.
    const nodes = hit.vine?.nodes;
    const along = hit.stem ?? hit.seg;
    const [a, b] = nodes ? [nodes[hit.at - 1], nodes[hit.at]] : [along.root, along.tip];
    const p = nodes ? a : hit.p;
    const n = normalize({ x: a.y - b.y, y: b.x - a.x });
    line(ctx, add(p, n, -3), add(p, n, 3), 1);
  }
  ctx.globalAlpha = 1;
};

// The bobbing yellow arrow pointing down at something being put down, just above its top at x: always in the
// open, never in the ground it's going on.
export const dropArrow = (ctx, world, x, top) => {
  ctx.fillStyle = COIN;
  sprite(ctx, ARROW, x - 2, top - 5 - (Math.floor(world.time / 15) % 2));
};

// A shop item following the pointer, before it's put down.
export const drawPreview = (ctx, world, spec, alpha = 1) => {
  let [ax, top] = [spec.base.x, spec.base.y - 1]; // where the arrow points
  ctx.globalAlpha = 0.55 * alpha;
  if (spec.kind === 'stick') {
    ctx.fillStyle = woodColors(spec.wood).light;
    for (const p of spec.pieces) line(ctx, p.a, p.b, stickWidth(spec.style, p.depth));
    const hi = spec.pieces.flatMap((p) => [p.a, p.b]).reduce((a, p) => (p.y < a.y ? p : a));
    [ax, top] = [hi.x, hi.y - 2];
  } else if (spec.kind === 'fountain') {
    const { x, y, size } = spec.box;
    ctx.fillStyle = MATERIAL_COLORS[FOUNTAIN][0];
    ctx.fillRect(x, y, size, size);
    top = y;
  } else if (spec.kind === 'grass') {
    // A seedling tuft.
    const tufts = [{ x: spec.base.x, y: spec.base.y, size: 0.6, seed: 1 }];
    drawGrass(ctx, world, [{ genome: spec.genome, tufts }]);
    top = spec.base.y - spec.genome.height * 0.6 - 1;
  } else if (spec.kind === 'vine') {
    // A short sprig hanging from where it would be anchored.
    const { x, y } = spec.base;
    const nodes = [0, 1, 2, 3].map((k) => ({ x, y: y + k * spec.genome.spacing }));
    drawVine(ctx, { genome: spec.genome, nodes });
  } else if (spec.kind === 'fish') {
    drawFish(ctx, world, posedFish(spec.genome, spec.base.x, spec.base.y, world.time));
    top = spec.base.y - 6;
  } else if (spec.kind === 'flier') {
    // Hovering, wings beating, where it'll be let go.
    const { x, y } = spec.base;
    const b = { genome: spec.genome, x, y, fwd: { x: 1, y: 0 }, up: { x: 0, y: -1 }, wings: 1, stride: 0, seed: 0 };
    drawFlier(ctx, world, b);
    top = y - 6;
  } else if (spec.kind === 'bug') {
    // The bug, stretched out ready to drop.
    const t = traitsOf(spec.genes);
    const half = MID * t.seg * t.size;
    ctx.fillStyle = bodyHex(t, 0.5);
    line(ctx, add(spec.base, { x: -half, y: 0 }), add(spec.base, { x: half, y: 0 }));
    for (const dx of [-0.6, 0, 0.6]) {
      line(ctx, add(spec.base, { x: dx * half, y: 0 }), add(spec.base, { x: dx * half, y: 5 }));
    }
  } else if (spec.species.form) {
    // A clump plant's first few leaves.
    const sp = spec.species;
    ctx.fillStyle = hslHex(sp.leaf.h, sp.leaf.s, sp.leaf.l);
    for (const dx of [-3, 0, 3]) line(ctx, spec.base, add(spec.base, { x: dx, y: dx ? -5 : -7 }), 1.2);
    top = spec.base.y - 8;
  } else {
    const sp = spec.species;
    ctx.fillStyle = hslHex(sp.stem.h, sp.stem.s, sp.stem.l);
    line(ctx, spec.base, add(spec.base, { x: 0, y: -5 }), 1.2);
    ctx.fillStyle = hslHex(sp.leaf.h, sp.leaf.s, sp.leaf.l);
    plot(ctx, spec.base.x - 2, spec.base.y - 5, 2);
    plot(ctx, spec.base.x + 2, spec.base.y - 5, 2);
    top = spec.base.y - 6;
  }
  ctx.globalAlpha = alpha;
  dropArrow(ctx, world, ax, top);
  ctx.globalAlpha = 1;
};

// The brush outline, dotted, radius r around (x, y).
export const drawBrush = (ctx, { x, y }, r) => {
  ctx.fillStyle = POINTER;
  for (let a = 0; a < Math.PI * 2; a += 0.5 / r + 0.25) {
    ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 1, 1);
  }
};
