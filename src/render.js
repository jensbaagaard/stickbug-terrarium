// Pixel-art canvas rendering for the terrarium.
import {
  MID,
  SEGMENTS,
  THICKNESS,
  idealFoot,
  legLayout,
  sampleBody,
  standHeight,
  strideLen,
  tangentAt,
  thighFor,
} from './anatomy.js';
import {
  add,
  clamp,
  hash,
  hslHex,
  lerp,
  normalize,
  pointAt,
  segDir,
  segLength,
  segNormal,
  smoothstep,
} from './geom.js';
import { FAR_SHADE, bodyHex, patternHex, patternOf, traitsOf } from './genome.js';
import { CELL, DIRT, EMPTY, FOUNTAIN, MATERIALS, SAND, SANDSTONE, STONE, WATER, WOOD } from './terrain.js';
import { aimAt, floorBelow, previewAt, propagatable, relocationAt } from './sim.js';
import { facingNow, fishShape } from './fish.js';

const NOTE = ['..#.', '..##', '..#.', '..#.', '###.', '##..'];
const ARROW = ['#####', '.###.', '..#..'];
const LIFT = [...ARROW].reverse();
const CRUMB_COLORS = ['#3f8f4f', '#7fbf5a'];
const COIN = '#f2c94c';
const CUT = '#e04a3a';
const POINTER = '#e3d3b5';
// 3x5 digits for coin popups.
const GLYPHS = {
  '+': ['...', '.#.', '###', '.#.', '...'],
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '.##', '..#', '###'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'],
};

const dirOf = (a) => ({ x: Math.cos(a), y: Math.sin(a) });

// Fill a pixel-snapped square of width w centred on (x, y).
const plot = (ctx, x, y, w) => {
  const h = w / 2;
  const x0 = Math.ceil(x - h);
  const y0 = Math.ceil(y - h);
  ctx.fillRect(x0, y0, Math.ceil(x + h) - x0, Math.ceil(y + h) - y0);
};

const line = (ctx, a, b, w = THICKNESS) => {
  const steps = Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1));
  for (let i = 0; i <= steps; i++) plot(ctx, a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, w);
};

// Stroke a polyline a pixel at a time, asking colorAt(u) for each pixel's colour (u = px from the start).
const strokeBy = (ctx, pts, colorAt, w = THICKNESS) => {
  let u = 0;
  let current = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))));
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const c = colorAt(u + (len * k) / steps);
      if (c !== current) ctx.fillStyle = current = c;
      plot(ctx, a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps, w);
    }
    u += len;
  }
};

const sprite = (ctx, rows, x, y) =>
  rows.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch === '#') ctx.fillRect(Math.round(x) + i, Math.round(y) + j, 1, 1);
    }),
  );

// ---------- scenery ----------

const woodColors = (w) => ({
  dark: hslHex(w.h, w.s, w.l),
  light: hslHex(w.h, w.s, w.l + 14),
  knot: hslHex(w.h, w.s, w.l - 10),
});
const MOSS = ['#5f8f3a', '#7aa84a'];
const STICK_WIDTH = [4, 3, 2]; // main limb, twigs, twigs off twigs

// A stick's branches hang below their surface line, lit along the top, maybe with knots and patches of moss.
const drawBranch = (ctx, g, colors, width, look) => {
  const n = segNormal(g);
  const a = { x: g.x0, y: g.y0 };
  const b = { x: g.x1, y: g.y1 };
  ctx.fillStyle = colors.dark;
  line(ctx, add(a, n, -width / 2), add(b, n, -width / 2), width);
  ctx.fillStyle = colors.light;
  line(ctx, add(a, n, -0.5), add(b, n, -0.5), 1);
  const d = segDir(g);
  const seed = g.root.x * 7 + g.root.y * 13;
  for (let i = 2; i < segLength(g) - 2; i++) {
    const p = add(a, d, i);
    if (look.knots && hash(seed, i, 1) < 0.05) {
      ctx.fillStyle = colors.knot;
      plot(ctx, p.x - n.x * width * 0.5, p.y - n.y * width * 0.5, Math.max(1, width - 2));
    }
    if (look.moss && hash(seed, Math.floor(i / 5), 2) < 0.45 && hash(seed, i, 3) < 0.7) {
      ctx.fillStyle = MOSS[hash(seed, i, 4) < 0.5 ? 0 : 1];
      plot(ctx, p.x + n.x * 0.5, p.y + n.y * 0.5, 1);
    }
  }
};

const LEAF_FORMS = {
  round: { len: 1, width: (f, s) => 1 + 2.4 * s * Math.sin(Math.PI * f) },
  long: { len: 1.6, width: (f, s) => 1 + 1.1 * s * Math.sin(Math.PI * f) },
  needle: { len: 1.4, width: () => 1 },
  heart: { len: 1, width: (f, s) => 1 + 2.6 * s * Math.sin(Math.PI * Math.sqrt(f)) },
  oak: { len: 1.2, width: (f, s) => (1 + 2.4 * s * Math.sin(Math.PI * f)) * (0.7 + 0.3 * Math.cos(f * Math.PI * 6)) },
  fan: { len: 0.9, width: (f, s) => 1 + 3 * s * Math.sin((Math.PI / 2) * f) * (1 - 0.3 * f * f) },
  pearl: { len: 0.6, width: (f, s) => 1 + 2.6 * s * Math.sin(Math.PI * f) }, // round beads
};

// One leaf reaching len along axis from base, filled to its form's width, with a darker vein in big ones.
const leafShape = (ctx, base, axis, len, form, s, fill, vein) => {
  ctx.fillStyle = fill;
  for (let i = 0; i <= len; i++) plot(ctx, base.x + axis.x * i, base.y + axis.y * i, form.width(i / len, s));
  if (len < 6 || form === LEAF_FORMS.needle) return;
  ctx.fillStyle = vein;
  for (let i = 1; i < len * 0.75; i++) plot(ctx, base.x + axis.x * i, base.y + axis.y * i, 1);
};

const drawLeaf = (ctx, g, leaf, fol) => {
  const n = segNormal(g);
  const d = segDir(g);
  const base = pointAt(g, leaf.t * segLength(g));
  const axis = normalize({ x: n.x * 0.8 + d.x * 0.6 * leaf.lean, y: n.y * 0.8 + d.y * 0.6 * leaf.lean });
  const form = LEAF_FORMS[fol.shape];
  const { h, s, l } = fol.color;
  const len = (3 + 7 * leaf.size) * fol.size * form.len;
  leafShape(ctx, base, axis, len, form, leaf.size * fol.size, hslHex(h, s, l), hslHex(h, s, l - 9));
};

// A flower at c, in its species' form, opening as bloom goes 0 -> 1. Petals shade from base to tip.
const drawFlower = (ctx, f, c, bloom, turn, scale = 1) => {
  const s = f.size * scale * (0.3 + 0.7 * bloom);
  const len = f.petalLen * s;
  const wide = f.petalWidth * s;
  const petalAt = (u) => hslHex(f.petal.h + (f.tip.h - f.petal.h) * u, f.petal.s, f.petal.l + f.tip.l * u);
  const centre = hslHex(f.centre.h, f.centre.s, f.centre.l);
  const row = (x, y, w) => ctx.fillRect(Math.round(x - w / 2), Math.round(y), Math.max(1, Math.round(w)), 1);
  const radial = (n, reach, width, color, offset) => {
    for (let i = 0; i < n; i++) {
      const a = offset + (i / n) * Math.PI * 2;
      for (let k = 0; k <= reach; k += 0.5) {
        ctx.fillStyle = color(k / reach);
        plot(ctx, c.x + Math.cos(a) * k, c.y + Math.sin(a) * k, Math.max(1, width(k / reach)));
      }
    }
  };
  switch (f.form) {
    case 'bell': {
      // Hangs from the tip and flares at the mouth.
      const h = (1.5 + f.petalLen) * s;
      for (let k = 0; k <= h; k += 0.5) {
        ctx.fillStyle = petalAt(k / h);
        row(c.x, c.y + k, 1 + wide * 1.4 * (k / h) ** 0.8);
      }
      ctx.fillStyle = centre;
      plot(ctx, c.x, c.y + h + 1, Math.max(1, f.centreSize * s * 0.5));
      return;
    }
    case 'tulip': {
      // A cup of petals opening upward.
      const h = (1.5 + f.petalLen) * s;
      for (let k = 0; k <= h; k += 0.5) {
        ctx.fillStyle = petalAt(k / h);
        row(c.x, c.y - k, 1 + wide * 1.6 * Math.sin(Math.PI * (0.25 + 0.6 * (k / h))));
      }
      return;
    }
    case 'cluster': {
      // A dome of little florets.
      const r = (1 + f.petalLen * 0.7) * s;
      for (let i = 0; i < f.petals + 3; i++) {
        const a = -Math.PI * (0.05 + 0.9 * hash(turn * 97, i, 1));
        const d = r * Math.sqrt(hash(turn * 97, i, 2));
        ctx.fillStyle = petalAt(hash(turn * 97, i, 3));
        plot(ctx, c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, Math.max(1, wide * 0.8));
      }
      return;
    }
    case 'spike': {
      // Florets stacked up the stem tip, smaller toward the top.
      for (let i = 0; i < f.petals; i++) {
        const u = i / f.petals;
        const w = Math.max(1, wide * 1.2 * (1 - u * 0.7));
        ctx.fillStyle = petalAt(u);
        plot(ctx, c.x - w * 0.4, c.y - i * 1.4 * s, w * 0.7);
        plot(ctx, c.x + w * 0.4, c.y - i * 1.4 * s, w * 0.7);
      }
      return;
    }
    case 'pom': {
      // A fluffy ball.
      const r = (1 + f.petalLen * 0.6) * s;
      for (let y = -Math.ceil(r); y <= r; y++) {
        for (let x = -Math.ceil(r); x <= r; x++) {
          if (x * x + y * y > r * r) continue;
          ctx.fillStyle = petalAt(0.5 * hash(turn * 97 + x, y, 5) + (0.5 * Math.hypot(x, y)) / r);
          ctx.fillRect(Math.round(c.x + x), Math.round(c.y + y), 1, 1);
        }
      }
      return;
    }
    case 'star':
      radial(f.petals, len * 1.15, (u) => wide * (1 - u), petalAt, turn);
      break;
    default: // daisy
      radial(f.petals, len, (u) => wide * 0.75 * Math.sin(Math.PI * (0.2 + 0.8 * u)), petalAt, turn);
  }
  if (f.ring) {
    const ring = hslHex(f.ring.h, f.ring.s, f.ring.l);
    radial(f.petals, len * 0.55, (u) => wide * 0.5 * (1 - u * 0.5), () => ring, turn + Math.PI / f.petals);
  }
  ctx.fillStyle = centre;
  plot(ctx, c.x, c.y, Math.max(1, f.centreSize * s));
};

// Plants sway in the breeze, more toward the top.
const drawPlant = (ctx, plant, time) => {
  const sp = plant.species;
  const bend = Math.sin(time * 0.02 + plant.base.x * 0.13) * 0.035;
  const sway = (p) => ({ x: p.x + bend * (plant.base.y - p.y), y: p.y });
  ctx.fillStyle = hslHex(sp.stem.h, sp.stem.s, sp.stem.l);
  for (const st of plant.stems) line(ctx, sway(st.root), sway(st.tip), 1.2);
  const form = LEAF_FORMS[sp.shape];
  for (const st of plant.stems) {
    for (const leaf of st.leaves) {
      const a = st.angle + leaf.side * 0.95;
      const l = sp.leaf.l + leaf.side * 4;
      const len = (1.5 + 4 * leaf.size) * sp.leafSize * form.len;
      const fill = hslHex(sp.leaf.h, sp.leaf.s, l);
      const vein = hslHex(sp.leaf.h, sp.leaf.s, l - 9);
      leafShape(ctx, sway(lerp(st.root, st.tip, leaf.at)), dirOf(a), len, form, leaf.size * sp.leafSize, fill, vein);
    }
  }
  for (const st of plant.stems) {
    if (st.flower <= 0) continue;
    const turn = (st.angle * 1000) % 6.28; // not its position, which moves as it bends
    drawFlower(ctx, sp.flower, sway(st.tip), st.flower, turn, st.sideBloom ? 0.55 : 1);
  }
};

// Grass: tufts of blades fanning up from the dirt, lighter toward the tips and leaning in the breeze, some
// with seed heads or little blossoms once grown. A tank of it is tens of thousands of single dots, too many to
// fill one at a time, so they're written into an image and drawn in one go, afresh every frame so it still sways.
let grassLayer = null;
const drawGrass = (ctx, patches, time) => {
  if (!patches.length) return;
  const { width: w, height: h } = ctx.canvas;
  if (grassLayer?.canvas.width !== w || grassLayer.canvas.height !== h) grassLayer = imageLayer(w, h);
  // Only the box the grass covers is drawn, and cleared again for next time.
  const { pixels } = grassLayer;
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  const dot = (x, y, color) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    pixels[y * w + x] = color;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (const patch of patches) {
    const g = patch.genome;
    const tones = [0, 0.5, 1].map((f) => pixel(hslHex(g.blade.h, g.blade.s, g.blade.l + g.tipLight * f)));
    const flex = patch.flex; // pulled over toward the pointer, most where it was grabbed
    for (const tuft of patch.tufts) {
      // Under water it sways further and slower, rocked by the current.
      const sway = tuft.wet ? Math.sin(time * 0.02 + tuft.x * 0.1) * 0.35 : Math.sin(time * 0.03 + tuft.x * 0.2) * 0.15;
      const pull = flex ? flex.dx * Math.max(0, 1 - Math.abs(tuft.x - flex.x) / 8) : 0;
      for (let b = 0; b < g.blades; b++) {
        const a = -Math.PI / 2 + g.lean + (b - (g.blades - 1) / 2) * g.fan;
        const len = g.height * tuft.size * (0.7 + 0.5 * hash(tuft.seed, b, 1));
        let tip = null;
        for (let k = 0; k <= len; k++) {
          const f = k / Math.max(1, len);
          const x = tuft.x + Math.cos(a) * k + sway * k * f + pull * f * f;
          const y = tuft.y + Math.sin(a) * k;
          dot(Math.round(x), Math.round(y), tones[Math.min(2, Math.floor(f * 3))]);
          tip = { x, y };
        }
        if (!tip || tuft.size < 0.8) continue;
        const [x, y] = [Math.round(tip.x), Math.round(tip.y)];
        if (g.seeds && b % 2 === 0) {
          const seeds = pixel(hslHex(g.seeds.h, g.seeds.s, g.seeds.l));
          dot(x, y - 1, seeds);
          dot(x, y, seeds);
        }
        if (g.blossom && b === 0 && hash(tuft.seed, 9) < 0.5 && !tuft.wet) {
          // Two dots square, as plot would draw it.
          const blossom = pixel(hslHex(g.blossom.h, g.blossom.s, g.blossom.l));
          const [bx, by] = [Math.ceil(tip.x - 1), Math.ceil(tip.y - 1)];
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) dot(bx + dx, by + dy, blossom);
        }
      }
    }
  }
  if (x1 < 0) return;
  const [bw, bh] = [x1 - x0 + 1, y1 - y0 + 1];
  grassLayer.ctx.putImageData(grassLayer.image, 0, 0, x0, y0, bw, bh);
  ctx.drawImage(grassLayer.canvas, x0, y0, bw, bh, x0, y0, bw, bh);
  for (let y = y0; y <= y1; y++) pixels.fill(0, y * w + x0, y * w + x1 + 1);
};

// A hanging vine: its stem through the rope's nodes, a leaf off each node on alternating sides (smaller near
// the growing tip), pale-edged if variegated, and a flower every few nodes out of the water.
const drawVine = (ctx, vine) => {
  const g = vine.genome;
  const nodes = vine.nodes;
  if (!vine.on && nodes[0].y < 4) {
    // Hung from the top of the tank: a little hook to hang from.
    const x = Math.round(nodes[0].x);
    ctx.fillStyle = '#8a8a90';
    for (const [dx, dy] of [[0, 0], [0, 1], [0, 2], [1, 3], [2, 2], [2, 1]]) ctx.fillRect(x + dx, dy, 1, 1);
  }
  ctx.fillStyle = hslHex(g.stem.h, g.stem.s, g.stem.l);
  for (let i = 1; i < nodes.length; i++) line(ctx, nodes[i - 1], nodes[i], 1);
  const form = LEAF_FORMS[g.shape];
  const fill = hslHex(g.leaf.h, g.leaf.s, g.leaf.l);
  const vein = g.variegated
    ? hslHex(g.leaf.h, g.leaf.s * 0.4, g.leaf.l + 30)
    : hslHex(g.leaf.h, g.leaf.s, g.leaf.l - 9);
  for (let i = 1; i < nodes.length; i++) {
    const down = normalize({ x: nodes[i].x - nodes[i - 1].x, y: nodes[i].y - nodes[i - 1].y });
    const side = i % 2 ? 1 : -1;
    const turn = side * 1.1;
    const [cs, sn] = [Math.cos(turn), Math.sin(turn)];
    const axis = { x: down.x * cs - down.y * sn, y: down.x * sn + down.y * cs };
    const grown = Math.min(1, (nodes.length - i) / 3);
    const len = (3 + 4 * g.leafSize) * form.len * grown;
    if (len >= 1) leafShape(ctx, nodes[i], axis, len, form, 1.2 * g.leafSize * grown, fill, vein);
    if (g.flower && i % g.flower.every === 0 && grown >= 1 && !nodes[i].wet) {
      ctx.fillStyle = hslHex(g.flower.h, g.flower.s, g.flower.l);
      const c = add(nodes[i], axis, -2);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        ctx.fillRect(Math.round(c.x + dx), Math.round(c.y + dy), 1, 1);
      }
      ctx.fillStyle = '#f2d36b';
      ctx.fillRect(Math.round(c.x), Math.round(c.y), 1, 1);
    }
  }
};

const debrisColor = (look) => {
  if (look.kind === 'stick') return woodColors(look.wood).light;
  const { h, s, l } = look.kind === 'vine' ? look.vine.genome.stem : look.plant.species.stem;
  return hslHex(h, s, l);
};

// While propagating, a little blinking green plus over each plant that's grown enough to take a cutting from,
// and a steady yellow one over the plant picked.
const READY = ['.#.', '###', '.#.'];
const READY_GREEN = '#9fe07a';
const drawReady = (ctx, world) => {
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
  if (obj.kind === 'grass') {
    return { x: obj.base.x, y: Math.min(...obj.tufts.map((t) => t.y - obj.genome.height * t.size)) };
  }
  return obj.base;
};

// A plant being relocated: a ghost of it where it would land, with the arrow pointing at it.
const drawRelocation = (ctx, world, move) => {
  const { obj } = move;
  // Propagating, what goes in is a seedling.
  if (world.tool === 'propagate') {
    return drawPreview(ctx, world, { kind: 'plant', base: move.base, species: obj.species });
  }
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.translate(Math.round(move.dx), Math.round(move.dy));
  if (obj.kind === 'plant') drawPlant(ctx, obj, world.time);
  else if (obj.kind === 'grass') drawGrass(ctx, [obj], world.time);
  else drawVine(ctx, obj);
  ctx.restore();
  const top = topOf(obj);
  dropArrow(ctx, world, top.x + move.dx, top.y + move.dy - (obj.kind === 'plant' ? 3 : 1));
};

// What a press would do, marked where it would happen: a blinking red notch across the stem, stick or vine
// it would cut (a line along grass it would mow), or an arrow lifting the plant it would pick up to move.
const drawAim = (ctx, world, aim) => {
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
const dropArrow = (ctx, world, x, top) => {
  ctx.fillStyle = COIN;
  sprite(ctx, ARROW, x - 2, top - 5 - (Math.floor(world.time / 15) % 2));
};

// A shop item following the pointer, before it's put down.
const drawPreview = (ctx, world, spec, alpha = 1) => {
  let [ax, top] = [spec.base.x, spec.base.y - 1]; // where the arrow points
  ctx.globalAlpha = 0.55 * alpha;
  if (spec.kind === 'stick') {
    ctx.fillStyle = woodColors(spec.wood).light;
    for (const p of spec.pieces) line(ctx, p.a, p.b, STICK_WIDTH[p.depth] ?? 2);
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
    drawGrass(ctx, [{ genome: spec.genome, tufts }], world.time);
    top = spec.base.y - spec.genome.height * 0.6 - 1;
  } else if (spec.kind === 'vine') {
    // A short sprig hanging from where it would be anchored.
    const { x, y } = spec.base;
    const nodes = [0, 1, 2, 3].map((k) => ({ x, y: y + k * spec.genome.spacing }));
    drawVine(ctx, { genome: spec.genome, nodes });
  } else if (spec.kind === 'fish') {
    drawFish(ctx, world, posedFish(spec.genome, spec.base.x, spec.base.y, world.time));
    top = spec.base.y - 6;
  } else if (spec.kind === 'bug') {
    // The bug, stretched out ready to drop.
    const t = traitsOf(spec.genes);
    const half = MID * t.seg * t.size;
    ctx.fillStyle = bodyHex(t, 0.5);
    line(ctx, add(spec.base, { x: -half, y: 0 }), add(spec.base, { x: half, y: 0 }));
    for (const dx of [-0.6, 0, 0.6]) {
      line(ctx, add(spec.base, { x: dx * half, y: 0 }), add(spec.base, { x: dx * half, y: 5 }));
    }
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

// ---------- bugs ----------

// Colour along one part of a bug: u is px along the part, len its length, f where it joins the body
// (0 head .. 1 tail) for legs and antennae.
const painter = (t, seed) => {
  const pattern = patternOf(t);
  return (part, len, f = 0, dark = 0, salt = 0) =>
    (u) => {
      const along = part === 'body' ? u / len : f;
      const base = bodyHex(t, along, dark);
      const mark = () => patternHex(t, along, dark);
      switch (pattern) {
        case 'bands':
          return Math.floor(u / t.patternScale) % 2 ? mark() : base;
        case 'speckle':
          return hash(seed, Math.floor(u), salt) < 0.22 ? mark() : base;
        case 'spots':
          return part === 'body' && u % (t.patternScale * 2.5) < 1.5 ? mark() : base;
        case 'tipped':
          return (part === 'body' ? along < 0.1 || along > 0.9 : u / len > 0.7) ? mark() : base;
        default:
          return base;
      }
    };
};

const drawBug = (ctx, world, bug) => {
  const t = bug.t;
  const time = world.time;
  const up = bug.surf ? segNormal(bug.surf) : { x: 0, y: -1 };
  const down = { x: -up.x, y: -up.y };
  const anchor = bug.pts.map((p) => ({ x: p.x, y: p.y }));
  const pose = bug.surf && bug.pose ? bug.pose : anchor;
  const h = standHeight(t);
  const dancing = bug.state === 'dance';

  // The stickbug rock: feet stay planted while the body sways fore and aft over them, hanging at each end
  // and dipping as the legs lean. Each dance starts and ends centred, so it needs no easing.
  const beat = dancing ? bug.beat : 0;
  const rock = Math.sign(Math.sin(beat)) * Math.abs(Math.sin(beat)) ** (1 - t.danceHang);
  const axis = tangentAt(anchor, MID);
  const sway = t.danceSway * h * rock;
  const dip = t.danceDip * h * rock * rock;
  // Resting bugs drift fore and aft like a twig in a breeze, each catching its own gusts.
  const breeze = time * t.idleSwaySpeed + bug.seed;
  const gust = 0.7 * Math.sin(breeze) + 0.3 * Math.sin(breeze * 2.3 + 1);
  const drift = bug.calm * t.idleSway * h * gust;
  const body = anchor.map((p) => add(add(p, axis, sway + drift), up, -dip));
  // Eating: the head goes down to the leaf and stays there, bopping gently with each chew. The antennae aim
  // as if each chew dipped antennaShake times as far.
  const headDrop = t.headDown * t.size;
  const chewDip = (t.chewBop * t.size * (1 - Math.cos(bug.chew))) / 2;
  const aim = add(body[0], down, bug.munch * (headDrop + chewDip * t.antennaShake));
  body[0] = add(body[0], down, bug.munch * (headDrop + chewDip));
  body[1] = add(body[1], down, bug.munch * headDrop * 0.3);
  // Waving rears the front end up a little.
  const rear = bug.quirk === 'wave' ? bug.raise * t.size * 1.5 : 0;
  body[0] = add(body[0], up, rear);
  body[1] = add(body[1], up, rear * 0.6);
  aim.x += up.x * rear;
  aim.y += up.y * rear;

  const paint = painter(t, bug.seed);
  const scale = t.size * t.legLength;
  const fwd = normalize({ x: aim.x - body[1].x, y: aim.y - body[1].y });
  const antLen = t.antenna * t.size * (0.4 + 0.6 * bug.squash);
  const head = body[0];

  // Front legs during quirks: waved in the air, held out in front like a twig, or one combing an antenna.
  const quirkLeg = (L, hip) => {
    const reach = (t.thigh + t.shin) * scale * 0.5;
    if (bug.quirk === 'wave') {
      const a = 0.6 * Math.sin(time * t.waveSpeed + (L.near ? 0 : Math.PI));
      const knee = add(add(hip, fwd, reach * 0.5), up, reach * 0.4);
      const lift = t.waveHeight * t.size;
      return [knee, add(add(knee, up, Math.cos(a) * lift), fwd, Math.sin(a) * lift + lift * 0.3)];
    }
    if (bug.quirk === 'twig') {
      const foot = add(add(head, fwd, antLen * 0.55), down, L.near ? 0 : 1);
      return [lerp(hip, foot, 0.45), foot];
    }
    if (bug.quirk === 'groom' && L.near) {
      const stroke = 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(time * 0.18));
      return [add(add(hip, up, 2 * t.size), fwd, 2 * t.size), add(add(head, fwd, antLen * stroke), down, 1)];
    }
    return null;
  };

  const legPath = (L, k) => {
    const r = L.reach * bug.squash;
    const hip = sampleBody(body, L.at);
    const tan = tangentAt(body, L.at);
    let knee = add(hip, thighFor(t, tan, r, down));
    let foot = bug.surf ? bug.legs[k].foot : null;
    if (!foot) {
      // Loose: dangling, or paddling at the air while held.
      let ahead = 0;
      let raise = 0;
      if (bug.state === 'held') {
        const kick = time * 0.4 + Math.PI * L.tripod;
        ahead = strideLen(t) * Math.sin(kick);
        raise = t.footLift * t.size * Math.max(0, Math.cos(kick));
      }
      foot = add(idealFoot(t, pose, L, bug.squash, down, ahead), up, raise);
      foot.y = Math.min(foot.y, floorBelow(world, foot.x, knee.y).y - 1);
    }
    if (L.front && bug.raise > 0.01) {
      const q = quirkLeg(L, hip);
      if (q) {
        knee = lerp(knee, q[0], bug.raise);
        foot = lerp(foot, q[1], bug.raise);
      }
    }
    return [hip, knee, foot];
  };

  const drawLeg = (L, k) => {
    const pts = legPath(L, k);
    const span = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    const len = span(pts[0], pts[1]) + span(pts[1], pts[2]);
    strokeBy(ctx, pts, paint('leg', len || 1, L.at / (SEGMENTS - 1), L.near ? 0 : FAR_SHADE, k + 1));
  };

  const layout = legLayout(t);
  layout.forEach((L, k) => !L.near && drawLeg(L, k));
  let bodyLen = 0;
  for (let i = 0; i < SEGMENTS - 1; i++) bodyLen += Math.hypot(body[i + 1].x - body[i].x, body[i + 1].y - body[i].y);
  strokeBy(ctx, body, paint('body', bodyLen || 1));
  layout.forEach((L, k) => L.near && drawLeg(L, k));

  // Antennae wave while the bug is busy, hold still while it rests, and trail the rock while dancing; a
  // twig pose holds them together straight ahead.
  const wave =
    t.antennaTwitch * Math.sin(time * 0.07 + bug.seed) * (1 - bug.calm) * (1 - bug.groove) +
    0.2 * bug.groove * Math.sin(beat - 1);
  const spread = 0.21 * (bug.quirk === 'twig' ? 1 - 0.85 * bug.raise : 1);
  for (const s of [1, -1]) {
    // Grooming bends one antenna down to the leg combing it.
    const groom = bug.quirk === 'groom' && s === 1 ? 0.35 * bug.raise * Math.sign(fwd.x || 1) : 0;
    const a = s * spread + wave + groom;
    const dir = { x: fwd.x * Math.cos(a) - fwd.y * Math.sin(a), y: fwd.x * Math.sin(a) + fwd.y * Math.cos(a) };
    strokeBy(ctx, [head, add(head, dir, antLen)], paint('antenna', antLen || 1, 0, 0, 10 + s));
  }

  if (dancing) {
    const rise = (time * 0.25 + bug.seed * 7) % 14;
    if (rise < 11) {
      const p = add(body[MID], up, 8 + rise);
      ctx.fillStyle = '#e3d3b5';
      sprite(ctx, NOTE, p.x - 2, p.y - 3);
    }
  }
  if (world.selected === bug) {
    const p = add(body[MID], up, 9 + h * 0.2);
    ctx.fillStyle = COIN;
    sprite(ctx, ARROW, p.x - 2, p.y - 2 + (Math.floor(time / 20) % 2));
  }
};

// ---------- terrain ----------

// Each material is one colour with just a hint of grain: three shades a couple of percent apart, and each
// grain keeps its own shade as it moves. Wood and sandstone never move, so their shade comes from where they
// are instead: wavy grain lines in wood, soft layers in sandstone.
const shades = (h, s, l, [a, b] = [-2, 2]) => [l, l + a, l + b].map((v) => hslHex(h, s, v));
export const MATERIAL_COLORS = {
  [STONE]: shades(240, 3, 44),
  [DIRT]: shades(28, 40, 25),
  [SAND]: shades(44, 52, 70),
  [WATER]: shades(212, 60, 47),
  [FOUNTAIN]: shades(186, 38, 56),
  // Plain, grain line, light streak, dim streak: all within a few percent, so the grain is felt more than seen.
  [WOOD]: [0, -3, 1, -1].map((d) => hslHex(28, 26, 36 + d)),
  [SANDSTONE]: shades(33, 48, 56, [-4, 3]),
};
const mod3 = (n) => ((n % 3) + 3) % 3;
// How many wood cells run on from (r, c) in direction (dr, dc), up to 10.
const woodRun = (ter, r, c, dr, dc) => {
  let k = 0;
  for (let rr = r + dr, cc = c + dc; k < 10; rr += dr, cc += dc, k++) {
    if (rr < 0 || rr >= ter.rows || cc < 0 || cc >= ter.cols || ter.cells[rr * ter.cols + cc] !== WOOD) break;
  }
  return k;
};
// Wood's grain: the shade of each world pixel of each wood cell, CELL * CELL to a cell, with the grain running
// the way the wood goes on furthest: along the row, up and down, or either diagonal. Wood never moves, so this
// only changes when wood is drawn or erased; it's kept with the terrain's layers until then.
const GRAIN_DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];
const woodGrain = (ter) => {
  const cache = layersOf(ter);
  if (cache.grainVersion === ter.woodVersion) return cache.grain;
  const grain = new Uint8Array(ter.cells.length * CELL * CELL);
  for (let i = 0; i < ter.cells.length; i++) {
    if (ter.cells[i] !== WOOD) continue;
    const r = Math.floor(i / ter.cols);
    const c = i % ter.cols;
    let best = -1;
    let dir = 0;
    GRAIN_DIRS.forEach(([dr, dc], d) => {
      const n = woodRun(ter, r, c, dr, dc) + woodRun(ter, r, c, -dr, -dc);
      if (n > best) [best, dir] = [n, d];
    });
    for (let dy = 0; dy < CELL; dy++) {
      for (let dx = 0; dx < CELL; dx++) {
        grain[(i * CELL + dy) * CELL + dx] = woodShade(dir, c * CELL + dx, r * CELL + dy);
      }
    }
  }
  return Object.assign(cache, { grain, grainVersion: ter.woodVersion }).grain;
};
// Wood's shade at world pixel (x, y), running in direction dir: short faint dashes of grain a pixel thick, in
// rows three apart that wander a little, over short streaks a touch lighter or darker. Pixel lines on a slant
// look like dithering, so slanted wood (dir 2 and 3) shows just its streaks, closer together.
const woodShade = (dir, x, y) => {
  const u = dir === 0 ? x : dir === 1 ? y : dir === 2 ? x + y : y - x;
  const v = dir === 0 ? y : dir === 1 ? x : dir === 2 ? y - x : x + y;
  if (dir >= 2) {
    const streak = hash(Math.floor(v / 3), Math.floor((u + v * 3) / 7), 5);
    return streak < 0.3 ? 3 : streak > 0.75 ? 2 : 0;
  }
  const w = v + Math.round(Math.sin(u * 0.09 + Math.floor(v / 3) * 2.3) * 0.9);
  const band = Math.floor(w / 3);
  if (mod3(w) === 0 && hash(band, Math.floor((u + band * 5) / 4), 7) < 0.4) return 1;
  const streak = hash(band, Math.floor((u + band * 11) / 8), 3);
  return streak < 0.2 ? 3 : streak > 0.85 ? 2 : 0;
};
// Sandstone's layers, two cells thick and gently sloping, in three shades.
const sandstoneShade = (r, c) => mod3(Math.floor((r + Math.round(Math.sin(c * 0.08) * 2)) / 2));
const WATER_TOP = '#7fb2ee';
const WATER_ALPHA = 0.6;

// The colour of dot (x, y) of a terrain layer drawn scale dots to a cell, or null; water only when water is
// asked for, solids otherwise. The solids are drawn a dot per world pixel, for wood's fine grain (grain is
// woodGrain's shades).
const dotColor = (ter, water, scale, x, y, grain) => {
  const r = Math.floor(y / scale);
  const c = Math.floor(x / scale);
  const i = r * ter.cols + c;
  const m = ter.cells[i];
  if (m === EMPTY || (m === WATER) !== water) return null;
  if (water && (r === 0 || ter.cells[i - ter.cols] !== WATER)) return WATER_TOP;
  if (m === WOOD) return MATERIAL_COLORS[WOOD][grain[(i * CELL + (y % CELL)) * CELL + (x % CELL)]];
  if (m === SANDSTONE) return MATERIAL_COLORS[SANDSTONE][sandstoneShade(r, c)];
  return MATERIAL_COLORS[m][ter.tint[i]];
};

const rgbCache = new Map();
const rgb = (hex) => {
  let v = rgbCache.get(hex);
  if (!v) rgbCache.set(hex, (v = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16))));
  return v;
};
// Colours as whole opaque pixels, to write straight into image data.
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const pixelCache = new Map();
const pixel = (hex) => {
  let v = pixelCache.get(hex);
  if (v === undefined) {
    const [r, g, b] = rgb(hex);
    v = (LITTLE_ENDIAN ? (255 << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
    pixelCache.set(hex, v);
  }
  return v;
};

// An image to write pixels into (whole colours from pixel), then draw onto the tank.
const imageLayer = (w, h) => {
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(w, h);
  return { canvas, ctx, image, pixels: new Uint32Array(image.data.buffer) };
};

// Each terrain's drawing caches: its layers and its wood grain.
const layers = new WeakMap();
const layersOf = (ter) => {
  let cache = layers.get(ter);
  if (!cache) layers.set(ter, (cache = {}));
  return cache;
};

// Each layer is an image (the solids at world-pixel size, water a pixel to a cell), redrawn only
// when its cells change and scaled up onto the tank.
const terrainLayer = (ter, water) => {
  const cache = layersOf(ter);
  const scale = water ? 1 : CELL;
  const w = ter.cols * scale;
  const layer = (cache[water] ??= { ...imageLayer(w, ter.rows * scale), version: -1 });
  const version = water ? ter.version : ter.solidVersion;
  if (layer.version !== version) {
    const { pixels } = layer;
    const grain = water ? null : woodGrain(ter);
    // A cell at a time, every dot alike, except wood's grain which goes a dot at a time.
    for (let r = 0, i = 0; r < ter.rows; r++) {
      for (let c = 0; c < ter.cols; c++, i++) {
        const x0 = c * scale;
        const y0 = r * scale;
        const fine = grain && ter.cells[i] === WOOD;
        const color = fine ? null : dotColor(ter, water, scale, x0, y0, grain);
        const flat = color ? pixel(color) : 0;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0, k = (y0 + dy) * w + x0; dx < scale; dx++, k++) {
            pixels[k] = fine ? pixel(dotColor(ter, water, scale, x0 + dx, y0 + dy, grain)) : flat;
          }
        }
      }
    }
    layer.ctx.putImageData(layer.image, 0, 0);
    layer.version = version;
  }
  return layer.canvas;
};

const drawTerrain = (ctx, world, water) => {
  const ter = world.terrain;
  ctx.globalAlpha = water ? WATER_ALPHA : 1;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(terrainLayer(ter, water), 0, ter.top, ter.cols * CELL, ter.rows * CELL);
  ctx.globalAlpha = 1;
};

// The brush outline, dotted, radius r around (x, y).
const drawBrush = (ctx, { x, y }, r) => {
  ctx.fillStyle = POINTER;
  for (let a = 0; a < Math.PI * 2; a += 0.5 / r + 0.25) {
    ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 1, 1);
  }
};

// ---------- wallpaper ----------

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; // 4x4 ordered dither
// Hill ranges, far then near: height above the floor and how much it rolls (both in tank heights), and two
// wave frequencies.
const RANGES = [
  [0.34, 0.08, 5, 13],
  [0.18, 0.06, 8, 21],
];

// A wallpaper's inks: its base, its accent, a brighter accent, stars, and a shade darker than the base.
const wallpaperInks = (wp) => {
  const { base: b, accent: a } = wp;
  return [
    hslHex(b.h, b.s, b.l),
    hslHex(a.h, a.s, a.l),
    hslHex(a.h, a.s, a.l + 5),
    hslHex(a.h, 25, 60),
    hslHex(b.h, b.s, b.l - 4),
  ].map(rgb);
};

// Which ink goes at (x, y). floor is the dirt line, for the styles with a sky.
const wallpaperInk = (wp, x, y, floor) => {
  const n = wp.size;
  switch (wp.style) {
    case 'stripes':
      return x % (n * 2) < n ? 1 : 0;
    case 'dots': {
      const shift = Math.floor(y / n) % 2 ? Math.floor(n / 2) : 0;
      return (x + shift) % n < 2 && y % n < 2 ? 2 : 0;
    }
    case 'gingham':
      return (Math.floor(x / n) % 2) + (Math.floor(y / n) % 2);
    case 'waves':
      return Math.floor((y + Math.abs((x % (n * 2)) - n)) / n) % 2;
    case 'brick': {
      const w = n * 2 + 1;
      return y % n === 0 || (x + (Math.floor(y / n) % 2) * Math.floor(w / 2)) % w === 0 ? 1 : 0;
    }
    case 'hills':
      // Two ranges in front of a dusk sky, the nearer one darker.
      for (const k of [1, 0]) {
        const [height, roll, f1, f2] = RANGES[k];
        const u = x / floor;
        const phase = (j) => hash(wp.seed, k, j) * Math.PI * 2;
        const wave = 0.6 * Math.sin(u * f1 + phase(1)) + 0.4 * Math.sin(u * f2 + phase(2));
        if (y >= floor * (1 - height - roll * wave)) return k ? 4 : 0;
      }
  }
  // Dusk: dark overhead, brightening toward the horizon in dithered steps, with a few stars up high.
  const f = y / floor;
  if (f < 0.6 && hash(wp.seed, x, y) < 0.004) return 3;
  return Math.min(2, Math.floor(f * f * 2.5 + BAYER[(y % 4) * 4 + (x % 4)] / 16));
};

// Like the terrain, a wallpaper is drawn once into an image the size of the tank above the dirt, and again
// only when the tank changes size.
const papers = new WeakMap();
const wallpaperLayer = (wp, W, floor) => {
  let canvas = papers.get(wp);
  if (!canvas || canvas.width !== W || canvas.height !== floor) {
    canvas = Object.assign(document.createElement('canvas'), { width: W, height: floor });
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(W, floor);
    const inks = wallpaperInks(wp);
    for (let y = 0; y < floor; y++) {
      for (let x = 0; x < W; x++) {
        const [r, g, b] = inks[wallpaperInk(wp, x, y, floor)];
        const i = (y * W + x) * 4;
        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    papers.set(wp, canvas);
  }
  return canvas;
};

// The back of the tank: plain black, or the wallpaper.
const drawWallpaper = (ctx, world) => {
  const wp = world.wallpaper;
  if (!wp) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, world.W, world.H);
    return;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(wallpaperLayer(wp, world.W, world.ground.y0), 0, 0);
};

// ---------- how-tos ----------

// Picking a tool shows how it's used: a little ghost animation in the middle of the tank, straight over whatever
// is there, played once and stopped by a press in the tank. Each is drawn from its age in ticks, around (0, 0).

const DEMO_HEIGHT = 25; // px from the demo plant's base to the top of its flower
const SEEDLING = 0.36; // the share of that a seedling has

// The demo plant, base at (0, 0): a stem with three pairs of leaves and a flower on top.
const DEMO_PLANT = (() => {
  const px = [];
  for (let y = 0; y >= -22; y--) px.push({ x: 0, y, c: '#3f7a34' });
  for (const h of [-6, -12, -18]) {
    for (const s of [-1, 1]) {
      for (const [dx, dy] of [[1, 0], [2, -1], [3, -1], [4, -2]]) px.push({ x: s * dx, y: h + dy, c: '#5fa04a' });
    }
  }
  for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) px.push({ x: dx, y: -24 + dy, c: '#e88fb0' });
  px.push({ x: 0, y: -24, c: COIN });
  return px;
})();
const COIN_DOT = ['.##.', '####', '####', '.##.'];

// How far through from..to age is, 0..1.
const progress = (age, from, to) => Math.min(1, Math.max(0, (age - from) / (to - from)));

// The demo plant standing at x: the part of it from top down (all of it, by default).
const drawDemoPlant = (ctx, x, alpha, top = -Infinity) => {
  ctx.globalAlpha = alpha;
  for (const p of DEMO_PLANT) {
    if (p.y < top) continue;
    ctx.fillStyle = p.c;
    ctx.fillRect(Math.round(x) + p.x, p.y, 1, 1);
  }
};

// Its top, above cutY, t ticks after it was cut off: tumbling away and fading.
const drawFallingTop = (ctx, x, alpha, cutY, t) => {
  ctx.globalAlpha = alpha * Math.max(0, 1 - t / 45);
  if (!ctx.globalAlpha) return;
  const [cos, sin] = [Math.cos(t * 0.03), Math.sin(t * 0.03)];
  for (const p of DEMO_PLANT) {
    if (p.y >= cutY) continue;
    const [rx, ry] = [p.x, p.y - cutY];
    ctx.fillStyle = p.c;
    plot(ctx, x + rx * cos - ry * sin + t * 0.15, rx * sin + ry * cos + cutY + 0.012 * t * t, 1);
  }
};

// The ghost pointer, and the ring a press with it leaves, spreading out and fading as t runs 0..1.
const drawPointer = (ctx, p, alpha) => {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = POINTER;
  plot(ctx, p.x, p.y, 2);
};
const drawTap = (ctx, p, t, alpha) => {
  if (t <= 0 || t >= 1) return;
  ctx.globalAlpha = alpha * (1 - t);
  ctx.fillStyle = POINTER;
  const r = 2 + t * 4;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) plot(ctx, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 1);
};

// Prune: a red line is dragged across a plant, the top falls away and sells for a coin.
const DEMO_CUT = 55; // tick the line finishes crossing the stem and cuts it
const DEMO_CUT_Y = -15; // px above the demo plant's base
const pruneDemo = (ctx, age, fade) => {
  const t = Math.max(0, age - DEMO_CUT);
  drawDemoPlant(ctx, 0, fade, t > 0 ? DEMO_CUT_Y : -Infinity);
  if (t > 0) drawFallingTop(ctx, 0, fade, DEMO_CUT_Y, t);

  // The pruning line being dragged across, the pointer at its end, then fading after the cut.
  const drag = progress(age, 15, DEMO_CUT);
  const [a, b] = [{ x: -12, y: DEMO_CUT_Y + 3 }, { x: 12, y: DEMO_CUT_Y - 3 }];
  ctx.globalAlpha = fade * (1 - progress(age, DEMO_CUT + 10, DEMO_CUT + 35));
  ctx.fillStyle = CUT;
  for (let i = 0; i <= 24 * drag; i++) {
    if (!(Math.floor(i / 2) % 2)) plot(ctx, a.x + (b.x - a.x) * (i / 24), a.y + (b.y - a.y) * (i / 24), 1);
  }
  if (age >= 15 && age < DEMO_CUT) drawPointer(ctx, lerp(a, b, drag), fade);

  // The clipping sells: +1 and a coin float up from the cut.
  if (t > 3) {
    const y = DEMO_CUT_Y - 8 - (t - 3) * 0.2;
    ctx.globalAlpha = fade * Math.max(0, 1 - (t - 3) / 60);
    ctx.fillStyle = COIN;
    [...'+1'].forEach((ch, i) => sprite(ctx, GLYPHS[ch], 3 + i * 4, y));
    sprite(ctx, COIN_DOT, 11, y + 0.5);
  }
};

// Relocate: the pointer takes hold of a plant and drags it across, a ghost of it following under the arrow
// that shows where it will land, and lets go: the plant moves there.
const moveDemo = (ctx, age, fade, world) => {
  const [from, to] = [-14, 14];
  const grab = { x: from, y: -8 };
  const dx = (to - from) * smoothstep(progress(age, 34, 100));
  const dropped = age >= 108;
  drawDemoPlant(ctx, dropped ? to : from, fade);
  if (age >= 34 && !dropped) {
    drawDemoPlant(ctx, from + dx, fade * 0.55);
    ctx.globalAlpha = fade;
    dropArrow(ctx, world, from + dx, -DEMO_HEIGHT - 2);
  }
  const p = age < 34 ? lerp({ x: 2, y: 8 }, grab, smoothstep(progress(age, 0, 24))) : { x: grab.x + dx, y: grab.y };
  drawPointer(ctx, p, fade * Math.min(1, age / 8) * (1 - progress(age, 110, 130)));
  drawTap(ctx, grab, progress(age, 26, 42), fade);
};

// Propagate: the pointer picks a flowering plant (its blinking green plus turns yellow) and taps where its
// cutting goes: a seedling goes in there, the plant is cut back to one too, and both grow again.
const PROPAGATE_AT = 100; // tick the seedling goes in
const propagateDemo = (ctx, age, fade, world) => {
  const [from, to] = [-12, 12];
  const pick = { x: from, y: -12 };
  const spot = { x: to, y: -4 };
  const picked = age >= 32;
  const t = Math.max(0, age - PROPAGATE_AT);
  const seedling = -DEMO_HEIGHT * SEEDLING;
  const p =
    age < 32
      ? lerp({ x: 0, y: 8 }, pick, smoothstep(progress(age, 0, 24)))
      : lerp(pick, spot, smoothstep(progress(age, 44, 88)));
  if (t > 0) {
    const regrown = -DEMO_HEIGHT * (SEEDLING + 0.4 * smoothstep(progress(age, PROPAGATE_AT + 30, 230)));
    drawDemoPlant(ctx, from, fade, regrown);
    drawFallingTop(ctx, from, fade, seedling, t);
    drawDemoPlant(ctx, to, fade, regrown);
  } else {
    drawDemoPlant(ctx, from, fade);
    ctx.globalAlpha = fade * (picked ? 1 : 0.6 + 0.4 * Math.sin(age * 0.1));
    ctx.fillStyle = picked ? COIN : READY_GREEN;
    sprite(ctx, READY, from - 1, -DEMO_HEIGHT - 8);
    if (age >= 44) {
      // The seedling to be, following the pointer.
      drawDemoPlant(ctx, p.x, fade * 0.55, seedling);
      ctx.globalAlpha = fade;
      dropArrow(ctx, world, p.x, seedling - 2);
    }
  }
  drawPointer(ctx, p, fade * Math.min(1, age / 8) * (1 - progress(age, PROPAGATE_AT + 10, PROPAGATE_AT + 34)));
  drawTap(ctx, pick, progress(age, 26, 42), fade);
  drawTap(ctx, spot, progress(age, PROPAGATE_AT - 6, PROPAGATE_AT + 10), fade);
};

// The Editor: the brush is drawn across, leaving a stroke of the material picked.
const paintDemo = (ctx, age, fade, world) => {
  const colors = MATERIAL_COLORS[MATERIALS.find(([key]) => key === world.brush.material)?.[2]];
  if (!colors) return; // erasing: nothing to show
  const along = (u) => ({ x: -18 + 36 * u, y: -6 + 4 * Math.sin(u * Math.PI * 1.5) });
  const drawn = smoothstep(progress(age, 16, 96));
  const r = world.brush.size * CELL;
  if (age >= 16) {
    const pts = Array.from({ length: 25 }, (_, i) => along((i / 24) * drawn));
    ctx.globalAlpha = fade;
    for (let y = -10 - r; y <= r; y += CELL) {
      for (let x = -18 - r; x <= 18 + r; x += CELL) {
        if (!pts.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= r * r)) continue;
        ctx.fillStyle = colors[Math.floor(hash(x, y) * 3)];
        ctx.fillRect(x, y, CELL, CELL);
      }
    }
  }
  const p = age < 16 ? lerp({ x: -8, y: 12 }, along(0), smoothstep(progress(age, 0, 16))) : along(drawn);
  ctx.globalAlpha = fade * Math.min(1, age / 8) * (1 - progress(age, 100, 120));
  drawBrush(ctx, p, r + 1);
};

// Each tool's how-to: how long it runs, in ticks, and how it's drawn.
const DEMOS = {
  prune: [170, pruneDemo],
  move: [200, moveDemo],
  propagate: [260, propagateDemo],
  paint: [140, paintDemo],
};

// The how-to for the tool just picked, while that tool is still in hand.
const drawDemo = (ctx, world) => {
  const { kind, at } = world.demo ?? {};
  const [ticks, draw] = (kind === world.tool && DEMOS[kind]) || [];
  const age = world.time - at;
  if (!(age >= 0 && age < ticks)) return;
  ctx.save();
  ctx.translate(Math.round(world.W / 2), Math.round(world.H / 2 + 12)); // centred in the tank
  draw(ctx, age, Math.min(1, age / 12, (ticks - age) / 30), world);
  ctx.restore();
};

// A shop item waiting to go in: until the pointer comes over the tank, a ghost pointer brings it up from the
// shop below, the item following it as the real one would, and taps it down, over and over.
const PLACE_TICKS = 150;
const drawPlaceDemo = (ctx, world) => {
  const pl = world.placing;
  const age = (world.time - pl.at) % PLACE_TICKS;
  const to = { x: world.W / 2, y: pl.kind === 'vine' ? world.H * 0.3 : world.ground.y0 - 24 };
  const p = lerp({ x: world.W / 2 + 12, y: world.H + 4 }, to, smoothstep(progress(age, 0, 70)));
  const fade = Math.min(1, age / 10, (PLACE_TICKS - age) / 20);
  const spec = previewAt(world, p.x, p.y);
  if (spec) drawPreview(ctx, world, spec, fade);
  drawPointer(ctx, p, fade);
  drawTap(ctx, to, progress(age, 72, 90), fade);
  ctx.globalAlpha = 1;
};

// ---------- fish ----------

const FLAKE_COLORS = ['#d9583b', '#e9a23b', '#e8d36a', '#8fbf5a'];
const fishInks = new WeakMap(); // a genome's colours, worked out once

const inksOf = (g) => {
  if (fishInks.has(g)) return fishInks.get(g);
  const ink = (c, dl = 0) => hslHex(c.h, c.s * (g.albino ? 0.5 : 1), c.l + dl + (g.albino ? 10 : 0));
  const inks = {
    body: ink(g.body),
    back: ink(g.body, -10),
    belly: ink(g.body, 12),
    dark: ink({ h: g.body.h, s: 20, l: 18 }),
    spots: ink(g.spots),
    tail: ink(g.tailColor),
    tip: ink(g.tailColor, 10),
    tail2: ink(g.tailColor2),
    eye: g.albino ? '#d8394a' : '#141414',
    glint: '#eef4ff',
  };
  fishInks.set(g, inks);
  return inks;
};

// How far a tail spreads either side of its middle, t of the way along it.
const TAIL_SHAPES = {
  delta: (t, ped, S) => ped + (S - ped) * t,
  fan: (t, ped, S) => (ped + (S - ped) * Math.sqrt(t)) * (t > 0.8 ? 1 - (t - 0.8) * 1.5 : 1),
  round: (t, ped, S) => Math.max(ped, S * 0.8 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2))),
  spade: (t, ped, S) => (t < 0.55 ? ped + (S * 0.8 - ped) * (t / 0.55) : (S * 0.8 * (1 - t)) / 0.45),
  veil: (t, ped, S) => ped + (S * 1.1 - ped) * Math.sqrt(t),
  sword: (t, ped, S) => ped + (S * 0.6 - ped) * t,
  double: (t, ped, S) => ped + (S * 0.5 - ped) * t,
  lyre: (t, ped, S) => ped + (S - ped) * t,
};

// Where a sword reaches on past the tail, along its lower (or upper) edge.
const swordAt = (t, ped, S) => ped + (S * 0.65 - ped) * Math.min(t, 1);

// The colour of a fish's pixel at (u, v) in its own frame (u from its middle toward its nose, v down), or null if
// it's not on the fish.
const fishInk = (g, ink, shape, u, v, beat, time) => {
  const { len, depth, tail, spread, dorsal } = shape;
  const half = len / 2;
  const ped = depth * 0.18;
  if (u > half) return null;
  if (u > -half) {
    const sb = (u + half) / len; // 0 at the root of the tail .. 1 at the nose
    // Deepest a little in front of the middle, narrowing to the tail and rounding off to the nose.
    const prof =
      sb < 0.55
        ? 0.35 + 0.65 * Math.sin(((sb / 0.55) * Math.PI) / 2)
        : 0.2 + 0.8 * Math.sqrt(1 - ((sb - 0.55) / 0.45) ** 2);
    const hh = (depth / 2) * prof;
    const vv = v - (g.male ? 0 : depth * 0.08) * Math.sin(sb * Math.PI); // a female's belly hangs lower
    if (Math.abs(vv) > hh) {
      // The dorsal fin: a male's long and swept back, a female's a little triangle.
      const fin = g.male
        ? sb > 0.08 && sb < 0.55 && dorsal * clamp((0.55 - sb) / 0.3, 0, 1)
        : sb > 0.3 && sb < 0.55 && dorsal * (1 - Math.abs(sb - 0.42) / 0.13);
      return fin && vv < -hh && -vv - hh < fin ? ink.tail : null;
    }
    if (Math.abs(u - half * 0.62) < 0.75 && Math.abs(vv + hh * 0.25) < 0.75) return ink.eye;
    if (!g.male && sb > 0.3 && sb < 0.55 && vv > hh * 0.15) return ink.dark; // the gravid spot
    if (g.pattern === 'spots' && sb < 0.65 && hash(g.seed, Math.round(u * 1.3), Math.round(v * 1.3)) < 0.2) {
      return ink.spots;
    }
    if (g.pattern === 'snakeskin' && sb < 0.75 && ((Math.round(u) + Math.round(v * 1.5)) & 1) === 0) return ink.back;
    if (g.pattern === 'tuxedo' && sb < 0.5) return ink.dark;
    if (g.metallic && vv < 0 && hash(g.seed, Math.round(u), Math.round(v) + 9, Math.floor(time / 8)) < 0.08) {
      return ink.glint;
    }
    return vv < -hh * 0.35 ? ink.back : vv > hh * 0.4 ? ink.belly : ink.body;
  }
  // The tail, sweeping side to side so it looks shorter and longer, and fluttering up and down a little.
  const t = (-half - u) / (tail * beat);
  const vt = v - (g.tail === 'veil' ? t * t * spread * 0.4 : 0); // a veil droops
  const h = TAIL_SHAPES[g.tail](Math.min(t, 1), ped, spread);
  const notch = g.tail === 'lyre' && t > 0.6 && Math.abs(vt) < h * (t - 0.6) * 2.2;
  if (t <= 1 && Math.abs(vt) <= h && !notch) {
    switch (g.tailPattern) {
      case 'mosaic':
        return hash(g.seed, Math.floor(t * 4), Math.floor(vt / 1.5)) < 0.45 ? ink.tail2 : ink.tail;
      case 'leopard':
        return hash(g.seed, Math.round(t * 6), Math.round(vt)) < 0.22 ? ink.dark : ink.tail;
      case 'grass':
        return hash(g.seed, Math.round(t * 8), Math.round(vt * 1.3), 3) < 0.35 ? ink.tail2 : ink.tail;
      case 'edge':
        return t > 0.8 || Math.abs(vt) > h - 0.8 ? ink.tail2 : ink.tail;
      case 'half':
        return t < 0.45 ? ink.tail2 : ink.tail;
      default:
        return t > 0.7 ? ink.tip : ink.tail;
    }
  }
  // Swords reach on past the end along an edge; a lyre's outer rays do too.
  const sword = (sign) => Math.abs(vt - sign * swordAt(t, ped, spread)) < 0.75;
  if (t > 0.3 && t < 1.5 && ((g.tail !== 'lyre' && sword(1)) || (g.tail === 'double' && sword(-1)))) {
    return g.tail === 'sword' || g.tail === 'double' ? ink.tip : null;
  }
  const rim = ped + (spread - ped) * Math.min(t, 1);
  if (g.tail === 'lyre' && t > 0.8 && t < 1.3 && Math.abs(Math.abs(vt) - rim) < 0.75) return ink.tip;
  return null;
};

// A guppy, side on: every pixel round it looked up in the fish's own frame, which turns as it pitches up and down
// and narrows as it turns round. A male on display curves into a quivering S; out of the water it curls as it flops.
const drawFish = (ctx, world, f) => {
  const g = f.genome;
  const ink = inksOf(g);
  const shape = fishShape(g);
  if (f.flare) [shape.dorsal, shape.spread] = [shape.dorsal * (1 + 0.7 * f.flare), shape.spread * (1 + 0.3 * f.flare)];
  const turning = f.turn > 0;
  const across = facingNow(f);
  const sx = Math.sign(across || 1) * Math.max(0.25, Math.abs(across));
  // Pitch in steps, like sprite frames: the slightest tilt would shuffle every pixel of the fish.
  const pitch = turning ? 0 : Math.round(f.pitch / 0.2) * 0.2;
  const [c, s] = [Math.cos(pitch), Math.sin(pitch)];
  const beat = 0.88 + 0.12 * Math.cos(f.tail);
  const sway = f.display > 0 ? 0.9 : 0;
  const curl = f.dry ? Math.sin(f.tail) * 1.2 : 0;
  const half = shape.len / 2;
  const r = Math.ceil(half + shape.tail * 1.5 + shape.dorsal + 2);
  let current = null;
  for (let py = Math.floor(f.y - r); py <= f.y + r; py++) {
    for (let px = Math.floor(f.x - r); px <= f.x + r; px++) {
      const [dx, dy] = [px + 0.5 - f.x, py + 0.5 - f.y];
      const u = turning ? dx / sx : f.facing * dx * c + dy * s;
      let v = turning ? dy : -f.facing * dx * s + dy * c;
      v -= sway * Math.sin(u * 0.9 + world.time * 0.8) + curl * (u / half) ** 2;
      v -= Math.sin(f.tail) * 0.3 * Math.max(0, (-half - u) / shape.tail) ** 2; // the tail flutters
      const color = fishInk(g, ink, shape, u, v, beat, world.time);
      if (!color) continue;
      if (color !== current) ctx.fillStyle = current = color;
      ctx.fillRect(px, py, 1, 1);
    }
  }
  if (world.selected === f) {
    ctx.fillStyle = COIN;
    sprite(ctx, ARROW, f.x - 2, f.y - shape.depth - shape.dorsal - 6 + (Math.floor(world.time / 20) % 2));
  }
};

// A fish as the shop shows it, or following the pointer before it's let go: side on, facing right, finning.
const posedFish = (genome, x, y, time) => ({ genome, x, y, facing: 1, turn: 0, pitch: 0, tail: time * 0.15 });

// ---------- the world ----------

export const drawWorld = (ctx, world) => {
  const floor = world.ground.y0;
  drawWallpaper(ctx, world);
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(0, floor, world.W, world.H - floor);
  ctx.fillStyle = '#9c7448';
  ctx.fillRect(0, floor, world.W, 1);

  for (const obj of world.objects) if (obj.kind === 'plant') drawPlant(ctx, obj, world.time);
  const sticks = world.branches.filter((g) => g.kind === 'stick');
  for (const g of sticks) drawBranch(ctx, g, woodColors(g.obj.wood), STICK_WIDTH[g.depth] ?? 2, g.obj.foliage);
  for (const g of sticks) for (const leaf of g.leaves) drawLeaf(ctx, g, leaf, g.obj.foliage);
  drawTerrain(ctx, world, false);
  drawGrass(ctx, world.objects.filter((obj) => obj.kind === 'grass'), world.time);
  for (const obj of world.objects) if (obj.kind === 'vine') drawVine(ctx, obj);
  if (world.tool === 'propagate') drawReady(ctx, world);

  const move = relocationAt(world);
  if (move) drawRelocation(ctx, world, move);
  if (world.placing && !world.hover) drawPlaceDemo(ctx, world);
  const preview = world.hover && previewAt(world);
  if (preview) drawPreview(ctx, world, preview);

  for (const bug of world.bugs) drawBug(ctx, world, bug);
  drawTerrain(ctx, world, true); // water over the bugs, so they wade
  // Fish and their food go over the water, just tinted by it: under the full wash of it their colours would be lost.
  for (const f of world.fish) {
    ctx.globalAlpha = f.dry ? 1 : 0.75;
    drawFish(ctx, world, f);
  }
  for (const fl of world.flakes) {
    ctx.globalAlpha = Math.min(0.85, fl.life / 60);
    ctx.fillStyle = FLAKE_COLORS[Math.floor(fl.seed) % FLAKE_COLORS.length];
    ctx.fillRect(Math.round(fl.x), Math.round(fl.y), 1, 1);
  }
  ctx.globalAlpha = 1;

  for (const c of world.crumbs) {
    ctx.fillStyle = CRUMB_COLORS[c.shade];
    ctx.fillRect(Math.round(c.x), Math.round(c.y), 1, 1);
  }
  for (const p of world.debris) {
    ctx.globalAlpha = Math.min(1, p.life / 40);
    ctx.fillStyle = debrisColor(p.look);
    line(ctx, add(p.c, p.h, -1), add(p.c, p.h), 1.5);
  }
  ctx.globalAlpha = 1;

  const cut = world.cut;
  if (cut) {
    // The pruning line: dashed red.
    const len = Math.hypot(cut.x1 - cut.x0, cut.y1 - cut.y0);
    ctx.fillStyle = CUT;
    for (let i = 0; i <= len; i++) {
      if (Math.floor(i / 2) % 2) continue;
      plot(ctx, cut.x0 + ((cut.x1 - cut.x0) * i) / (len || 1), cut.y0 + ((cut.y1 - cut.y0) * i) / (len || 1), 1);
    }
  }

  const aim = aimAt(world);
  if (aim) drawAim(ctx, world, aim);

  ctx.fillStyle = COIN;
  for (const p of world.popups) {
    ctx.globalAlpha = Math.min(1, p.life / 20);
    [...p.text].forEach((ch, i) => sprite(ctx, GLYPHS[ch], p.x - 4 + i * 4, p.y));
  }
  ctx.globalAlpha = 1;
  drawDemo(ctx, world);
  if (world.tool === 'paint' && world.hover) drawBrush(ctx, world.pointer, world.brush.size * CELL + 1);
};
