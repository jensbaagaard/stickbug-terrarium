// Drawing the biomes' goings-on (see biomes.js): the ones on the ground (tumbleweeds, dust devils, mushrooms) just over
// the terrain, so the bugs walk in front of them; the rest (embers, steam, drips, wisps, rain, seed fluff, jellyfish)
// over everything else in the tank.
import { clamp, hash, hslHex } from './geom.js';
import { strength } from './biomes.js';
import { wind } from './life.js';

const TWIGS = ['#8a6a3e', '#a8854f', '#6e5230'];
const DUST = ['#c9a86a', '#b8935a', '#dcc08a'];
const CAPS = {
  agaric: ['#c8382c', '#f0e6d2'], // a red cap with white spots
  brown: ['#8a5a36', '#c9a77c'],
  pale: ['#d9cbb0', '#f2ead8'],
  glow: ['#7fe0d0', '#c8fff4'],
};
const STALK = '#e6dac2';
const EMBER = ['#ffd27a', '#ff9a3c', '#d8432a'];
const STEAM = '#dfe6ea';
const WATER_DROP = '#9cc8e8';
const RAIN = '#a9c8e6';
const WISP = '#b8ffe6';
const FLUFF = '#f4f1e8';
const SEED = '#8a7a5a';

const dot = (ctx, x, y) => ctx.fillRect(Math.round(x), Math.round(y), 1, 1);

// A ball of tangled twigs turning as it rolls: twigs from one side of it across to another, turning with it.
const drawTumbleweed = (ctx, h) => {
  for (let k = 0; k < 9; k++) {
    const a = h.spin + k * 2.4 + hash(h.seed, k) * 2;
    const b = a + 1.4 + hash(h.seed, k, 1) * 1.6;
    const [r0, r1] = [h.size * (0.6 + 0.4 * hash(h.seed, k, 2)), h.size * (0.5 + 0.5 * hash(h.seed, k, 3))];
    const [x0, y0, x1, y1] = [Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(b) * r1, Math.sin(b) * r1];
    ctx.fillStyle = TWIGS[k % TWIGS.length];
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= n; i++) dot(ctx, h.x + x0 + ((x1 - x0) * i) / n, h.y + y0 + ((y1 - y0) * i) / n);
  }
};

// A whirl of dust: grains going round a column, the circles widening and the spin slowing toward the top, which
// leans with the breeze; coming up out of the ground, and dying away.
const drawDustDevil = (ctx, world, h) => {
  const k = strength(h, 120, 180);
  const lean = wind(world, h.x) * 0.15;
  for (let i = 0; i < 46; i++) {
    const v = hash(h.seed, i, 1); // how far up
    const a = world.time * (0.12 + 0.05 * hash(h.seed, i, 2)) * (1.5 - v) + i * 2.1;
    const x = h.x + Math.cos(a) * (1.5 + v * v * 9) + v * h.height * lean;
    ctx.globalAlpha = k * (0.25 + 0.5 * (1 - v)) * (0.6 + 0.4 * Math.sin(a)); // brighter going round the front
    ctx.fillStyle = DUST[i % DUST.length];
    dot(ctx, x, h.y - 1 - v * h.height);
  }
};

// Mushrooms coming up one after another, standing, then shrinking away: a pale stalk and a domed cap, spotted on a
// fly agaric, and glowing on the glowing kind.
const drawMushrooms = (ctx, h) => {
  const [cap, spot] = CAPS[h.look];
  for (const c of h.caps) {
    const grown = clamp((h.age - c.delay) / 300, 0, 1) * clamp((h.life - h.age) / 400, 0, 1);
    if (grown <= 0) continue;
    const s = c.size * grown;
    const stalk = Math.max(1, Math.round(s * 1.3));
    ctx.fillStyle = STALK;
    ctx.fillRect(c.x, c.y - stalk, 1, stalk);
    const [w, tall] = [s * 1.4, Math.max(1, s * 0.8)];
    if (h.look === 'glow') {
      ctx.globalAlpha = 0.25 * grown;
      ctx.fillStyle = spot;
      const [left, top] = [Math.round(c.x - w - 1), Math.round(c.y - stalk - tall - 1)];
      ctx.fillRect(left, top, Math.round(w * 2 + 3), Math.round(tall + 3));
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = cap;
    for (let dy = 0; dy < tall; dy++) {
      const half = Math.max(0.5, w * Math.sqrt(1 - (dy / tall) ** 2));
      ctx.fillRect(Math.round(c.x - half + 0.5), c.y - stalk - 1 - dy, Math.max(1, Math.round(half * 2)), 1);
    }
    if (h.look === 'agaric' && s > 2) {
      ctx.fillStyle = spot;
      dot(ctx, c.x - 1, c.y - stalk - 2);
      dot(ctx, c.x + 1, c.y - stalk - 1 - Math.round(tall * 0.6));
    }
  }
};

// A spark: yellow, then orange, then red as it cools, fading.
const drawEmber = (ctx, h) => {
  const u = h.age / h.life;
  ctx.globalAlpha = Math.sqrt(1 - u);
  ctx.fillStyle = EMBER[Math.min(EMBER.length - 1, Math.floor(u * 3.3))];
  dot(ctx, h.x, h.y);
};

// A puff of steam: a speckled ball, swelling and thinning as it rises.
const drawSteam = (ctx, h) => {
  const u = h.age / h.life;
  const r = 1 + u * 4;
  ctx.globalAlpha = (1 - u) * 0.5 * Math.min(1, h.age / 20);
  ctx.fillStyle = STEAM;
  for (let dy = -Math.ceil(r); dy <= r; dy++) {
    for (let dx = -Math.ceil(r); dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r && hash(h.seed + dx, dy, h.age >> 3) < 0.55) dot(ctx, h.x + dx, h.y + dy);
    }
  }
};

// A drop: gathering under the rock, falling (drawn out a little), then splashing in two specks.
const drawDrip = (ctx, h) => {
  ctx.fillStyle = WATER_DROP;
  if (h.state === 'gather') {
    ctx.globalAlpha = 0.3 + 0.7 * (h.age / h.life);
    dot(ctx, h.x, h.y);
  } else if (h.state === 'fall') {
    ctx.globalAlpha = 0.85;
    ctx.fillRect(Math.round(h.x), Math.round(h.y) - 1, 1, h.vy > 1.5 ? 2 : 1);
  } else {
    ctx.globalAlpha = 1 - h.splash / 14;
    const [d, up] = [1 + h.splash * 0.25, h.splash * (0.5 - h.splash * 0.05)];
    dot(ctx, h.x - d, h.y - up);
    dot(ctx, h.x + d, h.y - up);
  }
};

// A will-o'-the-wisp: a soft glow round a bright point, flickering, fading in and out.
const drawWisp = (ctx, world, h) => {
  const k = strength(h, 120, 240) * (0.7 + 0.3 * Math.sin(world.time * 0.2 + h.seed));
  const [x, y] = [Math.round(h.x), Math.round(h.y)];
  ctx.fillStyle = WISP;
  ctx.globalAlpha = 0.1 * k;
  ctx.fillRect(x - 2, y - 2, 5, 5);
  ctx.globalAlpha = 0.35 * k;
  ctx.fillRect(x - 1, y, 3, 1);
  ctx.fillRect(x, y - 1, 1, 3);
  ctx.globalAlpha = 0.9 * k;
  ctx.fillRect(x, y, 1, 1);
};

// Rain: streaks of drops, and the splashes where they've landed.
const drawRain = (ctx, h) => {
  ctx.fillStyle = RAIN;
  ctx.globalAlpha = 0.55;
  for (const d of h.drops) ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 2);
  for (const p of h.splashes) {
    ctx.globalAlpha = (1 - p.age / 6) * 0.6;
    const up = p.age < 3 ? 1 : 0;
    dot(ctx, p.x - 1, p.y - up);
    dot(ctx, p.x + 1, p.y - up);
  }
};

// Seed fluff: a little white star of hairs with the seed hanging under it.
const drawFluff = (ctx, h) => {
  const k = strength(h, 60, 120);
  ctx.fillStyle = FLUFF;
  ctx.globalAlpha = k;
  dot(ctx, h.x, h.y);
  ctx.globalAlpha = 0.5 * k;
  dot(ctx, h.x - 1, h.y);
  dot(ctx, h.x + 1, h.y);
  dot(ctx, h.x, h.y - 1);
  ctx.fillStyle = SEED;
  ctx.globalAlpha = k;
  dot(ctx, h.x, h.y + 1);
};

// A jellyfish: a see-through dome of a bell, narrower as it beats, and tentacles trailing and waving under it; a
// glowing one with a glow about it.
const drawJellyfish = (ctx, world, h) => {
  const k = strength(h, 90, 120);
  const [x, y] = [Math.round(h.x), Math.round(h.y)];
  const w = h.size + 0.5 - (h.beat > 15 ? 1 : 0);
  if (h.glow) {
    ctx.globalAlpha = 0.15 * k;
    ctx.fillStyle = hslHex(h.hue, 80, 75);
    ctx.fillRect(x - h.size - 2, y - h.size - 2, h.size * 2 + 5, h.size + 10);
  }
  ctx.globalAlpha = 0.35 * k;
  ctx.fillStyle = hslHex(h.hue, 50, 75);
  for (const side of [-1, 0, 1]) {
    for (let j = 1; j < 6 + h.size; j++) {
      dot(ctx, x + side * h.size * 0.6 + Math.sin(world.time * 0.05 + j * 0.6 + side) * 0.8, y + j);
    }
  }
  ctx.globalAlpha = (h.glow ? 0.85 : 0.6) * k;
  ctx.fillStyle = hslHex(h.hue, 60, h.glow ? 78 : 70);
  for (let dy = 0; dy <= h.size; dy++) {
    const half = w * Math.sqrt(1 - (dy / (h.size + 0.5)) ** 2);
    ctx.fillRect(Math.round(x - half), y - dy, Math.max(1, Math.round(half * 2)), 1);
  }
};

export const drawGoingsOnGround = (ctx, world) => {
  for (const h of world.happenings) {
    if (h.kind === 'tumbleweed') drawTumbleweed(ctx, h);
    else if (h.kind === 'dustDevil') drawDustDevil(ctx, world, h);
    else if (h.kind === 'mushrooms') drawMushrooms(ctx, h);
    ctx.globalAlpha = 1;
  }
};

export const drawGoingsInAir = (ctx, world) => {
  for (const h of world.happenings) {
    if (h.kind === 'embers') drawEmber(ctx, h);
    else if (h.kind === 'steam') drawSteam(ctx, h);
    else if (h.kind === 'drips') drawDrip(ctx, h);
    else if (h.kind === 'wisps') drawWisp(ctx, world, h);
    else if (h.kind === 'rain') drawRain(ctx, h);
    else if (h.kind === 'fluff') drawFluff(ctx, h);
    else if (h.kind === 'jellyfish') drawJellyfish(ctx, world, h);
    ctx.globalAlpha = 1;
  }
};
