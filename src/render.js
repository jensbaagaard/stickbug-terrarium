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
import { add, hash, hslHex, lerp, normalize, pointAt, segDir, segLength, segNormal } from './geom.js';
import { FAR_SHADE, bodyHex, patternHex, patternOf, traitsOf } from './genome.js';
import { DEFAULT_FOLIAGE } from './decor.js';
import { CELL, DIRT, EMPTY, FOUNTAIN, SAND, STONE, WATER } from './terrain.js';
import { floorBelow, previewAt, relocationAt } from './sim.js';

const NOTE = ['..#.', '..##', '..#.', '..#.', '###.', '##..'];
const ARROW = ['#####', '.###.', '..#..'];
const CRUMB_COLORS = ['#3f8f4f', '#7fbf5a'];
const BRANCH = { dark: '#5a3d24', light: '#8a6440' };
const COIN = '#f2c94c';
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

// Branches hang below their surface line, lit along the top. Sticks may have knots and patches of moss.
const drawBranch = (ctx, g, colors, width = 3, look = null) => {
  const n = segNormal(g);
  const a = { x: g.x0, y: g.y0 };
  const b = { x: g.x1, y: g.y1 };
  ctx.fillStyle = colors.dark;
  line(ctx, add(a, n, -width / 2), add(b, n, -width / 2), width);
  ctx.fillStyle = colors.light;
  line(ctx, add(a, n, -0.5), add(b, n, -0.5), 1);
  if (!look) return;
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
    const turn = (st.root.x * 13 + st.root.y * 7) % 6.28;
    drawFlower(ctx, sp.flower, sway(st.tip), st.flower, turn, st.sideBloom ? 0.55 : 1);
  }
};

// Grass: tufts of blades fanning up from the dirt, lighter toward the tips and leaning in the breeze, some
// with seed heads or little blossoms once grown.
const drawGrass = (ctx, patch, time) => {
  const g = patch.genome;
  const tones = [0, 0.5, 1].map((f) => hslHex(g.blade.h, g.blade.s, g.blade.l + g.tipLight * f));
  for (const tuft of patch.tufts) {
    const sway = Math.sin(time * 0.03 + tuft.x * 0.2) * 0.15;
    for (let b = 0; b < g.blades; b++) {
      const a = -Math.PI / 2 + g.lean + (b - (g.blades - 1) / 2) * g.fan;
      const len = g.height * tuft.size * (0.7 + 0.5 * hash(tuft.seed, b, 1));
      let tip = null;
      for (let k = 0; k <= len; k++) {
        const f = k / Math.max(1, len);
        const x = tuft.x + Math.cos(a) * k + sway * k * f;
        const y = tuft.y + Math.sin(a) * k;
        ctx.fillStyle = tones[Math.min(2, Math.floor(f * 3))];
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
        tip = { x, y };
      }
      if (!tip || tuft.size < 0.8) continue;
      if (g.seeds && b % 2 === 0) {
        ctx.fillStyle = hslHex(g.seeds.h, g.seeds.s, g.seeds.l);
        ctx.fillRect(Math.round(tip.x), Math.round(tip.y) - 1, 1, 2);
      }
      if (g.blossom && b === 0 && hash(tuft.seed, 9) < 0.5) {
        ctx.fillStyle = hslHex(g.blossom.h, g.blossom.s, g.blossom.l);
        plot(ctx, tip.x, tip.y, 2);
      }
    }
  }
};

// A hanging vine: its stem through the rope's nodes, a leaf off each node on alternating sides (smaller near
// the growing tip), pale-edged if variegated, and a flower every few nodes.
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
    if (g.flower && i % g.flower.every === 0 && grown >= 1) {
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
  const vineStem = look.vine?.genome.stem;
  if (look.kind === 'vine') return hslHex(vineStem.h, vineStem.s, vineStem.l);
  const stem = look.plant?.species.stem;
  if (look.kind === 'stem') return hslHex(stem.h, stem.s, stem.l);
  return BRANCH.light;
};

// A plant being relocated: a ghost of it where it would land, with the arrow under its new base.
const drawRelocation = (ctx, world, move) => {
  const { obj } = move;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.translate(Math.round(move.dx), Math.round(move.dy));
  if (obj.kind === 'plant') drawPlant(ctx, obj, world.time);
  else if (obj.kind === 'grass') drawGrass(ctx, obj, world.time);
  else drawVine(ctx, obj);
  ctx.restore();
  ctx.fillStyle = COIN;
  sprite(ctx, ARROW, move.base.x - 2, move.base.y + 1 + (Math.floor(world.time / 15) % 2));
};

// A shop item following the pointer, before it's put down.
const drawPreview = (ctx, world, spec) => {
  ctx.globalAlpha = 0.55;
  if (spec.kind === 'stick') {
    ctx.fillStyle = woodColors(spec.wood).light;
    for (const p of spec.pieces) line(ctx, p.a, p.b, STICK_WIDTH[p.depth] ?? 2);
  } else if (spec.kind === 'fountain') {
    const { x, y, size } = spec.box;
    ctx.fillStyle = MATERIAL_COLORS[FOUNTAIN][0];
    ctx.fillRect(x, y, size, size);
  } else if (spec.kind === 'grass') {
    // A seedling tuft.
    const tufts = [{ x: spec.base.x, y: spec.base.y, size: 0.6, seed: 1 }];
    drawGrass(ctx, { genome: spec.genome, tufts }, world.time);
  } else if (spec.kind === 'vine') {
    // A short sprig hanging from where it would be anchored.
    const { x, y } = spec.base;
    const nodes = [0, 1, 2, 3].map((k) => ({ x, y: y + k * spec.genome.spacing }));
    drawVine(ctx, { genome: spec.genome, nodes });
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
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = COIN;
  sprite(ctx, ARROW, spec.base.x - 2, spec.base.y + 1 + (Math.floor(world.time / 15) % 2));
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
// grain keeps its own shade as it moves.
const shades = (h, s, l) => [l, l - 2, l + 2].map((v) => hslHex(h, s, v));
export const MATERIAL_COLORS = {
  [STONE]: shades(240, 3, 44),
  [DIRT]: shades(28, 40, 25),
  [SAND]: shades(44, 52, 70),
  [WATER]: shades(212, 60, 47),
  [FOUNTAIN]: shades(186, 38, 56),
};
const WATER_TOP = '#7fb2ee';
const WATER_ALPHA = 0.6;

// The colour of cell i, or null; water cells only when water is asked for, solids otherwise.
const cellColor = (ter, i, water) => {
  const m = ter.cells[i];
  if (m === EMPTY || (m === WATER) !== water) return null;
  if (water && (i < ter.cols || ter.cells[i - ter.cols] !== WATER)) return WATER_TOP;
  return MATERIAL_COLORS[m][ter.tint[i]];
};

const rgbCache = new Map();
const rgb = (hex) => {
  let v = rgbCache.get(hex);
  if (!v) rgbCache.set(hex, (v = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16))));
  return v;
};

// In the browser each layer is an image the size of the grid, redrawn only when the terrain changes and
// scaled up onto the tank.
const layers = new WeakMap();
const terrainLayer = (ter, water) => {
  let cache = layers.get(ter);
  if (!cache) layers.set(ter, (cache = {}));
  let layer = cache[water];
  if (!layer) {
    const canvas = Object.assign(document.createElement('canvas'), { width: ter.cols, height: ter.rows });
    const ctx = canvas.getContext('2d');
    layer = cache[water] = { canvas, ctx, image: ctx.createImageData(ter.cols, ter.rows), version: -1 };
  }
  if (layer.version !== ter.version) {
    const data = layer.image.data;
    for (let i = 0; i < ter.cells.length; i++) {
      const c = cellColor(ter, i, water);
      if (c) {
        const [r, g, b] = rgb(c);
        data[i * 4] = r;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = b;
      }
      data[i * 4 + 3] = c ? 255 : 0;
    }
    layer.ctx.putImageData(layer.image, 0, 0);
    layer.version = ter.version;
  }
  return layer.canvas;
};

const drawTerrain = (ctx, world, water) => {
  const ter = world.terrain;
  ctx.globalAlpha = water ? WATER_ALPHA : 1;
  if (typeof document !== 'undefined' && ctx.drawImage) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrainLayer(ter, water), 0, ter.top, ter.cols * CELL, ter.rows * CELL);
  } else {
    // No DOM (tests): runs of same-coloured cells as rectangles.
    for (let r = 0; r < ter.rows; r++) {
      let c = 0;
      while (c < ter.cols) {
        const color = cellColor(ter, r * ter.cols + c, water);
        let end = c + 1;
        while (end < ter.cols && cellColor(ter, r * ter.cols + end, water) === color) end++;
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(c * CELL, ter.top + r * CELL, (end - c) * CELL, CELL);
        }
        c = end;
      }
    }
  }
  ctx.globalAlpha = 1;
};

// The brush outline, dotted, while painting terrain.
const drawBrush = (ctx, world) => {
  const r = world.brush.size * CELL + 1;
  const { x, y } = world.pointer;
  ctx.fillStyle = '#e3d3b5';
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

// The back of the tank: plain black, or the wallpaper (just its base colour when there's no DOM).
const drawWallpaper = (ctx, world) => {
  const wp = world.wallpaper;
  if (wp && typeof document !== 'undefined' && ctx.drawImage) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(wallpaperLayer(wp, world.W, world.ground.y0), 0, 0);
    return;
  }
  ctx.fillStyle = wp ? hslHex(wp.base.h, wp.base.s, wp.base.l) : '#000';
  ctx.fillRect(0, 0, world.W, world.H);
};

// ---------- the world ----------

export const drawWorld = (ctx, world) => {
  const floor = world.ground.y0;
  drawWallpaper(ctx, world);
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(0, floor, world.W, world.H - floor);
  ctx.fillStyle = '#9c7448';
  ctx.fillRect(0, floor, world.W, 1);

  for (const obj of world.objects) if (obj.kind === 'plant') drawPlant(ctx, obj, world.time);
  for (const g of world.branches) {
    if (g.kind === 'branch') drawBranch(ctx, g, BRANCH);
    else if (g.kind === 'stick') drawBranch(ctx, g, woodColors(g.obj.wood), STICK_WIDTH[g.depth] ?? 2, g.obj.foliage);
  }
  for (const g of world.branches) {
    const foliage = g.obj?.foliage ?? DEFAULT_FOLIAGE;
    for (const leaf of g.leaves) drawLeaf(ctx, g, leaf, foliage);
  }
  drawTerrain(ctx, world, false);
  for (const obj of world.objects) if (obj.kind === 'grass') drawGrass(ctx, obj, world.time);
  for (const obj of world.objects) if (obj.kind === 'vine') drawVine(ctx, obj);

  const move = relocationAt(world);
  if (move) drawRelocation(ctx, world, move);
  const preview = previewAt(world);
  if (preview) drawPreview(ctx, world, preview);

  for (const bug of world.bugs) drawBug(ctx, world, bug);
  drawTerrain(ctx, world, true); // water over the bugs, so they wade

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
    ctx.fillStyle = '#e04a3a';
    for (let i = 0; i <= len; i++) {
      if (Math.floor(i / 2) % 2) continue;
      plot(ctx, cut.x0 + ((cut.x1 - cut.x0) * i) / (len || 1), cut.y0 + ((cut.y1 - cut.y0) * i) / (len || 1), 1);
    }
  }

  ctx.fillStyle = COIN;
  for (const p of world.popups) {
    ctx.globalAlpha = Math.min(1, p.life / 20);
    [...p.text].forEach((ch, i) => sprite(ctx, GLYPHS[ch], p.x - 4 + i * 4, p.y));
  }
  ctx.globalAlpha = 1;
  if (world.tool === 'paint') drawBrush(ctx, world);
};
