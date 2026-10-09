// Drawing the fliers (ladybugs, shield bugs and soldier beetles): shells and spots, wings beating in flight, and what
// they're up to (pollen sparkles, a stink).
import { flierShape } from '../fliers.js';
import { add, distToSeg, hash, hslHex } from '../geom.js';
import { ARROW } from './marks.js';
import { COIN, sprite } from './pixelart.js';

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
// it), with its collar and head in front and its legs under it, stepping as it walks. To fly its wing cases lift and
// its wings beat out behind; on its back, playing dead, its legs are in the air. Every pixel round it is looked up in
// its own frame, like a fish's.
export const drawFlier = (ctx, world, b) => {
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
