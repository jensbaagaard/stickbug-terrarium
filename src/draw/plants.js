// Drawing plants and sticks: branches and the leaves on them; flowering plants (stems, leaves yellowing with age, buds,
// and flowers of every form opening and wilting); clump plants (their leaves, fronds, flowers and baby plants); grass;
// vines; and fallen leaves and petals.
import { stickWidth } from '../decor.js';
import { add, clamp, dirOf, hash, hslHex, lerp, normalize, pointAt, segDir, segLength, segNormal } from '../geom.js';
import { wind } from '../life.js';
import { COIN, line, plot } from './pixelart.js';
import { imageLayer, pixel } from './pixels.js';

const BUD = 0.4; // a flower is a closed bud till it's this far open

export const woodColors = (w) => ({
  dark: hslHex(w.h, w.s, w.l),
  light: hslHex(w.h, w.s, w.l + 14),
  knot: hslHex(w.h, w.s, w.l - 10),
});
const MOSS = ['#5f8f3a', '#7aa84a'];

// A stick's branches hang below their surface line, lit along the top, maybe with knots and patches of moss.
// Bamboo is ringed at its nodes, and a cholla skeleton is full of holes.
export const drawBranch = (ctx, g, colors, width, look, style) => {
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

export const drawLeaf = (ctx, g, leaf, fol) => {
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
    case 'lotus': {
      // A bowl of pointed petals round a seed pod: the outer ones splayed out low, the inner ones standing up.
      for (const [n, reach, fan] of [
        [f.petals, len * 1.1, 0.95],
        [Math.max(3, f.petals - 3), len * 1.2, 0.5],
      ]) {
        for (let i = Math.floor(wilt * n); i < n; i++) {
          const a0 = -Math.PI / 2 + ((i + 0.5) / n - 0.5) * Math.PI * fan;
          const a = a0 + Math.atan2(Math.cos(a0), Math.sin(a0)) * wilt * 0.6; // drooping toward straight down
          for (let k = 0; k <= reach; k += 0.5) {
            ctx.fillStyle = petalAt(k / reach);
            const w = wide * 0.8 * Math.sin(Math.PI * (0.15 + 0.85 * (k / reach)));
            plot(ctx, c.x + Math.cos(a) * k, c.y + Math.sin(a) * k, Math.max(1, w));
          }
        }
      }
      ctx.fillStyle = centre;
      plot(ctx, c.x, c.y - 1, Math.max(1, f.centreSize * s));
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
export const drawPlant = (ctx, plant) => {
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
export const drawLitter = (ctx, world) => {
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
export const drawGrass = (ctx, world, patches) => {
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
export const drawVine = (ctx, vine) => {
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

export const debrisColor = (look) => {
  if (look.kind === 'stick') return woodColors(look.wood).light;
  const sp = look.plant?.species;
  const { h, s, l } = look.kind === 'vine' ? look.vine.genome.stem : look.leaf ? sp.leaf : sp.stem;
  return hslHex(h, s, l);
};

// A stick: its pieces, then the leaves on them.
export const drawStick = (ctx, obj) => {
  for (const g of obj.segs) {
    drawBranch(ctx, g, woodColors(obj.wood), stickWidth(obj.style, g.depth), obj.foliage, obj.style);
  }
  for (const g of obj.segs) for (const leaf of g.leaves) drawLeaf(ctx, g, leaf, obj.foliage);
};
