// The back of the tank: the wallpapers, patterns and scenes, drawn once into images, and the life in the scenes
// drawn over them every frame: stars twinkling and shooting, clouds and mist drifting by, snow far off, a city's
// lights, the aurora rippling, and now and then something passing (birds, bats, a shoal, a whale, a comet, a plane).
// Like the breeze, all of that is a function of the time alone: nothing of it is kept or saved.
import { hash, hslHex, rgb } from './geom.js';
import { wind } from './life.js';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; // 4x4 ordered dither
const bayer = (x, y) => BAYER[(y % 4) * 4 + (x % 4)] / 16;
// Hill ranges, far then near: height above the floor and how much it rolls (both in tank heights), and two
// wave frequencies.
const RANGES = [
  [0.34, 0.08, 5, 13],
  [0.18, 0.06, 8, 21],
];

// A wallpaper's inks: its base, its accent, a brighter accent, stars, a shade darker than the base, and a glow (a
// moon or sun, lit windows, a planet); and for the life in the scenes, a light (lit cloud, mist, the aurora's
// brightest) and a shadow (birds against the sky, things far off in the deep).
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
    hslHex(a.h, a.s, a.l + 14),
    hslHex(b.h, b.s, b.l - 7),
  ];
};
const [BASE, ACCENT, BRIGHT, STAR, DARK, GLOW, LIT, SHADOW] = [0, 1, 2, 3, 4, 5, 6, 7];
// A scene is drawn in layers, so what moves in it can pass behind its hills and trees: each pixel is an ink plus
// how near it is, from the sky (0) to the nearest hills or trees.
const [FAR, MID, NEAR] = [8, 16, 24];
const DEPTHS = [0, FAR, MID, NEAR];

// A dusk sky: dark overhead, brightening toward the horizon in dithered steps (up to ink top), with a few stars
// up high.
const skyInk = (wp, x, y, floor, top = BRIGHT, stars = 0.004) => {
  const f = y / floor;
  if (f < 0.6 && hash(wp.seed, x, y) < stars) return STAR;
  return Math.min(top, Math.floor(f * f * (top + 0.5) + bayer(x, y)));
};

// Where the top of a rolling range of hills is at x (its y), range k of the seed's ranges.
const hillTop = (wp, k, x, floor, [height, roll, f1, f2]) => {
  const u = x / floor;
  const phase = (j) => hash(wp.seed, k, j) * Math.PI * 2;
  const wave = 0.6 * Math.sin(u * f1 + phase(1)) + 0.4 * Math.sin(u * f2 + phase(2));
  return floor * (1 - height - roll * wave);
};

// The desert's dunes, nearest first: which hill range, its height and roll, its ink and how near it is.
const DUNES = [
  [2, 0.1, 0.04, DARK, NEAR],
  [1, 0.2, 0.06, BASE, MID],
  [0, 0.3, 0.07, ACCENT, FAR],
];
const duneTop = (wp, x, floor, [k, h, roll]) => hillTop(wp, k, x, floor, [h, roll, 4 + k * 3, 9 + k * 4]);

// The ringed planet in space: where it is and how big.
const planetOf = (floor) => [floor * 0.25, floor * 0.3, floor * 0.1];

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

// Which ink goes at (x, y), plus how near it is. floor is the dirt line, for the styles with a sky.
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
      const flake = hash(wp.seed, x, y) < 0.008;
      const near = hillTop(wp, 1, x, floor, RANGES[1]);
      if (y >= near) return (flake ? STAR : BRIGHT) + NEAR;
      const far = (cx) => hillTop(wp, 0, cx, floor, RANGES[0]);
      if (inPines(wp, 0, x, y, far, 13, floor * 0.05, floor * 0.1)) return (flake ? STAR : DARK) + FAR;
      if (y >= far(x)) return (flake ? STAR : ACCENT) + FAR;
      return flake ? STAR : skyInk(wp, x, y, floor, BASE, 0);
    }
    case 'forest': {
      // A moon over two rows of pines, the nearer row darker.
      const [mx, my, mr] = [floor * 0.55, floor * 0.22, floor * 0.04];
      if (inPines(wp, 1, x, y, () => floor, 15, floor * 0.14, floor * 0.3)) return DARK + NEAR;
      if (inPines(wp, 0, x, y, () => floor * 0.94, 9, floor * 0.28, floor * 0.5)) return BASE + FAR;
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
      if (y >= front) return DARK + NEAR;
      const back = ridge(1, floor * 0.16, 0.2, 0.62);
      if (y >= back) return (y < back + floor * 0.06 && back < floor * 0.58 ? BRIGHT : BASE) + FAR;
      return skyInk(wp, x, y, floor, ACCENT);
    }
    case 'desert': {
      // Dunes in three ridges under a big low moon, each ridge lit along its crest.
      for (const dune of DUNES) {
        const [, , , ink, depth] = dune;
        const top = duneTop(wp, x, floor, dune);
        if (y >= top) return (y < top + 1.5 && ink !== ACCENT ? BRIGHT : ink) + depth;
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
        if (y > floor - h && Math.abs(x - cx) < 1.3 * (0.4 + (y - floor + h) / h)) return DARK + FAR;
      }
      const cell = [Math.floor(x / 9), Math.floor(y / 9)];
      if (hash(wp.seed, ...cell) < 0.06) {
        const r = 1 + Math.floor(hash(wp.seed, cell[0], cell[1] + 7) * 2);
        if (Math.abs(Math.hypot(x - cell[0] * 9 - 4, y - cell[1] * 9 - 4) - r) < 0.5) return STAR;
      }
      const depth = [BRIGHT, ACCENT, BASE, DARK][Math.min(3, Math.floor(f * 3.2 + bayer(x, y)))];
      const ray = f < 0.65 && (x + y * 0.4) % 23 < 3 + 3 * hash(wp.seed, Math.floor((x + y * 0.4) / 23), 6);
      return ray ? [BRIGHT, BRIGHT, ACCENT, BASE, BASE, ACCENT][depth] : depth;
    }
    case 'aurora': {
      // Curtains of light hanging in the night sky over a dark horizon.
      if (y >= hillTop(wp, 0, x, floor, [0.08, 0.03, 6, 15])) return DARK + NEAR;
      for (const k of [0, 1]) {
        const phase = hash(wp.seed, 8, k) * 6.28;
        const sway = Math.sin(x * 0.05 + phase) * 0.04 + Math.sin(x * 0.013 + phase) * 0.07;
        const top = floor * (0.18 + 0.12 * k + sway);
        const len = floor * (0.1 + 0.08 * (0.5 + 0.5 * Math.sin(x * 0.031 + phase * 2)));
        const d = (y - top) / len;
        if (d >= 0 && d < 1 && hash(wp.seed, x, 3) > d * 0.8) return (d < 0.35 ? BRIGHT : ACCENT) + FAR;
      }
      if (hash(wp.seed, x, y) < 0.005) return STAR;
      return y / floor + bayer(x, y) / 2 < 0.5 ? DARK : BASE;
    }
    case 'city': {
      // A skyline of lit windows at dusk, the nearer buildings darker.
      const near = buildingAt(wp, 1, x, y, floor, floor * 0.08, floor * 0.28);
      const b = near ?? buildingAt(wp, 0, x, y, floor, floor * 0.2, floor * 0.5);
      if (b) {
        const [wx, wy] = [x - b.left, y - b.top];
        const window = wx > 1 && wx < b.w - 1 && wx % 3 === 1 && wy > 2 && wy % 4 === 2;
        const lit = window && hash(wp.seed, x, y + (near ? 1 : 0)) < (near ? 0.4 : 0.25);
        if (near) return (lit ? GLOW : DARK) + NEAR;
        return (lit ? ACCENT : BASE) + FAR;
      }
      return skyInk(wp, x, y, floor, BRIGHT, 0.002);
    }
    case 'space': {
      // Stars and a nebula, and a ringed planet.
      const [px, py, pr] = planetOf(floor);
      const [dx, dy] = [x - px, y - py];
      const ring = Math.abs((dx / (pr * 2)) ** 2 + (dy / (pr * 0.45)) ** 2 - 1) < 0.07;
      const inPlanet = Math.hypot(dx, dy) < pr;
      if (ring && (!inPlanet || dy > 0)) return BRIGHT + FAR;
      if (inPlanet) return (dx + dy < pr * 0.3 + (bayer(x, y) - 0.5) * pr * 0.5 ? GLOW : BASE) + FAR;
      if (hash(wp.seed, x, y) < 0.01) return STAR;
      const cloud = Math.sin(x * 0.04 + hash(wp.seed, 1, 1) * 6) * Math.sin(y * 0.05) + Math.sin((x + y) * 0.025);
      return cloud + bayer(x, y) > 1.3 ? ACCENT : y / floor > 0.5 ? BASE : DARK;
    }
    case 'jungle': {
      // Big leaves in layers, the nearest darkest, each with a paler midrib, over dappled light.
      for (const [layer, cell, ink, rib, depth] of [
        [2, 30, DARK, BASE, NEAR],
        [1, 24, BASE, ACCENT, FAR],
        [0, 18, ACCENT, BRIGHT, 0],
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
            if (inLeaf) return (Math.abs(v) < 0.6 ? rib : ink) + depth;
          }
        }
      }
      return bayer(x, y) < 0.5 + 0.3 * Math.sin(x * 0.07) * Math.sin(y * 0.05) ? BRIGHT : ACCENT;
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
      for (const k of [1, 0]) if (y >= hillTop(wp, k, x, floor, RANGES[k])) return k ? DARK + NEAR : BASE + FAR;
  }
  return skyInk(wp, x, y, floor); // dusk
};

// Pixel i of an image, opaque, in a #rrggbb colour.
const put = (image, i, hex) => {
  const [r, g, b] = rgb(hex);
  const d = image.data;
  [d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]] = [r, g, b, 255];
};
const canvasOf = (image) => {
  const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height });
  canvas.getContext('2d').putImageData(image, 0, 0);
  return canvas;
};
// A #rrggbb colour a share k of the way to another.
const mix = (a, b, k) => {
  const [ca, cb] = [rgb(a), rgb(b)];
  return `#${ca.map((v, i) => Math.round(v + (cb[i] - v) * k).toString(16).padStart(2, '0')).join('')}`;
};

// Like the terrain, a wallpaper is drawn once into images the size of the tank above the dirt, one for each depth
// of it, and again only for a tank of another size. Kept with them: the ink at every pixel, and what the life in
// the scene works out from it the first time it's drawn (where the stars are, which windows are lit).
const papers = new WeakMap();
const paperOf = (wp, W, floor) => {
  let sizes = papers.get(wp);
  if (!sizes) papers.set(wp, (sizes = new Map()));
  let p = sizes.get(`${W}x${floor}`);
  if (p) return p;
  const hex = wallpaperInks(wp);
  const codes = new Uint8Array(W * floor);
  const images = [];
  for (let y = 0, i = 0; y < floor; y++) {
    for (let x = 0; x < W; x++, i++) {
      const code = (codes[i] = wallpaperInk(wp, x, y, floor));
      put((images[code >> 3] ??= new ImageData(W, floor)), i, hex[code & 7]);
    }
  }
  p = { W, floor, hex, codes, layers: images.map(canvasOf), made: new Map() };
  sizes.set(`${W}x${floor}`, p);
  return p;
};

// ---------- the life in the scenes ----------

// Each scene's life is a list of effects, each drawn at one depth of the scene, just over its layer there, from the
// time and, if it has a make, what that worked out the first time.

// Something that happens now and then: in each stretch of `every` ticks, by chance, once, for `len` ticks, over
// within its stretch. How far through it is (0..1) and its own dice to roll (k picks which), or null if not now.
const happening = (world, wp, salt, every, chance, len) => {
  const n = Math.floor(world.time / every);
  const roll = (k) => hash(wp.seed + salt, n, k);
  const u = (world.time - n * every - roll(1) * (every - len)) / len;
  return roll(0) < chance && u >= 0 && u < 1 ? { u, roll } : null;
};

// Across the tank and off the other side, by a share u of the way, starting `margin` px off the edge: x at u.
const across = (W, u, dir, margin) => {
  const run = -margin + u * (W + 2 * margin);
  return dir > 0 ? run : W - run;
};

// The stars twinkle, slowly: each fades down and back up again every half a minute or so, on its own clock, and
// now and then one glints.
const TWINKLE_TICKS = 90; // to fade down and back up
const GLINT_TICKS = 60;
const twinkle = {
  depth: 0,
  make: (wp, p) => {
    const stars = [];
    p.codes.forEach((code, i) => {
      if (code !== STAR) return;
      const [x, y] = [i % p.W, Math.floor(i / p.W)];
      const sky = p.hex[p.codes[x ? i - 1 : i + 1] & 7];
      const r = (k) => hash(wp.seed, i, 40 + k);
      const dim = mix(p.hex[STAR], sky, 0.65);
      stars.push({ x, y, dim, period: 900 + Math.floor(r(1) * 1800), at: r(2) * 2700, glints: r(3) < 0.02 });
    });
    return { stars, glint: hslHex(wp.accent.h, 20, 88) };
  },
  draw: (ctx, world, wp, p, { stars, glint }) => {
    for (const s of stars) {
      const c = (world.time + s.at) % s.period;
      const g = c - s.period / 2;
      if (c < TWINKLE_TICKS) {
        ctx.globalAlpha = Math.sin((Math.PI * c) / TWINKLE_TICKS);
        ctx.fillStyle = s.dim;
        ctx.fillRect(s.x, s.y, 1, 1);
      } else if (s.glints && g >= 0 && g < GLINT_TICKS) {
        const k = Math.sin((Math.PI * g) / GLINT_TICKS);
        ctx.globalAlpha = k;
        ctx.fillStyle = glint;
        ctx.fillRect(s.x, s.y, 1, 1);
        ctx.globalAlpha = k * 0.4;
        ctx.fillRect(s.x - 1, s.y, 3, 1);
        ctx.fillRect(s.x, s.y - 1, 1, 3);
      }
    }
  },
};

// Now and then (a minute or so apart) a shooting star streaks down across the upper sky, flares and burns out.
const SHOOT_TICKS = 36;
const shootingStar = {
  depth: 0,
  draw: (ctx, world, wp, p) => {
    const e = happening(world, wp, 1, 1500, 0.45, SHOOT_TICKS);
    if (!e) return;
    const { u, roll } = e;
    const a = 0.2 + 0.5 * roll(3); // radians below level
    const [dx, dy] = [Math.cos(a) * (roll(2) < 0.5 ? -1 : 1), Math.sin(a)];
    const [x0, y0] = [p.W * (0.15 + 0.7 * roll(4)), p.floor * (0.04 + 0.26 * roll(5))];
    const run = 2.5 * SHOOT_TICKS * u;
    const flare = Math.sin(Math.PI * u);
    const tail = Math.round(3 + 9 * flare);
    for (let k = tail - 1; k >= 0; k--) {
      ctx.globalAlpha = flare * (1 - k / tail);
      ctx.fillStyle = k ? p.hex[STAR] : p.hex[LIT];
      ctx.fillRect(Math.round(x0 + dx * (run - k)), Math.round(y0 + dy * (run - k)), 1, 1);
    }
  },
};

// A band of the sky (top to bottom, in tank heights) where something drifts by, wrapping round: drawn once into a
// strip as wide as the tank, then slid along a pixel every `pace` ticks. painter, given the strip's size, says which
// ink goes at each pixel of it (null for none). breathe, if given, sets how thick it is now (0..1) from the time.
const drifting = (depth, top, bottom, alpha, pace, painter, breathe) => ({
  depth,
  make: (wp, p) => {
    const [W, y0, h] = [p.W, Math.round(p.floor * top), Math.round(p.floor * (bottom - top))];
    const image = new ImageData(W, h);
    const paint = painter(wp, W, h);
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < W; x++, i++) {
        const ink = paint(x, y);
        if (ink !== null) put(image, i, p.hex[ink]);
      }
    }
    return { strip: canvasOf(image), y0 };
  },
  draw: (ctx, world, wp, p, { strip, y0 }) => {
    const off = Math.floor(world.time / pace) % p.W;
    ctx.globalAlpha = alpha * (breathe ? breathe(world.time, wp) : 1);
    ctx.drawImage(strip, off, y0);
    ctx.drawImage(strip, off - p.W, y0);
  },
});

// Clouds: a few heaps of round puffs on flat bottoms, spread along the band, dithered round their edges, a body ink
// lit along the bottom by rim. stretch draws them out sideways (long and low at dusk). salt places them.
const clouds = (depth, top, bottom, alpha, pace, [body, rim], stretch, salt) =>
  drifting(depth, top, bottom, alpha, pace, (wp, W, h) => {
    const r = (i, k) => hash(wp.seed + salt, i, k);
    const puffs = [];
    for (let i = 0, n = Math.max(2, Math.round(W / 70)); i < n; i++) {
      const cx = ((i + 0.2 + 0.6 * r(i, 1)) * W) / n;
      const base = h * (0.45 + 0.5 * r(i, 2));
      const size = Math.min(base / 1.5, h * (0.07 + 0.08 * r(i, 3))); // so the heap's top stays in the band
      const m = 3 + Math.floor(r(i, 4) * 4);
      for (let j = 0; j < m; j++) {
        const rad = size * (0.6 + 0.4 * Math.sin((Math.PI * (j + 0.5)) / m)) * (0.85 + 0.3 * r(i, 10 + j));
        puffs.push({ x: cx + (j - (m - 1) / 2) * size * stretch * 0.7, y: base - rad * 0.5, r: rad, base });
      }
    }
    return (x, y) => {
      let best = null;
      for (const c of puffs) {
        if (y > c.base) continue;
        const dx = ((((x - c.x) % W) + W * 1.5) % W) - W / 2; // wrapping round
        const e = 1 - Math.hypot(dx / stretch, y - c.y) / c.r; // 1 at the middle of the puff, 0 at its edge
        if (e > 0 && (!best || e > best.e)) best = { e, c };
      }
      if (!best || (best.e < 0.3 && best.e / 0.3 < bayer(x, y))) return null;
      return y > best.c.base - 1.5 ? rim : body;
    };
  });

// Mist lying in a band, thickest through its middle and in drifts along it, slowly coming and going over a few
// minutes.
const mist = (depth, top, bottom, alpha, pace, salt) =>
  drifting(
    depth,
    top,
    bottom,
    alpha,
    pace,
    (wp, W, h) => {
      const [a, b] = [hash(wp.seed + salt, 1) * 6.28, hash(wp.seed + salt, 2) * 6.28];
      return (x, y) => {
        const u = (x / W) * Math.PI * 2; // whole waves round the strip, so it wraps without a seam
        const along = 0.55 + 0.3 * Math.sin(2 * u + a) + 0.15 * Math.sin(5 * u + b);
        const wisp = 0.85 + 0.15 * Math.sin(y * 0.4 + 2 * Math.sin(3 * u + b));
        return Math.sin((Math.PI * y) / h) ** 1.5 * along * wisp > 0.25 + bayer(x, y) * 0.75 ? STAR : null;
      };
    },
    (t, wp) => 0.55 + 0.45 * Math.sin(t * 0.0005 + hash(wp.seed, salt) * 6),
  );

// Snow far off, falling slowly in front of the far hill and behind the near one, leaning as the breeze blows.
const farSnow = {
  depth: FAR,
  make: (wp, p) =>
    Array.from({ length: Math.round((p.W * p.floor) / 1400) }, (_, i) => {
      const r = (k) => hash(wp.seed, i, 60 + k);
      return { x: r(1) * p.W, y: r(2) * p.floor, fall: 0.06 + 0.06 * r(3), sway: r(4) * 6 };
    }),
  draw: (ctx, world, wp, p, flakes) => {
    const t = world.time;
    ctx.fillStyle = p.hex[STAR];
    ctx.globalAlpha = 0.55;
    for (const f of flakes) {
      const x = f.x + Math.sin(t * 0.02 + f.sway) * 1.5 + wind(world, f.x) * 4;
      ctx.fillRect(Math.round(((x % p.W) + p.W) % p.W), Math.floor((f.y + t * f.fall) % p.floor), 1, 1);
    }
  },
};

// A bird, three pixels across: wings up, wings down, or held out to glide.
const bird = (ctx, x, y, pose) => {
  if (pose === 2) return ctx.fillRect(x - 1, y, 3, 1);
  ctx.fillRect(x, y, 1, 1);
  ctx.fillRect(x - 1, y + (pose ? 1 : -1), 1, 1);
  ctx.fillRect(x + 1, y + (pose ? 1 : -1), 1, 1);
};

// Now and then a few birds cross the sky in a ragged V, flapping and gliding by turns; or a bat or two, flitting.
const flock = (bats) => ({
  depth: 0,
  draw: (ctx, world, wp, p) => {
    const speed = bats ? 0.45 : 0.3;
    const e = happening(world, wp, bats ? 3 : 4, 4800, 0.5, Math.round((p.W + 60) / speed));
    if (!e) return;
    const { u, roll } = e;
    const dir = roll(2) < 0.5 ? -1 : 1;
    // Birds low over the horizon, where they show against the glow; bats up by the moon.
    const high = bats ? 0.14 + 0.2 * roll(4) : 0.3 + 0.25 * roll(4);
    const [x, y] = [across(p.W, u, dir, 30), p.floor * high + Math.sin(u * 9) * 3];
    ctx.fillStyle = p.hex[SHADOW];
    for (let i = 0, n = bats ? 1 + Math.floor(roll(3) * 2) : 3 + Math.floor(roll(3) * 5); i < n; i++) {
      const t = world.time + i * 11;
      if (bats) {
        const [bx, by] = [x - dir * i * 10 + Math.sin(t * 0.11 + i) * 5, y + i * 5 + Math.sin(t * 0.07 + i * 2) * 6];
        bird(ctx, Math.round(bx), Math.round(by), Math.floor(t / 3) % 2);
      } else {
        const [rank, side] = [Math.ceil(i / 2), i % 2 ? 1 : -1];
        const [bx, by] = [x - dir * rank * 5, y + side * rank * 3 + Math.sin(t * 0.05) * 0.8];
        bird(ctx, Math.round(bx), Math.round(by), t % 160 < 60 ? Math.floor(t / 7) % 2 : 2);
      }
    }
  },
});

// Sand blown off a dune's crest as a gust of the breeze goes over it, streaming away downwind: the harder it
// blows, the more of the crest goes.
const blownSand = (dune) => ({
  depth: dune[4],
  make: (wp, p) =>
    Array.from({ length: Math.ceil(p.W / 4) }, (_, j) => {
      const x = j * 4 + 2;
      return { x, y: duneTop(wp, x, p.floor, dune), at: hash(wp.seed, x, 70 + dune[0]) };
    }),
  draw: (ctx, world, wp, p, crest) => {
    ctx.fillStyle = p.hex[LIT];
    for (const c of crest) {
      const w = wind(world, c.x);
      if ((Math.abs(w) - 0.6) / 0.8 <= c.at) continue;
      for (let g = 0; g < 3; g++) {
        const d = (world.time * 0.6 + hash(c.x, g, 72) * 16) % 16; // px downwind
        ctx.globalAlpha = (1 - d / 16) * 0.6;
        ctx.fillRect(Math.round(c.x + Math.sign(w) * d), Math.round(c.y - 1 - d * 0.3 + (d * d) / 40), 1, 1);
      }
    }
  },
});

// Far-off strings of bubbles rising from the bottom of the sea, each coming and going.
const farBubbles = {
  depth: FAR,
  make: (wp, p) =>
    Array.from({ length: Math.max(3, Math.round(p.W / 50)) }, (_, i) => ({
      x: hash(wp.seed, i, 80) * p.W,
      at: hash(wp.seed, i, 81) * 1000,
    })),
  draw: (ctx, world, wp, p, strings) => {
    const t = world.time;
    ctx.fillStyle = p.hex[STAR];
    for (const s of strings) {
      const on = (Math.sin((t + s.at) * 0.002) - 0.3) / 0.3;
      if (on <= 0) continue;
      for (let j = 0; j < 6; j++) {
        const y = p.floor - ((t * 0.35 + s.at + (j * p.floor) / 6) % p.floor);
        ctx.globalAlpha = Math.min(1, on) * (0.2 + 0.4 * (1 - y / p.floor)); // brighter toward the light
        ctx.fillRect(Math.round(s.x + Math.sin(y * 0.1 + j) * 1.2), Math.round(y), 1, 1);
      }
    }
  },
};

// Now and then a shoal of little silvery fish passes far off, behind the kelp, one now and then catching the light.
const shoal = {
  depth: 0,
  draw: (ctx, world, wp, p) => {
    const e = happening(world, wp, 5, 3600, 0.6, Math.round((p.W + 80) / 0.3));
    if (!e) return;
    const { u, roll } = e;
    const t = world.time;
    const dir = roll(2) < 0.5 ? -1 : 1;
    const [x, y] = [across(p.W, u, dir, 40), p.floor * (0.25 + 0.4 * roll(3)) + Math.sin(u * 9) * 6];
    const spread = 1 + 0.25 * Math.sin(t * 0.01);
    for (let i = 0, n = 8 + Math.floor(roll(4) * 10); i < n; i++) {
      const fx = x + ((hash(wp.seed, i, 90) - 0.5) * 30 + Math.sin(t * 0.05 + i) * 1.5) * spread;
      const fy = y + ((hash(wp.seed, i, 91) - 0.5) * 12 + Math.sin(t * 0.04 + i * 2)) * spread;
      const glint = hash(i, Math.floor(t / 10), wp.seed) < 0.04;
      ctx.fillStyle = p.hex[glint ? STAR : LIT];
      ctx.globalAlpha = glint ? 0.9 : 0.7;
      ctx.fillRect(Math.round(fx) - (dir > 0 ? 1 : 0), Math.round(fy), 2, 1);
    }
  },
};

// Once in a long while a whale glides by far off in the deep, behind the kelp, slowly beating its tail.
const whale = {
  depth: 0,
  draw: (ctx, world, wp, p) => {
    const L = Math.round(p.floor * 0.2);
    const e = happening(world, wp, 6, 10800, 0.4, Math.round((p.W + 2 * L) / 0.12));
    if (!e) return;
    const { u, roll } = e;
    const dir = roll(2) < 0.5 ? -1 : 1;
    const [hx, y] = [across(p.W, u, dir, L), p.floor * (0.3 + 0.25 * roll(3))];
    const beat = Math.sin(world.time * 0.025) * L * 0.06;
    ctx.fillStyle = p.hex[SHADOW];
    ctx.globalAlpha = 0.55;
    for (let i = 0; i <= L; i++) {
      const v = i / L; // 0 at the nose, 1 at the tip of the tail
      // Round at the head, tapering to the tail stock, then the flukes flaring out again; the tail beating.
      const body = v < 0.2 ? Math.sqrt(v / 0.2) : v < 0.85 ? (1 - (v - 0.2) / 0.65) ** 0.8 : (v - 0.85) / 0.33;
      const half = L * 0.1 * body;
      const mid = y + (v > 0.5 ? beat * ((v - 0.5) / 0.5) ** 2 : 0);
      const x = Math.round(hx - dir * i);
      ctx.fillRect(x, Math.round(mid - half), 1, Math.max(1, Math.round(half * 1.8)));
      if (v > 0.25 && v < 0.38) ctx.fillRect(x, Math.round(mid + half * 0.8), 1, Math.round((v - 0.25) * 25)); // fin
    }
  },
};

// The aurora's curtains rippling: waves of brighter light rolling along them, flickering in their folds.
const shimmer = {
  depth: FAR,
  make: (wp, p) => {
    const image = new ImageData(p.W, p.floor);
    let [top, bottom] = [p.floor, 0];
    p.codes.forEach((code, i) => {
      if (code >> 3 !== FAR >> 3) return;
      put(image, i, p.hex[LIT]);
      top = Math.min(top, Math.floor(i / p.W));
      bottom = Math.max(bottom, Math.floor(i / p.W));
    });
    return { curtains: canvasOf(image), top, h: bottom - top + 1 };
  },
  draw: (ctx, world, wp, p, { curtains, top, h }) => {
    const t = world.time;
    if (h <= 0) return;
    for (let x = 0; x < p.W; x += 4) {
      const roll = 0.5 + 0.5 * Math.sin(x * 0.04 - t * 0.02);
      const swell = 0.5 + 0.5 * Math.sin(x * 0.013 + t * 0.006 + 2);
      const a = roll * roll * swell * (0.75 + 0.25 * hash(x, Math.floor(t / 5), 7)) * 0.7;
      if (a < 0.06) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(curtains, x, top, 4, h, x, top, 4, h);
    }
  },
};

// The city's lit windows, at one depth of it: each goes out now and then for a while, and in a few a television
// flickers blue.
const windows = (depth) => ({
  depth,
  make: (wp, p) => {
    const [lit, wall] = depth === NEAR ? [GLOW, DARK] : [ACCENT, BASE];
    const list = [];
    p.codes.forEach((code, i) => {
      if (code === lit + depth) list.push({ x: i % p.W, y: Math.floor(i / p.W), k: list.length });
    });
    return { list, wall: p.hex[wall], tv: [hslHex(205, 45, 50), hslHex(220, 40, 36)] };
  },
  draw: (ctx, world, wp, p, { list, wall, tv }) => {
    const t = world.time;
    for (const w of list) {
      if (hash(wp.seed, w.k, Math.floor((t + w.k * 397) / 1200)) < 0.15) ctx.fillStyle = wall;
      else if (depth === NEAR && hash(wp.seed, w.k, 5) < 0.05) ctx.fillStyle = tv[+(hash(w.k, t >> 3) < 0.4)];
      else continue;
      ctx.fillRect(w.x, w.y, 1, 1);
    }
  },
});

// A red light blinking on the roof of the tallest building.
const beacon = {
  depth: NEAR,
  make: (wp, p) => {
    const i = p.codes.findIndex((code) => code >= FAR); // the top of the highest roof, at its left
    if (i < 1) return null;
    const [x0, y] = [i % p.W, Math.floor(i / p.W)];
    let x1 = x0;
    while (x1 + 1 < p.W && p.codes[y * p.W + x1 + 1] >= FAR) x1++;
    return { x: Math.floor((x0 + x1) / 2), y: y - 1, red: hslHex(0, 75, 50) };
  },
  draw: (ctx, world, wp, p, at) => {
    const c = world.time % 120;
    if (!at || c >= 40) return;
    ctx.globalAlpha = Math.sin((Math.PI * c) / 40);
    ctx.fillStyle = at.red;
    ctx.fillRect(at.x, at.y, 1, 1);
  },
};

// Now and then a plane crosses high over the city, only its lights showing: a red one, and a white one that flashes.
const plane = {
  depth: 0,
  draw: (ctx, world, wp, p) => {
    const e = happening(world, wp, 7, 4800, 0.5, Math.round((p.W + 20) / 0.2));
    if (!e) return;
    const { u, roll } = e;
    const dir = roll(2) < 0.5 ? -1 : 1;
    const [x, y] = [Math.round(across(p.W, u, dir, 10)), Math.round(p.floor * (0.06 + 0.15 * roll(3)) - u * 6)];
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = hslHex(0, 70, 45);
    ctx.fillRect(x, y, 1, 1);
    if (world.time % 70 < 4) {
      ctx.fillStyle = hslHex(0, 0, 90);
      ctx.fillRect(x - dir * 2, y, 1, 1);
    }
  },
};

// A little moon going round the ringed planet in the plane of its rings, behind it and then in front by turns: drawn
// behind the planet for the far half of its way round, in front for the near half.
const moon = (front) => ({
  depth: front ? FAR : 0,
  draw: (ctx, world, wp, p) => {
    const [px, py, pr] = planetOf(p.floor);
    const a = (world.time / 3000) * Math.PI * 2 + hash(wp.seed, 9, 9) * 6.28;
    if (Math.sin(a) > 0 !== front) return;
    const [x, y] = [Math.round(px + Math.cos(a) * pr * 2.7), Math.round(py + Math.sin(a) * pr * 0.62)];
    ctx.fillStyle = p.hex[STAR];
    ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = p.hex[DARK]; // its night side, away from the planet's lit side
    ctx.fillRect(x + 1, y + 1, 1, 1);
  },
});

// Now and then a comet drifts across the sky, its tail streaming out behind it.
const COMET_TAIL = 26;
const comet = {
  depth: 0,
  draw: (ctx, world, wp, p) => {
    const e = happening(world, wp, 8, 6000, 0.5, 1200);
    if (!e) return;
    const { u, roll } = e;
    const a = 0.15 + 0.35 * roll(3);
    const [dx, dy] = [Math.cos(a) * (roll(2) < 0.5 ? -1 : 1), Math.sin(a)];
    const run = (u - 0.5) * (p.W + 60);
    const [x, y] = [p.W * (0.3 + 0.4 * roll(4)) + dx * run, p.floor * (0.15 + 0.4 * roll(5)) + dy * run];
    const fade = Math.min(1, Math.sin(Math.PI * u) * 3);
    for (let k = COMET_TAIL - 1; k >= 0; k--) {
      ctx.fillStyle = k < 2 ? hslHex(wp.accent.h, 20, 88) : p.hex[STAR];
      const [tx, ty] = [Math.round(x - dx * k), Math.round(y - dy * k)];
      const glow = fade * (1 - k / COMET_TAIL);
      ctx.globalAlpha = glow;
      ctx.fillRect(tx, ty, 1, 1);
      ctx.globalAlpha = glow * 0.45; // the tail fanning out to either side
      for (const fan of [-k / 9, k / 9]) ctx.fillRect(Math.round(tx - dy * fan), Math.round(ty + dx * fan), 1, 1);
    }
  },
};

// Now and then a leaf comes down, see-sawing as it falls behind the nearest leaves.
const fallingLeaf = {
  depth: FAR,
  draw: (ctx, world, wp, p) => {
    const len = Math.round(p.floor / 0.22);
    const e = happening(world, wp, 9, len + 900, 0.6, len);
    if (!e) return;
    const { u, roll } = e;
    const swing = Math.sin(u * len * 0.035 + roll(3) * 6);
    const [x, y] = [Math.round(p.W * (0.1 + 0.8 * roll(2)) + swing * 6), Math.round(-3 + u * (p.floor + 3))];
    ctx.fillStyle = hslHex(wp.glow?.h ?? 60, 45, 32);
    // Five pixels long and two thick in the middle: level through the middle of its swing, tipped at either end.
    const tilt = Math.abs(swing) < 0.4 ? 0 : Math.sign(swing) * 0.5;
    for (let k = -2; k <= 2; k++) {
      const ky = y + Math.round(k * tilt);
      ctx.fillRect(x + k, ky, 1, Math.abs(k) < 2 ? 2 : 1);
    }
  },
};

// The life in each scene. The patterns have none.
const LIFE = {
  dusk: [twinkle, shootingStar, clouds(0, 0.5, 0.8, 0.6, 24, [BASE, LIT], 3, 1), flock(false)],
  hills: [
    twinkle,
    shootingStar,
    clouds(0, 0.22, 0.48, 0.5, 30, [ACCENT, BRIGHT], 1.8, 2),
    mist(FAR, 0.66, 0.84, 0.2, 16, 3),
    flock(false),
  ],
  winter: [farSnow],
  forest: [
    twinkle,
    shootingStar,
    flock(true),
    mist(FAR, 0.62, 0.92, 0.25, 14, 4),
    mist(NEAR, 0.86, 1, 0.18, 9, 5),
  ],
  mountains: [
    twinkle,
    shootingStar,
    clouds(0, 0.08, 0.3, 0.45, 36, [ACCENT, BRIGHT], 1.8, 6),
    mist(FAR, 0.55, 0.78, 0.22, 20, 7),
  ],
  desert: [twinkle, shootingStar, blownSand(DUNES[1]), blownSand(DUNES[0])],
  ocean: [whale, shoal, farBubbles],
  aurora: [twinkle, shootingStar, shimmer],
  city: [twinkle, plane, windows(FAR), windows(NEAR), beacon],
  space: [twinkle, comet, moon(false), moon(true)],
  jungle: [mist(0, 0.35, 0.95, 0.25, 18, 8), fallingLeaf],
};

// The back of the tank: plain black, or the wallpaper, layer by layer from the back, each with the life at its depth
// over it.
export const drawWallpaper = (ctx, world) => {
  const wp = world.wallpaper;
  if (!wp) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, world.W, world.H);
    return;
  }
  ctx.imageSmoothingEnabled = false;
  const p = paperOf(wp, world.W, world.ground.y0);
  const life = LIFE[wp.style] ?? [];
  for (const depth of DEPTHS) {
    const layer = p.layers[depth >> 3];
    if (layer) ctx.drawImage(layer, 0, 0);
    for (const fx of life) {
      if (fx.depth !== depth) continue;
      if (!p.made.has(fx)) p.made.set(fx, fx.make?.(wp, p));
      fx.draw(ctx, world, wp, p, p.made.get(fx));
      ctx.globalAlpha = 1;
    }
  }
};
