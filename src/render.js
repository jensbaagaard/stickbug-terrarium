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
  distToSeg,
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
import { stickWidth } from './decor.js';
import {
  BASALT,
  BROWNSTONE,
  CELL,
  DIRT,
  EMPTY,
  FOUNTAIN,
  ICE,
  makeTerrain,
  MATERIALS,
  SAND,
  SANDSTONE,
  SNOW,
  STONE,
  WATER,
  WOOD,
} from './terrain.js';
import { aimAt, floorBelow, previewAt, propagatable, relocationAt } from './sim.js';
import { facingNow, fishShape } from './fish.js';
import { flierShape } from './fliers.js';
import { RIPPLE_TICKS, snowing, wind } from './life.js';
import { params } from './tuning.js';

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
const BUD = 0.4; // a flower is a closed bud till it's this far open

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

// A stick's branches hang below their surface line, lit along the top, maybe with knots and patches of moss.
// Bamboo is ringed at its nodes, and a cholla skeleton is full of holes.
const drawBranch = (ctx, g, colors, width, look, style) => {
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
    if (style === 'cholla' && i % 3 === 0) {
      ctx.fillStyle = colors.knot;
      const across = (i / 3) % 2 ? 0.35 : 0.65;
      plot(ctx, p.x - n.x * width * across, p.y - n.y * width * across, 1);
    }
  }
  if (style === 'bamboo' && g.parent) {
    ctx.fillStyle = colors.knot;
    line(ctx, add(a, n, -0.5), add(a, n, 0.5 - width), 1);
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

// The pale parts of a mutant's leaf, where it has no chlorophyll, along a leaf of length len from base along axis,
// widthAt(f) across f of the way along. m is the mutation ({mark, color, amount}) and this leaf's seed and side.
// Marbled patches and speckles cover more of some leaves than others; half-moon leaves are pale down one side
// (now and then all over, or not at all); a rim edges the leaf.
const paleMarks = (ctx, base, axis, len, widthAt, m) => {
  const n = { x: -axis.y, y: axis.x };
  const share = m.amount * (0.3 + 1.2 * hash(m.seed, 1));
  const whole = hash(m.seed, 2);
  ctx.fillStyle = hslHex(m.color.h, m.color.s, m.color.l);
  for (let i = 0; i <= len; i++) {
    const w = widthAt(i / len);
    const at = (k, size) => plot(ctx, base.x + axis.x * i + n.x * k, base.y + axis.y * i + n.y * k, Math.max(1, size));
    if (m.mark === 'half') {
      if (whole < 0.15) at(0, w);
      else if (whole < 0.85) at(m.side * w * 0.25, w * 0.5);
    } else if (m.mark === 'rim') {
      if (w >= 2) for (const k of [-1, 1]) at(k * (w * 0.5 - 0.5), 1);
    } else if (m.mark === 'speckle') {
      for (let k = Math.round(-w / 2); k <= w / 2; k++) if (hash(m.seed, i, k) < share * 0.6) at(k, 1);
    } else if (hash(m.seed, Math.floor(i / 2), 3) < share) {
      at((hash(m.seed, i, 4) - 0.5) * w * 0.5, w * (0.4 + 0.5 * hash(m.seed, Math.floor(i / 2), 5))); // marbled
    }
  }
};

// One leaf reaching len along axis from base, filled to its form's width, with a darker vein in big ones, and a
// mutant's pale marks (mark, see paleMarks).
const leafShape = (ctx, base, axis, len, form, s, fill, vein, mark = null) => {
  ctx.fillStyle = fill;
  for (let i = 0; i <= len; i++) plot(ctx, base.x + axis.x * i, base.y + axis.y * i, form.width(i / len, s));
  if (mark) paleMarks(ctx, base, axis, len, (f) => form.width(f, s), mark);
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

// A #rrggbb colour a share k of the way to the dull brown a flower goes as it wilts. Mixed as light, not round the
// colour wheel, so a blue flower dulls to slate rather than passing through green.
const BROWN = [110, 84, 58];
const wither = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v + (BROWN[i] - v) * k));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
};

// Draws onto ctx with every colour withered a share k of the way: for a wilting flower, whatever its form.
const withering = (ctx, k) => ({
  set fillStyle(c) {
    ctx.fillStyle = wither(c, k);
  },
  fillRect: (x, y, w, h) => ctx.fillRect(x, y, w, h),
});

// A closed bud at the end of a stem (c, the stem heading along d), swelling as grow goes 0 -> 1: green, the colour of
// its petals showing at its tip as it gets ready to open.
const drawBud = (ctx, sp, c, d, grow, scale) => {
  const f = sp.flower;
  const len = (1 + 2.5 * grow) * f.size * scale;
  const wide = (0.8 + f.petalWidth * grow) * f.size * scale * 0.6;
  const green = hslHex(sp.stem.h, sp.stem.s, sp.stem.l + 8);
  const petal = hslHex(f.petal.h, f.petal.s, f.petal.l - 8);
  for (let k = 0; k <= len; k += 0.5) {
    const u = k / len;
    ctx.fillStyle = u > 1 - 0.6 * grow ? petal : green;
    plot(ctx, c.x + d.x * k, c.y + d.y * k, Math.max(1, wide * Math.sin(Math.PI * (0.25 + 0.75 * u))));
  }
};

// A flower at c, in its species' form, opening as bloom goes 0 -> 1, then wilting as wilt goes 0 -> 1: browning, its
// petals drooping and dropping one by one. Petals shade from base to tip.
const drawFlower = (ctx, f, c, bloom, turn, scale = 1, wilt = 0) => {
  if (wilt > 0) ctx = withering(ctx, wilt * 0.8);
  const s = f.size * scale * (0.3 + 0.7 * bloom);
  const len = f.petalLen * s;
  const wide = f.petalWidth * s;
  const left = 1 - wilt; // the share of its petals still on
  const petalAt = (u) => hslHex(f.petal.h + (f.tip.h - f.petal.h) * u, f.petal.s, f.petal.l + f.tip.l * u);
  const centre = hslHex(f.centre.h, f.centre.s, f.centre.l);
  const row = (x, y, w) => ctx.fillRect(Math.round(x - w / 2), Math.round(y), Math.max(1, Math.round(w)), 1);
  const radial = (n, reach, width, color, offset) => {
    for (let i = Math.floor(wilt * n); i < n; i++) {
      const a0 = offset + (i / n) * Math.PI * 2;
      const a = a0 + Math.atan2(Math.cos(a0), Math.sin(a0)) * wilt * 0.6; // drooping toward straight down
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
        row(c.x, c.y + k, 1 + wide * 1.4 * (k / h) ** 0.8 * (0.4 + 0.6 * left));
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
        row(c.x, c.y - k, 1 + wide * 1.6 * Math.sin(Math.PI * (0.25 + 0.6 * (k / h))) * (0.4 + 0.6 * left));
      }
      return;
    }
    case 'cluster': {
      // A dome of little florets.
      const r = (1 + f.petalLen * 0.7) * s;
      for (let i = 0; i < (f.petals + 3) * left; i++) {
        const a = -Math.PI * (0.05 + 0.9 * hash(turn * 97, i, 1));
        const d = r * Math.sqrt(hash(turn * 97, i, 2));
        ctx.fillStyle = petalAt(hash(turn * 97, i, 3));
        plot(ctx, c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, Math.max(1, wide * 0.8));
      }
      return;
    }
    case 'spike': {
      // Florets stacked up the stem tip, smaller toward the top.
      for (let i = 0; i < f.petals * left; i++) {
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
          if (x * x + y * y > r * r || hash(turn * 97 + x, y, 6) < wilt) continue;
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

// A leaf's colour as it gets old: yellowing as fade goes 0 -> 1, then browning as rot goes 0 -> 1 on the ground.
// Returns [h, s, l].
const agedLeaf = ({ h, s, l }, fade, rot = 0) => {
  const toward = (a, b) => a + (b - a) * fade;
  const yellow = [h + (((((45 - h) % 360) + 540) % 360) - 180) * fade, toward(s, 70), toward(l, 52)];
  return yellow.map((v, i) => v + ([28, 38, 30][i] - v) * rot);
};

// A plant as the breeze has bent it, its old leaves yellowing and drooping, its flowers in bud, open or wilting.
const drawPlant = (ctx, plant) => {
  const sp = plant.species;
  if (sp.form) return drawClump(ctx, plant);
  ctx.fillStyle = hslHex(sp.stem.h, sp.stem.s, sp.stem.l);
  for (const st of plant.stems) line(ctx, st.root, st.tip, 1.2);
  const form = LEAF_FORMS[sp.shape];
  for (const st of plant.stems) {
    for (const leaf of st.leaves) {
      const fade = leaf.fade ?? 0;
      const a = st.angle + leaf.side * (0.95 + 0.6 * fade); // yellowing, it droops
      const [h, s, l] = agedLeaf({ ...sp.leaf, l: sp.leaf.l + leaf.side * 4 }, fade);
      const len = (1.5 + 4 * leaf.size) * sp.leafSize * form.len;
      const at = lerp(st.root, st.tip, leaf.at);
      const mark = sp.mutation && { ...sp.mutation, seed: st.angle * 1000 + leaf.at * 31 + leaf.side, side: leaf.side };
      leafShape(ctx, at, dirOf(a), len, form, leaf.size * sp.leafSize, hslHex(h, s, l), hslHex(h, s, l - 9), mark);
    }
  }
  for (const st of plant.stems) {
    if (st.flower <= 0) continue;
    const scale = st.sideBloom ? 0.55 : 1;
    if (st.flower < BUD) {
      drawBud(ctx, sp, st.tip, normalize({ x: st.tip.x - st.root.x, y: st.tip.y - st.root.y }), st.flower / BUD, scale);
      continue;
    }
    const turn = (st.angle * 1000) % 6.28; // not its position, which moves as it bends
    drawFlower(ctx, sp.flower, st.tip, (st.flower - BUD) / (1 - BUD), turn, scale, st.wilt ?? 0);
  }
};

// ---------- clump plants ----------

// A clump plant's chains (its leaves, flower stalks and runners), each as its stems from the crown out.
const chainsOf = (plant) => {
  const next = new Map();
  for (const st of plant.stems) if (st.parent) next.set(st.parent, st);
  return plant.stems
    .filter((st) => !st.parent)
    .map((root) => {
      const chain = [root];
      for (let s = next.get(root); s; s = next.get(s)) chain.push(s);
      return chain;
    });
};

// Points a pixel or so apart along a chain, from the crown out: where, the way across it (n), how far along it is
// (along, px) and its share of the way (u, 0..1).
const chainPoints = (chain) => {
  const total = chain.reduce((sum, st) => sum + st.len, 0) || 1;
  const pts = [];
  let along = 0;
  for (const st of chain) {
    const { root: a, tip: b } = st;
    const n = st.len > 0 ? { x: -(b.y - a.y) / st.len, y: (b.x - a.x) / st.len } : { x: 1, y: 0 };
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))));
    for (let k = pts.length ? 1 : 0; k <= steps; k++) {
      const f = k / steps;
      const at = along + st.len * f;
      pts.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, n, along: at, u: at / total });
    }
    along += st.len;
  }
  return { pts, total };
};

// Clump leaf shapes that are a blade on a bare stalk (the first petiole of the leaf).
const BLADES = ['paddle', 'lance', 'heart', 'monstera', 'coin'];

// Half the width of a clump plant's leaf u of the way along it, and grown (0..1) of its full length.
const clumpWidth = (sp, u, grown) => {
  const w = sp.leafWidth * (0.5 + 0.5 * grown);
  if (BLADES.includes(sp.shape) && u < sp.petiole) return 0; // the bare stalk
  const v = (u - sp.petiole) / (1 - sp.petiole); // how far along the blade
  switch (sp.shape) {
    case 'paddle':
      return w * Math.sin(Math.PI * Math.min(1, 0.08 + v * 0.92)) ** 0.7;
    case 'lance':
      return w * Math.sin(Math.PI * Math.min(1, 0.06 + v * 0.94)) ** 0.9 * (1 - 0.25 * v);
    case 'heart':
    case 'monstera':
      return w * Math.min(1, 0.7 + v * 2.5, (1 - v) * 1.6); // broad at the base, narrowing to a point
    case 'coin':
      return w * Math.sqrt(Math.max(0, 1 - (2 * v - 1) ** 2));
    case 'fleshy':
      return w * (1 - u) ** 0.7 * Math.min(1, 0.6 + u * 4);
    case 'column':
      return w * Math.sqrt(Math.max(0, 1 - Math.max(0, (u - 0.85) / 0.15) ** 2)); // rounded at the top
    case 'pinnate':
      return 0; // a stalk with leaflets along it, drawn by drawFrond
    case 'strap':
      return w * Math.min(1, (1 - u) * 3, 0.6 + u * 3);
    case 'sword':
      return w * Math.min(1, (1 - u) * 4, 0.75 + u * 2);
    default: // blade: a grass leaf, tapering to a fine point
      return w * (1 - 0.85 * u);
  }
};

// Single pixels, put one after another, filled as runs: a row or a column of them is one rect, not many. flush()
// fills what's left; do so before changing colour.
const pixelRuns = (ctx) => {
  let [x0, y0, w, h] = [0, 0, 0, 0];
  const flush = () => {
    if (w) ctx.fillRect(x0, y0, w, h);
    w = 0;
  };
  const put = (x, y) => {
    if (w) {
      if (h === 1 && y === y0 && (x === x0 + w || x === x0 - 1)) {
        x0 = Math.min(x0, x);
        w++;
        return;
      }
      if (w === 1 && x === x0 && (y === y0 + h || y === y0 - 1)) {
        y0 = Math.min(y0, y);
        h++;
        return;
      }
      if (x >= x0 && x < x0 + w && y >= y0 && y < y0 + h) return;
      ctx.fillRect(x0, y0, w, h);
    }
    [x0, y0, w, h] = [x, y, 1, 1];
  };
  return { put, flush };
};

// One leaf: shaded a little darker the further back (older) it is. Paddles are two-tone with a pale midrib on a bare
// stalk; grass blades lighten toward the tip; stripes run down the middle or the edges; swords have wavy bands.
const drawClumpLeaf = (ctx, sp, chain, back) => {
  const root = chain[0];
  const { pts, total } = chainPoints(chain);
  const grown = Math.min(1, total / (root.full || total));
  const l = sp.leaf.l + (hash(root.seed, 1) - 0.5) * 4 - back * 5;
  const hex = (dl, ds = 0, c = sp.leaf) => hslHex(c.h, c.s + ds, l - sp.leaf.l + c.l + dl);
  const widths = pts.map((p) => clumpWidth(sp, p.u, grown));
  // Square dabs along the leaf, size(w, p) across; wide ones overlap plenty, so they're spaced out, and pixel-wide
  // ones are filled as runs.
  const runs = pixelRuns(ctx);
  const stamp = (color, size, off = 0) => {
    let last = -Infinity; // px along the leaf of the last dab
    let fill = null;
    for (let i = 0; i < pts.length; i++) {
      const s = size(widths[i], pts[i], i);
      if (s <= 0) continue;
      const d = Math.max(1, s);
      if (d >= 3 && pts[i].along - last < d * 0.4 && i < pts.length - 1) continue;
      last = pts[i].along;
      const c = typeof color === 'function' ? color(pts[i]) : null;
      if (c && c !== fill) {
        runs.flush();
        ctx.fillStyle = fill = c;
      }
      const x = pts[i].x + pts[i].n.x * off * widths[i];
      const y = pts[i].y + pts[i].n.y * off * widths[i];
      if (d < 1.5) runs.put(Math.ceil(x - 0.5), Math.ceil(y - 0.5));
      else plot(ctx, x, y, d);
    }
    runs.flush();
  };
  if (BLADES.includes(sp.shape)) {
    ctx.fillStyle = hslHex(sp.stem.h, sp.stem.s, sp.stem.l - back * 4);
    stamp(null, (w, p) => (p.u < sp.petiole ? 1.4 : 0));
    if (sp.shape === 'monstera') {
      // A few deep splits from the edges in toward the midrib, and a row of holes inside them.
      const slit = (p, k, w) => {
        const v = (p.u - sp.petiole) / (1 - sp.petiole);
        if (v < 0.15 || v > 0.9) return false;
        const at = (p.along + k * 0.5) % 6.5; // the splits lean back toward the stalk as they go out
        return (k > w * 0.42 && at < 1.7) || (k > w * 0.18 && k < w * 0.32 && at > 3 && at < 4.6);
      };
      splitBlade(ctx, sp, chain, total, grown, root.side, hex(-4), hex(4), slit);
    } else {
      ctx.fillStyle = hex(-4);
      stamp(null, (w) => w * 2);
      ctx.fillStyle = hex(4);
      stamp(null, (w) => w, root.side * 0.5); // the lit half
    }
    bladePattern(ctx, sp, pts, widths, root, hex);
    if (sp.mutation) clumpMarks(ctx, sp.mutation, pts, widths, root);
    if (sp.shape !== 'coin') {
      ctx.fillStyle = hslHex(sp.stem.h, sp.stem.s, sp.stem.l + 12); // the midrib
      stamp(null, (w) => (w > 0 ? 1 : 0));
    }
    return;
  }
  if (sp.shape === 'pinnate') return drawFrond(ctx, sp, pts, grown, hex);
  if (sp.shape === 'column') {
    // A ribbed cactus column, lit down one side, its ribs and edges dotted with spines.
    ctx.fillStyle = hex(-2);
    stamp(null, (w) => w * 2);
    ctx.fillStyle = hex(6);
    stamp(null, (w) => w * 0.7, root.side * 0.45);
    ctx.fillStyle = hex(-10);
    for (const off of [-0.55, 0.55]) stamp(null, (w) => (w > 1 ? 1 : 0), off);
    ctx.fillStyle = hslHex(sp.spines.h, sp.spines.s, sp.spines.l);
    pts.forEach((p, i) => {
      if (i % 2 || widths[i] <= 0) return;
      for (const k of [-1, -0.55, 0.55, 1]) {
        if (hash(root.seed + i, k * 10, 12) > 0.55) continue;
        const r = k * widths[i] + Math.sign(k) * (Math.abs(k) === 1 ? 0.6 : 0);
        plot(ctx, p.x + p.n.x * r, p.y + p.n.y * r, 1);
      }
    });
    if (sp.mutation) clumpMarks(ctx, sp.mutation, pts, widths, root);
    return;
  }
  if (sp.shape === 'fleshy') {
    // A plump succulent leaf, lit down one side, maybe spotted, toothed or blushing at the tip.
    ctx.fillStyle = hex(-3);
    stamp(null, (w) => w * 2);
    ctx.fillStyle = hex(6);
    stamp(null, (w) => w, root.side * 0.5);
    if (sp.tips) {
      ctx.fillStyle = hslHex(sp.tips.h, sp.tips.s, sp.tips.l);
      stamp(null, (w, p) => (p.u > 0.72 ? w * 2 : 0));
    }
    bladePattern(ctx, sp, pts, widths, root, hex);
    if (sp.teeth) {
      ctx.fillStyle = hex(18, -10);
      pts.forEach((p, i) => {
        if (i % 4 || widths[i] < 0.6) return;
        for (const k of [-1, 1]) plot(ctx, p.x + p.n.x * k * (widths[i] + 0.5), p.y + p.n.y * k * (widths[i] + 0.5), 1);
      });
    }
    if (sp.mutation) clumpMarks(ctx, sp.mutation, pts, widths, root);
    return;
  }
  const edge = sp.stripe?.where === 'edge';
  if (sp.shape === 'blade') stamp((p) => hex(Math.round(p.u * 3) * 2), (w) => w * 2);
  else {
    ctx.fillStyle = edge ? hslHex(sp.stripe.h, sp.stripe.s, sp.stripe.l) : hex(0);
    stamp(null, (w) => w * 2);
  }
  if (edge) {
    ctx.fillStyle = hex(0);
    stamp(null, (w) => (w * 2 - 1.2 >= 1 ? w * 2 - 1.2 : 0));
  }
  if (sp.bands) {
    ctx.fillStyle = hex(14, -12);
    const band = (p) => Math.floor((p.along + Math.sin(p.x * 0.9 + root.seed) * 0.8) / 2.5) % 2 === 0;
    stamp(null, (w, p) => (band(p) ? w * 1.5 : 0));
  }
  if (sp.stripe?.where === 'centre') {
    ctx.fillStyle = hslHex(sp.stripe.h, sp.stripe.s, sp.stripe.l);
    stamp(null, (w) => (w > 0.8 ? Math.max(1, w * 0.7) : 0));
  }
  if (sp.mutation) clumpMarks(ctx, sp.mutation, pts, widths, root);
};

// A mutant clump leaf's pale parts, as paleMarks does for other leaves: along its points pts, half widths across.
const clumpMarks = (ctx, m, pts, widths, root) => {
  const share = m.amount * (0.3 + 1.2 * hash(root.seed, 1));
  const whole = hash(root.seed, 2);
  ctx.fillStyle = hslHex(m.color.h, m.color.s, m.color.l);
  pts.forEach((p, i) => {
    const w = widths[i];
    if (w <= 0) return;
    const at = (k, size) => plot(ctx, p.x + p.n.x * k, p.y + p.n.y * k, Math.max(1, size));
    if (m.mark === 'half') {
      if (whole < 0.15) at(0, w * 2);
      else if (whole < 0.85) at(root.side * w * 0.5, w);
    } else if (m.mark === 'rim') {
      if (w >= 1) for (const k of [-1, 1]) at(k * (w - 0.5), 1);
    } else if (m.mark === 'speckle') {
      for (let k = Math.round(-w); k <= w; k++) if (hash(root.seed + i, k, 6) < share * 0.6) at(k, 1);
    } else if (hash(root.seed, Math.floor(p.along / 2.5), 3) < share) {
      at((hash(root.seed, i, 4) - 0.5) * w, w * (0.8 + hash(root.seed, Math.floor(p.along / 2.5), 5))); // marbled
    }
  });
};

const rotate = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });

// A blade with gaps in it (a monstera's splits and holes), filled a row of pixels at a time: each pixel near the
// leaf is projected onto its stems, which says how far along the leaf it is and how far out from the midrib, and
// on which side, so whether it's in the blade and in the shaded half or the lit one (the lit half on side), unless
// slit({along, u}, k, w) leaves it out, k px out from the midrib of a blade w across there.
const splitBlade = (ctx, sp, chain, total, grown, side, dark, lit, slit) => {
  const n = chain.length;
  const [ax, ay, dx, dy, lens, starts] = [0, 0, 0, 0, 0, 0].map(() => new Float64Array(n));
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  let first = n; // the first stem the blade reaches
  for (let i = 0, start = 0; i < n; i++) {
    const st = chain[i];
    const len = st.len || 1e-6;
    ax[i] = st.root.x;
    ay[i] = st.root.y;
    dx[i] = (st.tip.x - st.root.x) / len;
    dy[i] = (st.tip.y - st.root.y) / len;
    lens[i] = len;
    starts[i] = start;
    start += st.len;
    if (start / total < sp.petiole) continue; // only the blade needs looking at
    first = Math.min(first, i);
    x0 = Math.min(x0, st.root.x, st.tip.x);
    x1 = Math.max(x1, st.root.x, st.tip.x);
    y0 = Math.min(y0, st.root.y, st.tip.y);
    y1 = Math.max(y1, st.root.y, st.tip.y);
  }
  if (x0 > x1) return;
  const pad = sp.leafWidth + 1;
  [x0, x1, y0, y1] = [Math.floor(x0 - pad), Math.ceil(x1 + pad), Math.floor(y0 - pad), Math.ceil(y1 + pad)];
  const cols = x1 - x0 + 1;
  const half = new Uint8Array(cols * (y1 - y0 + 1)); // 0 not in the blade, 1 the shaded half, 2 the lit half
  const at = { along: 0, u: 0 };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let best = Infinity;
      let along = 0;
      let k = 0;
      for (let i = first; i < n; i++) {
        const t = Math.min(lens[i], Math.max(0, (px - ax[i]) * dx[i] + (py - ay[i]) * dy[i]));
        const qx = ax[i] + dx[i] * t;
        const qy = ay[i] + dy[i] * t;
        const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
        if (d2 >= best) continue;
        best = d2;
        along = starts[i] + t;
        k = (py - qy) * dx[i] - (px - qx) * dy[i]; // + on the side the normal points
      }
      at.along = along;
      at.u = along / total;
      if (at.u < sp.petiole) continue;
      const w = clumpWidth(sp, at.u, grown);
      if (w > 0 && Math.abs(k) <= w && !slit(at, Math.abs(k), w)) {
        half[(y - y0) * cols + x - x0] = k * side >= 0 ? 2 : 1;
      }
    }
  }
  for (const [which, color] of [
    [1, dark],
    [2, lit],
  ]) {
    ctx.fillStyle = color;
    const runs = pixelRuns(ctx);
    for (let i = 0; i < half.length; i++) if (half[i] === which) runs.put(x0 + (i % cols), y0 + Math.floor(i / cols));
    runs.flush();
  }
};

// Markings on a clump plant's blade: dark feathered bars either side of the midrib (feather), silver patches
// (silver), pale veins running out to the edge (veins), or pale dots (spots).
const bladePattern = (ctx, sp, pts, widths, root, hex) => {
  if (!sp.pattern) return;
  ctx.fillStyle =
    sp.pattern === 'feather'
      ? hex(-12)
      : sp.pattern === 'silver'
        ? hslHex(sp.leaf.h, 10, 72)
        : hslHex(sp.stem.h, 20, sp.pattern === 'spots' ? 80 : 66);
  pts.forEach((p, i) => {
    const w = widths[i];
    if (w <= 0) return;
    const at = (k, size) => plot(ctx, p.x + p.n.x * k, p.y + p.n.y * k, Math.max(1, size));
    if (sp.pattern === 'feather') {
      if (w > 1.2 && Math.floor(p.along / 2.2) % 2 === 0) for (const k of [-0.45, 0.45]) at(k * w, w * 0.5);
    } else if (sp.pattern === 'silver') {
      if (hash(root.seed, Math.floor(p.along / 2), 8) < 0.55) at((hash(root.seed, i, 9) - 0.5) * w * 0.9, w * 0.8);
    } else if (sp.pattern === 'spots') {
      if (hash(root.seed + i, 0, 9) < 0.15) at((hash(root.seed, i, 10) - 0.5) * w * 1.4, 1);
    } else if (i % 4 === 0 && w > 1.5) {
      const d = { x: p.n.y, y: -p.n.x }; // toward the tip
      for (const k of [-1, 1]) line(ctx, p, add(add(p, p.n, k * w * 0.9), d, w * 0.5), 1); // veins
    }
  });
};

// A pinnate frond: its stalk and midrib, with leaflets in pairs every few px past the stalk, longest a third of
// the way along and leaning toward the tip (and, for a palm, drooping): oval ones (a ZZ plant) or fine ones.
const drawFrond = (ctx, sp, pts, grown, hex) => {
  const f = sp.leaflet;
  ctx.fillStyle = hslHex(sp.stem.h, sp.stem.s, sp.stem.l);
  const runs = pixelRuns(ctx);
  for (const p of pts) runs.put(Math.ceil(p.x - 0.5), Math.ceil(p.y - 0.5));
  runs.flush();
  const anchors = [];
  for (const p of pts) {
    if (p.u < sp.petiole || (anchors.length && p.along < anchors[anchors.length - 1].along + f.spacing)) continue;
    anchors.push(p);
  }
  for (const side of [-1, 1]) {
    ctx.fillStyle = hex(side * 3);
    for (const p of anchors) {
      const v = (p.u - sp.petiole) / (1 - sp.petiole);
      const len = f.len * grown * Math.sin(Math.PI * Math.min(1, 0.12 + v * 0.88)) ** 0.6;
      const d = { x: p.n.y, y: -p.n.x };
      const dir = normalize({
        x: d.x * Math.cos(f.angle) + p.n.x * side * Math.sin(f.angle),
        y: d.y * Math.cos(f.angle) + p.n.y * side * Math.sin(f.angle) + (f.droop ?? 0),
      });
      if (f.width > 1.2) {
        for (let k = 0; k <= len; k += 0.5) {
          plot(ctx, p.x + dir.x * k, p.y + dir.y * k, Math.max(1, f.width * Math.sin((Math.PI * k) / len)));
        }
      } else {
        for (let k = 0; k <= len; k += 0.7) runs.put(Math.round(p.x + dir.x * k), Math.round(p.y + dir.y * k));
      }
    }
    runs.flush();
  }
};

// A spathe at the top of its stalk (c, the stalk heading along d): a hood standing up behind a spike (a peace
// lily), or a glossy heart held out to one side with the spike standing up out of it (an anthurium).
const drawSpathe = (ctx, f, c, d, bloom, side) => {
  const s = f.size * (0.4 + 0.6 * bloom);
  const dir = rotate(d, side * (f.hood ? 0.25 : 1.3));
  const len = (f.hood ? 7 : 6) * s;
  const wide = (f.hood ? 2.2 : 3) * s;
  ctx.fillStyle = hslHex(f.spathe.h, f.spathe.s, f.spathe.l);
  for (let k = 0; k <= len; k += 0.5) {
    const t = k / len;
    const hood = Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.9)) ** 0.7;
    const heart = Math.min(1, 0.7 + t * 2.5, (1 - t) * 1.6);
    const w = wide * (f.hood ? hood : heart);
    plot(ctx, c.x + dir.x * k, c.y + dir.y * k, Math.max(1, w));
  }
  if (bloom < 0.3) return;
  const up = rotate(d, -side * (f.hood ? 0.15 : 0.2));
  ctx.fillStyle = hslHex(f.spadix.h, f.spadix.s, f.spadix.l);
  for (let k = 0; k <= 3.5 * s; k += 0.5) plot(ctx, c.x + up.x * k, c.y + up.y * k, 1.3);
};

// Orchid flowers hanging along the end of an arching spike, opening one after another from the bottom: five
// rounded petals and a darker lip.
const drawOrchid = (ctx, f, pts, bloom) => {
  const n = f.count;
  for (let k = 0; k < n; k++) {
    const open = clamp(bloom * 1.8 - (k * 0.8) / n, 0, 1);
    if (open <= 0) continue;
    const at = pts[Math.round((pts.length - 1) * (0.55 + (0.45 * k) / Math.max(1, n - 1)))];
    const c = { x: at.x, y: at.y + 2 };
    const r = (0.8 + 1.6 * open) * f.size;
    ctx.fillStyle = hslHex(f.petal.h, f.petal.s, f.petal.l);
    for (let a = 0; a < 5; a++) {
      const ang = (a * Math.PI * 2) / 5 - Math.PI / 2;
      plot(ctx, c.x + Math.cos(ang) * r * 0.6, c.y + Math.sin(ang) * r * 0.6, Math.max(1, r * 0.8));
    }
    if (open > 0.5) {
      ctx.fillStyle = hslHex(f.lip.h, f.lip.s, f.lip.l);
      plot(ctx, c.x, c.y + r * 0.2, Math.max(1, r * 0.5));
    }
  }
};

// Little tubular flowers hanging along the top of a stalk, coming out from the bottom up, lighter at the mouth.
const drawBells = (ctx, f, pts, bloom) => {
  const from = Math.floor(pts.length * 0.6);
  const upTo = from + Math.round((pts.length - from) * Math.min(1, bloom * 1.2));
  const tube = hslHex(f.color.h, f.color.s, f.color.l);
  const mouth = hslHex(f.color.h + 25, f.color.s, f.color.l + 15);
  for (let i = from; i < upTo; i += 2) {
    const [x, y] = [Math.round(pts[i].x), Math.round(pts[i].y)];
    ctx.fillStyle = tube;
    ctx.fillRect(x, y + 1, 1, Math.max(1, Math.round(2 * f.size)));
    ctx.fillStyle = mouth;
    ctx.fillRect(x, y + 1 + Math.max(1, Math.round(2 * f.size)), 1, 1);
  }
};

// A bromeliad's cone of bright bracts on its short stalk: chevrons stacked up it, narrowing to the top.
const drawBract = (ctx, f, c, d, bloom) => {
  const n = Math.max(1, Math.round(5 * f.size * (0.3 + 0.7 * bloom)));
  const across = { x: -d.y, y: d.x };
  for (let k = 0; k < n; k++) {
    ctx.fillStyle = hslHex(f.color.h, f.color.s, f.color.l + (k % 2 ? 6 : -4));
    const at = add(c, d, k * 1.6 - 1);
    const half = (n - k) * 0.9 * f.size;
    for (const side of [-1, 1]) line(ctx, at, add(add(at, across, side * half), d, -half * 0.6), 1.2);
  }
};

// A bird of paradise flower at the top of its stalk (c, the stalk heading up along d): a beak-like sheath lying
// across the stalk, then as it opens a crest of orange petals standing up and back out of it, and a blue tongue.
const drawBird = (ctx, f, c, d, bloom, side) => {
  const s = f.size;
  const beak = normalize({ x: -d.y * side + d.x * 0.3, y: d.x * side + d.y * 0.3 });
  const len = (5 + 4 * bloom) * s;
  ctx.fillStyle = hslHex(f.beak.h, f.beak.s, f.beak.l);
  for (let k = 0; k <= len; k += 0.5) plot(ctx, c.x + beak.x * k, c.y + beak.y * k, (1.8 - 1.4 * (k / len)) * s);
  ctx.fillStyle = hslHex(f.blush.h, f.blush.s, f.blush.l); // flushed along its underside
  for (let k = 1; k <= len * 0.8; k += 0.5) plot(ctx, c.x + beak.x * k - d.x * 0.8, c.y + beak.y * k - d.y * 0.8, 1);
  if (bloom < 0.2) return;
  const open = Math.min(1, (bloom - 0.2) / 0.5);
  const q = add(c, beak, len * 0.35);
  const back = normalize({ x: d.x - beak.x * 0.6, y: d.y - beak.y * 0.6 });
  for (const [a, reach] of [
    [-0.45, 1],
    [-0.1, 1.15],
    [0.25, 0.9],
  ]) {
    const dir = rotate(back, a * side);
    const L = 5.5 * s * reach * open;
    for (let k = 0; k <= L; k += 0.5) {
      ctx.fillStyle = hslHex(f.crest.h, f.crest.s, f.crest.l + 8 * (k / L));
      plot(ctx, q.x + dir.x * k, q.y + dir.y * k, Math.max(1, 1.6 * s * (1 - k / L)));
    }
  }
  if (bloom < 0.5) return;
  const tongue = normalize({ x: d.x + beak.x * 0.9, y: d.y + beak.y * 0.9 });
  ctx.fillStyle = hslHex(f.tongue.h, f.tongue.s, f.tongue.l);
  const reach = 4 * s * Math.min(1, (bloom - 0.5) * 2);
  for (let k = 0; k <= reach; k += 0.5) plot(ctx, q.x + tongue.x * k, q.y + tongue.y * k, 1);
};

// A feathery plume up the top of a grass stalk, fluffing out as it opens.
const drawPlume = (ctx, f, pts, bloom, seed) => {
  const len = Math.min(pts.length - 1, Math.round((6 + 6 * bloom) * f.size));
  const { h, s, l } = f.color;
  for (let i = 0; i <= len; i++) {
    const p = pts[pts.length - 1 - i];
    const v = 1 - i / len; // 0 at the bottom of the plume, 1 at its tip
    const w = (0.5 + 1.6 * bloom) * f.size * Math.sin(Math.PI * Math.min(1, 0.15 + v * 0.85)) ** 0.8;
    for (let k = -Math.round(w); k <= Math.round(w); k++) {
      if (hash(seed + i, k, 3) > 0.75) continue;
      ctx.fillStyle = hslHex(h, s, l + (hash(seed + i, k, 4) - 0.5) * 12);
      ctx.fillRect(Math.round(p.x + p.n.x * k), Math.round(p.y + p.n.y * k), 1, 1);
    }
  }
};

// A baby spider plant at the end of a runner: a little rosette of arching leaves, and roots once it's grown.
const drawPlantlet = (ctx, sp, c, bloom) => {
  const s = sp.flower.size * (0.4 + 0.6 * bloom);
  if (bloom > 0.6) {
    ctx.fillStyle = hslHex(sp.stem.h, sp.stem.s - 10, sp.stem.l + 10);
    plot(ctx, c.x, c.y + 1.5, 1);
    plot(ctx, c.x + 1, c.y + 2.5, 1);
  }
  ctx.fillStyle = hslHex(sp.leaf.h, sp.leaf.s, sp.leaf.l + 4);
  for (const a of [-1.2, -0.6, 0, 0.6, 1.2]) {
    const L = (2.5 + 2 * Math.cos(a)) * s * 1.2;
    for (let k = 0; k <= L; k += 0.5) {
      plot(ctx, c.x + Math.sin(a) * k, c.y - Math.cos(a) * k + (k / L) ** 2 * Math.abs(a) * 1.5, 1); // drooping
    }
  }
};

// A clump plant: its leaves from the oldest (at the back) to the newest, then its flower stalks and runners.
const drawClump = (ctx, plant) => {
  const sp = plant.species;
  const chains = chainsOf(plant);
  const leaves = chains.filter((c) => c[0].role === 'leaf');
  leaves.forEach((chain, i) => drawClumpLeaf(ctx, sp, chain, leaves.length > 1 ? 1 - i / (leaves.length - 1) : 0));
  for (const chain of chains) {
    const root = chain[0];
    if (root.role === 'leaf') continue;
    const { pts } = chainPoints(chain);
    ctx.fillStyle = hslHex(sp.stem.h, sp.stem.s, sp.stem.l);
    if (sp.flower.kind === 'bird') for (const p of pts) plot(ctx, p.x, p.y, 1.6);
    else {
      const runs = pixelRuns(ctx);
      for (const p of pts) runs.put(Math.ceil(p.x - 0.5), Math.ceil(p.y - 0.5));
      runs.flush();
    }
    const end = chain[chain.length - 1];
    for (const st of chain) {
      if (!st.bud || st.flower <= 0) continue;
      // Wilting, it browns and closes up again.
      const fx = st.wilt > 0 ? withering(ctx, st.wilt * 0.8) : ctx;
      const bloom = st.flower * (1 - 0.7 * (st.wilt ?? 0));
      const f = sp.flower;
      if (st.sideBloom) {
        // A little white flower along a runner.
        if (bloom < 0.3) continue;
        const { h, s, l } = f.color;
        fx.fillStyle = hslHex(h, s, l);
        const [x, y] = [Math.round(st.tip.x), Math.round(st.tip.y)];
        for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0]]) fx.fillRect(x + dx, y + dy, 1, 1);
        if (bloom > 0.6) {
          fx.fillStyle = COIN;
          fx.fillRect(x, y, 1, 1);
        }
      } else if (st === end) {
        const d = normalize({ x: end.tip.x - end.root.x, y: end.tip.y - end.root.y });
        if (f.kind === 'bird') drawBird(fx, f, end.tip, d, bloom, root.side);
        else if (f.kind === 'plume') drawPlume(fx, f, pts, bloom, root.seed);
        else if (f.kind === 'spathe') drawSpathe(fx, f, end.tip, d, bloom, root.side);
        else if (f.kind === 'orchid') drawOrchid(fx, f, pts, bloom);
        else if (f.kind === 'bells') drawBells(fx, f, pts, bloom);
        else if (f.kind === 'bract') drawBract(fx, f, end.tip, d, bloom);
        else drawPlantlet(ctx, sp, end.tip, bloom);
      }
    }
  }
};

// Fallen leaves and petals: rocking as they flutter down or sink, flat on the water or the ground, shrinking as fish
// bite them and curling up at the end. A petal is a speck or two, already wilting.
const LITTER_TILT = { fall: 0.9, sink: 0.4 };
const drawLitter = (ctx, world) => {
  for (const it of world.litter) {
    const { shape, color, grown, scale, flip = 1 } = it.look;
    const k = it.size * Math.min(1, (1 - it.rot) / 0.3);
    const tilt = Math.sin(it.phase) * (LITTER_TILT[it.state] ?? 0);
    const axis = { x: Math.cos(tilt) * flip, y: Math.sin(tilt) };
    if (it.look.petal) {
      ctx.fillStyle = wither(hslHex(color.h, color.s, color.l), 0.4 + 0.6 * it.rot);
      plot(ctx, it.x, it.y, 1);
      if (k > 0.5) plot(ctx, it.x + axis.x, it.y + axis.y, 1);
      continue;
    }
    const form = LEAF_FORMS[shape];
    const len = (1.5 + 4 * grown) * scale * form.len * k;
    const [h, s, l] = agedLeaf(color, 1, it.rot);
    leafShape(ctx, add(it, axis, -len / 2), axis, len, form, grown * scale * k, hslHex(h, s, l), hslHex(h, s, l - 9));
  }
};

// Grass: tufts of blades fanning up from the ground, lighter toward the tips and leaning in the breeze, some
// with seed heads or little blossoms once grown. A tank of it is tens of thousands of single dots, too many to
// fill one at a time, so they're written into an image and drawn in one go, afresh every frame so it still sways.
let grassLayer = null;
const drawGrass = (ctx, world, patches) => {
  if (!patches.length) return;
  const time = world.time;
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
      // In the air it leans with the breeze, fluttering a little; under water it sways further and slower, rocked by
      // the current.
      const sway = tuft.wet
        ? Math.sin(time * 0.02 + tuft.x * 0.1) * 0.35
        : wind(world, tuft.x) * 0.35 + Math.sin(time * 0.05 + tuft.x * 0.3) * 0.03;
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
  const sp = look.plant?.species;
  const { h, s, l } = look.kind === 'vine' ? look.vine.genome.stem : look.leaf ? sp.leaf : sp.stem;
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
  if (obj.kind === 'plant') drawPlant(ctx, obj);
  else if (obj.kind === 'grass') drawGrass(ctx, world, [obj]);
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
        case 'tiger': {
          // Dark stripes, unevenly spaced and of uneven width.
          const k = u / t.patternScale;
          return Math.sin(k * 2.2 + Math.sin(k * 0.9 + seed) * 1.5) > 0.45 ? patternHex(t, along, dark + 12) : base;
        }
        case 'piebald': {
          // Big patches of the pattern colour by turns, with ragged edges, legs and all.
          const at = part === 'body' ? u : f * 40;
          const patch = Math.floor((at + Math.sin(at * 0.4 + seed) * t.patternScale) / (t.patternScale * 2.5));
          return (patch + Math.floor(seed)) % 2 ? mark() : base;
        }
        case 'rainbow':
          // The hue goes right round the wheel from head to tail.
          return hslHex(t.hue + along * 300, Math.max(t.sat, 55), clamp(t.light, 40, 70) - dark);
        case 'starry':
          // A night sky: dark all over, scattered with little stars.
          return hash(seed, Math.floor(u), salt + 11) < 0.12
            ? hslHex(t.hue + t.patternHue, 35, 88 - dark)
            : bodyHex(t, along, dark + 28);
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
      // Loose: dangling, or paddling while held or swimming.
      let ahead = 0;
      let raise = 0;
      if (bug.state === 'held' || bug.state === 'swim') {
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
// grain keeps its own shade as it moves. Wood and sandstone (and brownstone, a darker sandstone) never move, so their
// shade comes from where they are instead: wavy grain lines in wood, soft layers in sandstone.
const shades = (h, s, l, [a, b] = [-2, 2]) => [l, l + a, l + b].map((v) => hslHex(h, s, v));
export const MATERIAL_COLORS = {
  [STONE]: shades(240, 3, 44),
  [BASALT]: shades(225, 8, 24, [-3, 3]),
  [DIRT]: shades(28, 40, 25),
  [SAND]: shades(44, 52, 70),
  [WATER]: shades(212, 60, 47),
  [FOUNTAIN]: shades(186, 38, 56),
  // Plain, grain line, light streak, dim streak: all within a few percent, so the grain is felt more than seen.
  [WOOD]: [0, -3, 1, -1].map((d) => hslHex(28, 26, 36 + d)),
  [SANDSTONE]: shades(33, 48, 56, [-4, 3]),
  [BROWNSTONE]: shades(18, 40, 34, [-4, 3]),
  [SNOW]: shades(205, 30, 91, [-3, 3]),
  [ICE]: shades(195, 50, 68, [-4, 12]), // plain, shadowed, glinting
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
// Ice: glinting streaks slanting across it, here and there, and a shadowy cell now and then.
const iceShade = (r, c, tint) => {
  if ((r + c * 2) % 9 === 0 && hash(Math.floor(c / 4), Math.floor(r / 3)) < 0.6) return 2;
  return tint === 1 ? 1 : 0;
};
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
  if (m === SANDSTONE || m === BROWNSTONE) return MATERIAL_COLORS[m][sandstoneShade(r, c)];
  if (m === ICE) return MATERIAL_COLORS[ICE][iceShade(r, c, ter.tint[i])];
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

// A patch of material m as the tank shows it, filling canvas: its grains, wood's grain, sandstone's layers, ice's
// glints, water's bright top over the dark. For the editor's palette.
export const drawSwatch = (canvas, m) => {
  const ter = makeTerrain(40, 10);
  ter.cells.fill(m);
  ter.tint.forEach((_, i) => (ter.tint[i] = Math.floor(hash(i, m, 7) * 3)));
  Object.assign(canvas, { width: ter.cols * CELL, height: ter.rows * CELL });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = m === WATER ? WATER_ALPHA : 1;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(terrainLayer(ter, m === WATER), 0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
};

const drawTerrain = (ctx, world, water) => {
  const ter = world.terrain;
  ctx.globalAlpha = water ? WATER_ALPHA : 1;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(terrainLayer(ter, water), 0, ter.top, ter.cols * CELL, ter.rows * CELL);
  ctx.globalAlpha = 1;
};

// The water cells open to the air on top, as world px [x, y, x, y, ...], found again whenever the water moves.
const surfaceOf = (ter) => {
  const cache = layersOf(ter);
  if (cache.surfaceVersion !== ter.version) {
    const s = [];
    for (let i = 0; i < ter.cells.length; i++) {
      if (ter.cells[i] !== WATER || (i >= ter.cols && ter.cells[i - ter.cols] !== EMPTY)) continue;
      s.push((i % ter.cols) * CELL, ter.top + Math.floor(i / ter.cols) * CELL);
    }
    Object.assign(cache, { surface: s, surfaceVersion: ter.version });
  }
  return cache.surface;
};

const GLINT = '#e6f3ff';
const BUBBLE = '#cfe6ff';

// Light on the water: glints sliding along the surface, rings spreading where something lands on it or a bubble
// pops, and bubbles rising.
const drawWater = (ctx, world) => {
  const t = world.time;
  const s = surfaceOf(world.terrain);
  ctx.fillStyle = GLINT;
  ctx.globalAlpha = 0.7;
  for (let i = 0; i < s.length; i += 2) {
    for (let x = s[i]; x < s[i] + CELL; x++) {
      if (Math.sin(x * 0.37 - t * 0.05) + Math.sin(x * 0.13 + t * 0.021) > 1.55) ctx.fillRect(x, s[i + 1], 1, 1);
    }
  }
  for (const r of world.ripples) {
    ctx.globalAlpha = 0.8 * (1 - r.age / RIPPLE_TICKS);
    const d = Math.round(1 + r.age * 0.3);
    ctx.fillRect(Math.round(r.x) - d, r.y, 1, 1);
    ctx.fillRect(Math.round(r.x) + d, r.y, 1, 1);
  }
  ctx.fillStyle = BUBBLE;
  ctx.globalAlpha = 0.7;
  for (const b of world.bubbles) {
    const [x, y] = [Math.round(b.x), Math.round(b.y)];
    if (!b.big) ctx.fillRect(x, y, 1, 1);
    else for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillRect(x + dx, y + dy, 1, 1);
  }
  ctx.globalAlpha = 1;
};

const MOTE = '#fff3d6';
const SNOWFLAKE = '#eef4ff';
const FIREFLY = '#e2ff7a';

// What's in the air: dust catching the light, brighter higher up, and fireflies, glowing faintly between flashes.
const drawAir = (ctx, world) => {
  const t = world.time;
  const snow = snowing(world);
  ctx.fillStyle = snow ? SNOWFLAKE : MOTE;
  for (const m of world.motes) {
    const dust = (0.08 + 0.3 * (1 - m.y / world.ground.y0)) * (0.6 + 0.4 * Math.sin(t * 0.04 + m.seed));
    ctx.globalAlpha = snow ? 0.75 : dust;
    ctx.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
  }
  ctx.fillStyle = FIREFLY;
  for (const f of world.fireflies) {
    const fade = Math.min(1, f.age / 120, (f.life - f.age) / 120);
    const flash = params.fireflyFlash;
    const lit = f.clock < flash ? Math.sin((Math.PI * f.clock) / flash) : 0;
    const [x, y] = [Math.round(f.x), Math.round(f.y)];
    if (lit > 0) {
      // A soft round glow: two crossed bars, brightest where they overlap, then a brighter cross.
      ctx.globalAlpha = 0.25 * lit * fade;
      ctx.fillRect(x - 2, y - 1, 5, 3);
      ctx.fillRect(x - 1, y - 2, 3, 5);
      ctx.globalAlpha = 0.6 * lit * fade;
      ctx.fillRect(x - 1, y, 3, 1);
      ctx.fillRect(x, y - 1, 1, 3);
    }
    ctx.globalAlpha = (0.25 + 0.75 * lit) * fade;
    ctx.fillRect(x, y, 1, 1);
  }
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

// A wallpaper's inks: its base, its accent, a brighter accent, stars, a shade darker than the base, and a glow (a
// moon or sun, lit windows, a planet).
const wallpaperInks = (wp) => {
  const { base: b, accent: a } = wp;
  const g = wp.glow ?? { h: a.h, s: 60, l: 50 };
  return [
    hslHex(b.h, b.s, b.l),
    hslHex(a.h, a.s, a.l),
    hslHex(a.h, a.s, a.l + 5),
    hslHex(a.h, 25, 60),
    hslHex(b.h, b.s, b.l - 4),
    hslHex(g.h, g.s, g.l),
  ].map(rgb);
};
const [BASE, ACCENT, BRIGHT, STAR, DARK, GLOW] = [0, 1, 2, 3, 4, 5];

// A dusk sky: dark overhead, brightening toward the horizon in dithered steps (up to ink top), with a few stars
// up high.
const skyInk = (wp, x, y, floor, top = BRIGHT, stars = 0.004) => {
  const f = y / floor;
  if (f < 0.6 && hash(wp.seed, x, y) < stars) return STAR;
  return Math.min(top, Math.floor(f * f * (top + 0.5) + BAYER[(y % 4) * 4 + (x % 4)] / 16));
};

// Where the top of a rolling range of hills is at x (its y), range k of the seed's ranges.
const hillTop = (wp, k, x, floor, [height, roll, f1, f2]) => {
  const u = x / floor;
  const phase = (j) => hash(wp.seed, k, j) * Math.PI * 2;
  const wave = 0.6 * Math.sin(u * f1 + phase(1)) + 0.4 * Math.sin(u * f2 + phase(2));
  return floor * (1 - height - roll * wave);
};

// Is (x, y) in one of a row of pines standing on ground (y), spaced about sp apart and heights lo..hi tall? Each
// is a stack of tiers, narrowing to the top, on a stub of trunk.
const inPines = (wp, row, x, y, ground, sp, lo, hi) => {
  const j0 = Math.floor(x / sp);
  for (let j = j0 - 1; j <= j0 + 1; j++) {
    const cx = (j + 0.5 + (hash(wp.seed, row, j) - 0.5) * 0.6) * sp;
    const h = lo + (hi - lo) * hash(wp.seed, row, j + 99);
    const top = ground(cx) - h;
    if (y < top || y > ground(cx)) continue;
    const down = y - top;
    if (down > h * 0.9) {
      if (Math.abs(x - cx) < 1) return true;
      continue;
    }
    const tier = (down % (h / 4)) / (h / 4); // each tier flares out toward its bottom
    if (Math.abs(x - cx) <= 0.5 + down * 0.22 + tier * h * 0.06) return true;
  }
  return false;
};

// Is (x, y) in a building of a skyline standing on floor, in px from the left: widths 6..18, heights lo..hi.
// Returns the building's left edge and width, or null.
const buildingAt = (wp, row, x, y, floor, lo, hi) => {
  for (let left = -Math.floor(hash(wp.seed, row, 0) * 10), i = 1; left < x + 1; i++) {
    const w = 6 + Math.floor(hash(wp.seed, row, i) * 13);
    const h = lo + (hi - lo) * hash(wp.seed, row, i + 500);
    if (x >= left && x < left + w) return y >= floor - h ? { left, w, top: Math.floor(floor - h) } : null;
    left += w + (hash(wp.seed, row, i + 900) < 0.3 ? 2 : 0);
  }
  return null;
};

// Which ink goes at (x, y). floor is the dirt line, for the styles with a sky.
const wallpaperInk = (wp, x, y, floor) => {
  const n = wp.size;
  switch (wp.style) {
    case 'diagonal':
      return (x + y) % (n * 2) < n ? ACCENT : BASE;
    case 'scales': {
      // Rows of overlapping arcs, each row half a scale over from the one above.
      const rowH = n / 2;
      for (const r of [Math.floor(y / rowH), Math.floor(y / rowH) - 1]) {
        const off = (r % 2) * (n / 2);
        const cx = Math.round((x - off) / n) * n + off;
        const d = Math.hypot(x - cx, y - r * rowH);
        if (y >= r * rowH && Math.abs(d - n / 2) < 0.6) return ACCENT;
      }
      return BASE;
    }
    case 'plaid': {
      const [bx, by] = [x % (n * 3) < n, y % (n * 3) < n];
      if (x % (n * 3) === n * 2 || y % (n * 3) === n * 2) return BRIGHT; // a thin bright line through each square
      return bx && by ? BRIGHT : bx || by ? ACCENT : BASE;
    }
    case 'argyle': {
      // A checkerboard of diamonds, with dashed lines running through them.
      const u = x / n + y / (n * 1.5);
      const v = x / n - y / (n * 1.5);
      const edge = (t) => t - Math.floor(t) < 0.12;
      if ((edge(u) || edge(v)) && Math.floor((x + y) / 2) % 2) return BRIGHT;
      return (Math.floor(u) + Math.floor(v)) % 2 ? ACCENT : DARK;
    }
    case 'herringbone': {
      // Columns of short slanting lines, slanting the other way in each next column.
      const dir = Math.floor(x / n) % 2 ? 1 : -1;
      return (((y + dir * x) % n) + n) % n < 2 ? ACCENT : BASE;
    }
    case 'winter': {
      // Snow falling on snowy hills under a night sky, a few dark pines along the far one.
      if (hash(wp.seed, x, y) < 0.008) return STAR;
      const near = hillTop(wp, 1, x, floor, RANGES[1]);
      if (y >= near) return BRIGHT;
      const far = (cx) => hillTop(wp, 0, cx, floor, RANGES[0]);
      if (inPines(wp, 0, x, y, far, 13, floor * 0.05, floor * 0.1)) return DARK;
      if (y >= far(x)) return ACCENT;
      return skyInk(wp, x, y, floor, BASE, 0);
    }
    case 'forest': {
      // A moon over two rows of pines, the nearer row darker.
      const [mx, my, mr] = [floor * 0.55, floor * 0.22, floor * 0.04];
      if (inPines(wp, 1, x, y, () => floor, 15, floor * 0.14, floor * 0.3)) return DARK;
      if (inPines(wp, 0, x, y, () => floor * 0.94, 9, floor * 0.28, floor * 0.5)) return BASE;
      if (Math.hypot(x - mx, y - my) < mr) return GLOW;
      return skyInk(wp, x, y, floor, BRIGHT, 0.002);
    }
    case 'mountains': {
      // Jagged snow-capped peaks, a lower dark range in front.
      // Peaks and saddles by turns, straight-sided between, with a little roughness.
      const ridge = (k, seg, lo, hi) => {
        const i = Math.floor(x / seg);
        const at = (j) => floor * (1 - lo - (hi - lo) * (j % 2 ? 0.1 : 0.55 + 0.45 * hash(wp.seed, k, j)));
        const t = x / seg - i;
        return at(i) + (at(i + 1) - at(i)) * t + (hash(wp.seed, k, x) - 0.5) * 2;
      };
      const front = ridge(2, floor * 0.12, 0.12, 0.22);
      if (y >= front) return DARK;
      const back = ridge(1, floor * 0.16, 0.2, 0.62);
      if (y >= back) return y < back + floor * 0.06 && back < floor * 0.58 ? BRIGHT : BASE;
      return skyInk(wp, x, y, floor, ACCENT);
    }
    case 'desert': {
      // Dunes in three ridges under a big low moon, each ridge lit along its crest.
      for (const [k, h, roll, ink] of [
        [2, 0.1, 0.04, DARK],
        [1, 0.2, 0.06, BASE],
        [0, 0.3, 0.07, ACCENT],
      ]) {
        const top = hillTop(wp, k, x, floor, [h, roll, 4 + k * 3, 9 + k * 4]);
        if (y >= top) return y < top + 1.5 && ink !== ACCENT ? BRIGHT : ink;
      }
      if (Math.hypot(x - floor * 0.5, y - floor * 0.4) < floor * 0.07) return GLOW;
      return skyInk(wp, x, y, floor, BRIGHT);
    }
    case 'ocean': {
      // Light from above fading with depth, rays slanting down, kelp swaying up from the bottom, and bubbles.
      const f = y / floor;
      for (let j = Math.floor(x / 12) - 1; j <= Math.floor(x / 12) + 1; j++) {
        const h = floor * (0.25 + 0.45 * hash(wp.seed, 5, j));
        const cx = (j + 0.5) * 12 + Math.sin(y * 0.07 + j) * 3;
        if (y > floor - h && Math.abs(x - cx) < 1.3 * (0.4 + (y - floor + h) / h)) return DARK;
      }
      const cell = [Math.floor(x / 9), Math.floor(y / 9)];
      if (hash(wp.seed, ...cell) < 0.06) {
        const r = 1 + Math.floor(hash(wp.seed, cell[0], cell[1] + 7) * 2);
        if (Math.abs(Math.hypot(x - cell[0] * 9 - 4, y - cell[1] * 9 - 4) - r) < 0.5) return STAR;
      }
      const depth = [BRIGHT, ACCENT, BASE, DARK][Math.min(3, Math.floor(f * 3.2 + BAYER[(y % 4) * 4 + (x % 4)] / 16))];
      const ray = f < 0.65 && ((x + y * 0.4) % 23) < 3 + 3 * hash(wp.seed, Math.floor((x + y * 0.4) / 23), 6);
      return ray ? [BRIGHT, BRIGHT, ACCENT, BASE, BASE, ACCENT][depth] : depth;
    }
    case 'aurora': {
      // Curtains of light hanging in the night sky over a dark horizon.
      if (y >= hillTop(wp, 0, x, floor, [0.08, 0.03, 6, 15])) return DARK;
      for (const k of [0, 1]) {
        const phase = hash(wp.seed, 8, k) * 6.28;
        const sway = Math.sin(x * 0.05 + phase) * 0.04 + Math.sin(x * 0.013 + phase) * 0.07;
        const top = floor * (0.18 + 0.12 * k + sway);
        const len = floor * (0.1 + 0.08 * (0.5 + 0.5 * Math.sin(x * 0.031 + phase * 2)));
        const d = (y - top) / len;
        if (d >= 0 && d < 1 && hash(wp.seed, x, 3) > d * 0.8) return d < 0.35 ? BRIGHT : ACCENT;
      }
      if (hash(wp.seed, x, y) < 0.005) return STAR;
      return y / floor + BAYER[(y % 4) * 4 + (x % 4)] / 32 < 0.5 ? DARK : BASE;
    }
    case 'city': {
      // A skyline of lit windows at dusk, the nearer buildings darker.
      const near = buildingAt(wp, 1, x, y, floor, floor * 0.08, floor * 0.28);
      const b = near ?? buildingAt(wp, 0, x, y, floor, floor * 0.2, floor * 0.5);
      if (b) {
        const [wx, wy] = [x - b.left, y - b.top];
        const window = wx > 1 && wx < b.w - 1 && wx % 3 === 1 && wy > 2 && wy % 4 === 2;
        if (window && hash(wp.seed, x, y + (near ? 1 : 0)) < (near ? 0.4 : 0.25)) return near ? GLOW : ACCENT;
        return near ? DARK : BASE;
      }
      return skyInk(wp, x, y, floor, BRIGHT, 0.002);
    }
    case 'space': {
      // Stars and a nebula, and a ringed planet.
      const [px, py, pr] = [floor * 0.25, floor * 0.3, floor * 0.1];
      const [dx, dy] = [x - px, y - py];
      const ring = Math.abs((dx / (pr * 2)) ** 2 + (dy / (pr * 0.45)) ** 2 - 1) < 0.07;
      const inPlanet = Math.hypot(dx, dy) < pr;
      if (ring && (!inPlanet || dy > 0)) return BRIGHT;
      if (inPlanet) return dx + dy < pr * 0.3 + (BAYER[(y % 4) * 4 + (x % 4)] / 16 - 0.5) * pr * 0.5 ? GLOW : BASE;
      if (hash(wp.seed, x, y) < 0.01) return STAR;
      const cloud = Math.sin(x * 0.04 + hash(wp.seed, 1, 1) * 6) * Math.sin(y * 0.05) + Math.sin((x + y) * 0.025);
      return cloud + BAYER[(y % 4) * 4 + (x % 4)] / 16 > 1.3 ? ACCENT : y / floor > 0.5 ? BASE : DARK;
    }
    case 'jungle': {
      // Big leaves in layers, the nearest darkest, each with a paler midrib, over dappled light.
      for (const [layer, cell, ink, rib] of [
        [2, 30, DARK, BASE],
        [1, 24, BASE, ACCENT],
        [0, 18, ACCENT, BRIGHT],
      ]) {
        const [ci, cj] = [Math.floor(x / cell), Math.floor(y / cell)];
        for (let i = ci - 1; i <= ci + 1; i++) {
          for (let j = cj - 1; j <= cj + 1; j++) {
            if (hash(wp.seed, layer * 1000 + i, j) < 0.35) continue;
            const cx = (i + hash(wp.seed, i, j + layer)) * cell;
            const cy = (j + hash(wp.seed, j, i + layer)) * cell;
            const a = hash(wp.seed, i * 3 + layer, j) * Math.PI;
            const u = (x - cx) * Math.cos(a) + (y - cy) * Math.sin(a); // along the leaf
            const v = (y - cy) * Math.cos(a) - (x - cx) * Math.sin(a); // across it
            const [len, wide] = [cell * 0.75, cell * 0.32];
            const inLeaf = (u / len) ** 2 + (v / (wide * (1 - (u / len) ** 2 * 0.3))) ** 2 <= 1;
            if (inLeaf) return Math.abs(v) < 0.6 ? rib : ink;
          }
        }
      }
      return BAYER[(y % 4) * 4 + (x % 4)] / 16 < 0.5 + 0.3 * Math.sin(x * 0.07) * Math.sin(y * 0.05) ? BRIGHT : ACCENT;
    }
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
      for (const k of [1, 0]) if (y >= hillTop(wp, k, x, floor, RANGES[k])) return k ? DARK : BASE;
  }
  return skyInk(wp, x, y, floor); // dusk
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

// ---------- fliers ----------

const FLIER_BLACK = '#2a2a31'; // a little lighter than black, to show on a black wallpaper
const FLIER_WHITE = '#f2efe6';
const FLIER_WING = '#cfd6df';
const POLLEN_SPARK = '#ffe680';
const STINK = '#a8b88a';

// Where a ladybug's spots are on the side of its shell we see: about half of them (a two-spot shows one, a 22-spot as
// many as fit and still show the shell), in two rows along it, in shell units: u along it from -1 at the back to 1 at
// the front, v up it 0..1.
const spotsOf = (g, len) => {
  const n = Math.min(Math.ceil(g.spots / 2), Math.round(len * 0.4));
  return Array.from({ length: n }, (_, i) => ({
    u: -0.75 + (1.5 * (i + 0.5)) / n + (hash(g.seed, i, 1) - 0.5) * 0.2,
    v: (n === 1 ? 0.45 : i % 2 ? 0.62 : 0.3) + (hash(g.seed, i, 2) - 0.5) * 0.15,
  }));
};

// A flier side on: its shell over its feet at (b.x, b.y), turned to whatever it's on (b.fwd along it, b.up away from
// it), with its collar and head in front, its legs under it, stepping as it walks, and a shield bug's or soldier
// beetle's long feelers. A ladybug's shell is a spotted dome; a shield bug's a low shield, flat on top and sloping to
// the front, its edge banded (or striped right across) and now and then a pale tip to it; a soldier beetle's long and
// low, often dark at the tips. To fly its wing cases lift and its wings beat out behind, up and down; on its back,
// playing dead, it's upside down with its legs in the air. Every pixel round it is looked up in its own frame, like a
// fish's.
const drawFlier = (ctx, world, b) => {
  const g = b.genome;
  const { len, high } = flierShape(g);
  const [f, n] = [b.fwd, b.up];
  const o = n.y > 0 && b.mode !== 'tree' ? { x: b.x, y: b.y - high - 1 } : b; // on its back, its shell on the floor
  const hex = (c) => c && hslHex(c.h, c.s, c.l);
  const shell = hex(g.shell);
  const rim = hslHex(g.shell.h, g.shell.s, g.shell.l - 12);
  const shine = hslHex(g.shell.h, g.shell.s - 20, Math.min(95, g.shell.l + 28));
  const [spot, edge, tip] = [hex(g.spot), hex(g.edge), hex(g.tip)];
  const spots = spotsOf(g, len);
  const r2 = g.spots <= 4 ? 0.7 : 0.3; // a pixel, or a little more for a two- or four-spot
  // The shell's colour at (eu, ev) in shell units (eu along it, -1 at the back to 1 at the front, ev up it 0..1), or
  // null if that's off it.
  const shellAt = {
    ladybug: (eu, ev) => {
      if (eu * eu + ev * ev > 1) return null;
      for (const sp of spots) if (((eu - sp.u) * sa) ** 2 + ((ev - sp.v) * high) ** 2 < r2) return spot;
      return ev < 0.28 ? rim : shell;
    },
    shieldbug: (eu, ev) => {
      if (ev > Math.min(1, (1 - eu) * 1.6, (1 + eu) * 4)) return null;
      if (g.stripes) return Math.floor((eu + 1) * 3.5) % 2 ? edge : shell;
      if (ev < 0.3) return Math.floor((eu + 1) * 4) % 2 ? edge : rim;
      return tip && eu < -0.55 && ev > 0.5 ? tip : shell;
    },
    soldier: (eu, ev) => {
      if (eu ** 4 + ev * ev > 1) return null;
      if (tip && eu < -0.45) return tip;
      return ev < 0.3 ? rim : shell;
    },
  }[g.kind];
  const collar = g.kind === 'shieldbug' ? shell : g.kind === 'soldier' ? hex(g.collar) : null; // a ladybug's is drawn
  const headInk = g.kind === 'ladybug' ? FLIER_BLACK : g.kind === 'shieldbug' ? rim : hex(g.head);
  const [uc, sa, v0] = [-0.1 * len, 0.42 * len, 0.6]; // the shell's middle, half its length, and its underside
  const hinge = { u: uc + sa * 0.8, v: v0 + high * 0.5 }; // where the wing cases open from
  const beat = Math.floor((world.time + Math.floor(b.seed)) / 3) % 2; // the wings' beat: up, then down
  const flapping = b.wings > 0.5;
  const lift = b.wings * (flapping ? 0.8 + 0.15 * beat : 0.9); // the wing cases bob with it
  const [lc, ls] = [Math.cos(lift), Math.sin(lift)];
  const step = Math.floor(b.stride * 2) % 2 ? 0.6 : -0.6;
  const dip = b.act?.kind === 'sap' || (b.act?.kind === 'eat' && world.time % 16 < 8); // head down, feeding
  const head = { u: 0.43 * len, v: v0 + 0.35 - (dip ? 0.5 : 0) };
  const feelers = b.act?.kind === 'meet' || b.act?.kind === 'groom';
  const wave = feelers ? Math.sin(world.time * 0.5) * 0.5 : 0;
  const reach = g.kind === 'ladybug' ? (feelers ? 1.3 : 0) : 2.6; // a ladybug's feelers only show when it uses them
  const [fu, fv] = [head.u + 0.5, head.v + 0.4]; // the feelers reach forward and up from the head
  const feeler = { x0: fu, y0: fv, x1: fu + reach, y1: fv + reach * 0.7 + wave };
  const inkAt = (u, v) => {
    // The wing cases, turned up about the hinge as they open.
    const [hu, hv] = [u - hinge.u, v - hinge.v];
    const [su, sv] = [hinge.u + hu * lc - hv * ls, hinge.v + hu * ls + hv * lc];
    const [eu, ev] = [(su - uc) / sa, (sv - v0) / high];
    const ink = sv >= v0 && shellAt(eu, ev);
    if (ink) {
      if (ink !== shell) return ink;
      if (ev > 0.62 && eu > 0.05 && eu < 0.45) return shine;
      if (g.metallic && hash(g.seed + Math.round(su * 2), Math.round(sv * 2), Math.floor(world.time / 10)) < 0.08) {
        return shine;
      }
      return shell;
    }
    // The collar: a ladybug's black with white cheeks, or a harlequin's, white with a black mark.
    const [cu, cv] = [(u - 0.26 * len) / (0.13 * len + 0.3), (v - v0) / (high * 0.62)];
    if (v >= v0 && cu * cu + cv * cv <= 1) {
      if (collar) return collar;
      if (g.collar === 'white') return cu > -0.3 && cu < 0.3 && cv > 0.45 ? FLIER_BLACK : FLIER_WHITE;
      return cu > 0.2 && cv < 0.55 ? FLIER_WHITE : FLIER_BLACK;
    }
    if ((u - head.u) ** 2 + (v - head.v) ** 2 < 0.8) return headInk;
    if (reach && distToSeg(feeler, u, v) < 0.5) return FLIER_BLACK;
    if (v < v0 && v >= v0 - 1) {
      const legs = [-0.26 * len, 0, 0.22 * len];
      if (legs.some((lu, k) => Math.abs(u - lu - (k % 2 ? -step : step)) < 0.5)) return FLIER_BLACK;
    }
    // The wings, beating out behind: raised back and up, then swept back and down.
    if (flapping) {
      const a = beat ? Math.PI - 0.5 - lift * 0.4 : Math.PI + 0.35;
      const [wu, wv] = [u - hinge.u, v - hinge.v - 0.5];
      const along = wu * Math.cos(a) + wv * Math.sin(a);
      const across = -wu * Math.sin(a) + wv * Math.cos(a);
      const reach = len * 1.1;
      if (along > 0 && along < reach && Math.abs(across) < 1.2 * Math.sin((Math.PI * along) / reach) + 0.2) {
        return FLIER_WING;
      }
    }
    return null;
  };
  const R = Math.ceil(len + 2);
  const alpha = ctx.globalAlpha;
  let current = null;
  for (let py = Math.floor(o.y - R); py <= o.y + R; py++) {
    for (let px = Math.floor(o.x - R); px <= o.x + R; px++) {
      const [dx, dy] = [px + 0.5 - o.x, py + 0.5 - o.y];
      const color = inkAt(dx * f.x + dy * f.y, dx * n.x + dy * n.y);
      if (!color) continue;
      if (color !== current) {
        ctx.fillStyle = current = color;
        ctx.globalAlpha = color === FLIER_WING ? alpha * 0.5 : alpha; // the wings, see-through
      }
      ctx.fillRect(px, py, 1, 1);
    }
  }
  ctx.globalAlpha = alpha;
  // A shield bug's stink, wisping up off its back.
  if (b.act?.kind === 'stink') {
    ctx.fillStyle = STINK;
    for (let k = 0; k < 3; k++) {
      const rise = ((world.time + k * 13) % 30) / 6; // 0..5 px up, over and over
      const p = add(add(o, n, high + rise), f, (k - 1) * 1.5 + Math.sin(world.time * 0.2 + k) * 0.5);
      ctx.globalAlpha = alpha * 0.8 * (1 - rise / 5);
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    ctx.globalAlpha = alpha;
  }
  // At a flower, a fleck of pollen now and then.
  if (b.act?.kind === 'pollen' && (world.time + Math.floor(b.seed)) % 40 < 6) {
    ctx.fillStyle = POLLEN_SPARK;
    const p = add(add(o, f, len * 0.6), n, 1.5 + (Math.floor(world.time / 6) % 2));
    ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
  }
  if (world.selected === b) {
    ctx.fillStyle = COIN;
    sprite(ctx, ARROW, b.x - 2, Math.min(o.y, b.y) - high - 7 + (Math.floor(world.time / 20) % 2));
  }
};

// ---------- visitors ----------

const VISITOR_WING = '#dfe6ee';
const BEE_YELLOW = '#f2c230';
const BEE_DARK = '#3a3226';
const POLLEN_LOAD = '#f09a20';
const GNAT = '#9a9080';

// A dragonfly side on: a long slim body, darker at the head and the tip of its tail, and see-through wings beating up
// and down as it flies, or held out flat as it rests.
const drawDragonfly = (ctx, world, v) => {
  const { h, s, l } = v.color;
  const [x, y, d] = [Math.round(v.x), Math.round(v.y), v.dir];
  const alpha = ctx.globalAlpha;
  ctx.fillStyle = VISITOR_WING;
  ctx.globalAlpha = alpha * 0.55;
  const beat = (world.time + Math.floor(v.seed)) % 4 < 2;
  if (v.state === 'perch') line(ctx, { x: x - d * 4, y: y - 1 }, { x: x + d * 2, y: y - 1 }, 1);
  else {
    for (const back of [0, 2]) {
      line(ctx, { x: x - d * back, y: y - 1 }, { x: x - d * (back + 2), y: beat ? y - 4 : y + 2 }, 1);
    }
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = hslHex(h, s, l);
  line(ctx, { x, y }, { x: x - d * 6, y: y + 1 }, 1);
  ctx.fillStyle = hslHex(h, s, l - 18);
  ctx.fillRect(x + d, y, 1, 1); // its head
  ctx.fillRect(x - d * 7, y + 1, 1, 1); // and the tip of its tail
};

// A bee: a striped body, a dark head in front, its wings a blur over its back (folded as it sits on a flower), and
// once it's been at the flowers, lumps of pollen on its back legs.
const drawBee = (ctx, world, v) => {
  const [x, y, d] = [Math.round(v.x), Math.round(v.y), v.dir];
  const alpha = ctx.globalAlpha;
  if (v.state !== 'sit') {
    ctx.fillStyle = VISITOR_WING;
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillRect(Math.min(x, x - d), y - 3 - (world.time % 2), 2, 1);
    ctx.globalAlpha = alpha;
  }
  for (let k = -2; k <= 1; k++) {
    ctx.fillStyle = k % 2 ? BEE_YELLOW : BEE_DARK;
    ctx.fillRect(x + d * k, y - 2, 1, 2);
  }
  ctx.fillStyle = BEE_DARK;
  ctx.fillRect(x + d * 2, y - 2, 1, 1);
  ctx.fillStyle = POLLEN_LOAD;
  if (v.pollen > 0.3) ctx.fillRect(x - d, y, 1, 1);
  if (v.pollen > 0.7) ctx.fillRect(x - d * 2, y, 1, 1);
};

// A cloud of gnats: each dancing about its middle on its own loops, gathering at first and thinning out at the end.
const drawGnats = (ctx, world, v) => {
  ctx.fillStyle = GNAT;
  const t = world.time;
  const shown = Math.min(v.n, Math.ceil(Math.min(v.age, v.life - v.age) / 40));
  for (let k = 0; k < shown; k++) {
    const gx = v.x + Math.sin(t * (0.04 + k * 0.005) + k * 2.3 + v.seed) * 4 * v.spread;
    const gy = v.y + Math.cos(t * (0.033 + k * 0.004) + k * 1.7 + v.seed) * 6 * v.spread;
    ctx.fillRect(Math.round(gx), Math.round(gy), 1, 1);
  }
};

const drawVisitors = (ctx, world) => {
  for (const v of world.visitors) {
    if (v.kind === 'dragonfly') drawDragonfly(ctx, world, v);
    else if (v.kind === 'bee') drawBee(ctx, world, v);
    else drawGnats(ctx, world, v);
  }
};

// Aphids: pale green specks along the stems, the grown ones two pixels long.
const drawAphids = (ctx, world) => {
  for (const a of world.aphids) {
    ctx.fillStyle = a.size < 1 ? '#c8e6a0' : '#94c45c';
    ctx.fillRect(Math.round(a.x), Math.round(a.y), a.size < 1 ? 1 : 2, 1);
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

  for (const obj of world.objects) if (obj.kind === 'plant') drawPlant(ctx, obj);
  drawAphids(ctx, world);
  const sticks = world.branches.filter((g) => g.kind === 'stick');
  for (const g of sticks) {
    drawBranch(ctx, g, woodColors(g.obj.wood), stickWidth(g.obj.style, g.depth), g.obj.foliage, g.obj.style);
  }
  for (const g of sticks) for (const leaf of g.leaves) drawLeaf(ctx, g, leaf, g.obj.foliage);
  drawTerrain(ctx, world, false);
  drawGrass(ctx, world, world.objects.filter((obj) => obj.kind === 'grass'));
  for (const obj of world.objects) if (obj.kind === 'vine') drawVine(ctx, obj);
  if (world.tool === 'propagate') drawReady(ctx, world);

  const move = relocationAt(world);
  if (move) drawRelocation(ctx, world, move);
  if (world.placing && !world.hover) drawPlaceDemo(ctx, world);
  const preview = world.hover && previewAt(world);
  if (preview) drawPreview(ctx, world, preview);

  for (const bug of world.bugs) drawBug(ctx, world, bug);
  drawLitter(ctx, world);
  drawTerrain(ctx, world, true); // water over the bugs and fallen leaves, so they wade and sink
  drawWater(ctx, world);
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
  for (const b of world.fliers) drawFlier(ctx, world, b);
  drawVisitors(ctx, world);

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
  drawAir(ctx, world);
  drawDemo(ctx, world);
  if (world.tool === 'paint' && world.hover) drawBrush(ctx, world.pointer, world.brush.size * CELL + 1);
};
