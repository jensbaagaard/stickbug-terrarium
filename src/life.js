// The tank's ambient life: the breeze that moves everything in the air, fireflies drifting over the plants and
// blinking until they blink as one, bubbles rising off whatever grows under water, dust adrift in the air, and
// ripples on the water. Pure data + functions, like the rest of the simulation. None of it is saved: it comes
// back on its own.
import { hash } from './geom.js';
import { CELL, cellAt, EMPTY, WATER } from './terrain.js';
import { params } from './tuning.js';

const GUST_EVERY = 2400; // ticks: one gust somewhere in each stretch this long
const GUST_SPEED = 1.2; // px a tick a gust rolls across the tank
const GUST_WIDTH = 140; // px across a gust's front
const SYNC_REACH = 120; // px: a flash pulls on the clocks of fireflies this near
const FIREFLY_SPEED = 0.25; // px a tick at the most: a lazy drift
const MAX_BUBBLES = 40;
const BUBBLE_TICKS = 15;
const MOTES = 10;
const SNOWFLAKES = 45; // with the snowy wallpaper up, the dust is snow
const SNOW_SPEED = 0.2; // px a tick a snowflake falls
export const RIPPLE_TICKS = 40;

// How hard the breeze blows at x now, + to the right: a lazy swell back and forth, within about 0.4 either way, and
// now and then a gust of up to 2 that rolls across the tank from one side, leaning everything over as it passes. A
// function of the time alone, so the sim and the drawing agree on it without keeping any of it.
export const wind = (world, x) => {
  const t = world.time;
  const swell = 0.25 * Math.sin(t * 0.011 + x * 0.015) + 0.15 * Math.sin(t * 0.029 - x * 0.04);
  const n = Math.floor(t / GUST_EVERY);
  const dir = hash(n, 1) < 0.5 ? -1 : 1;
  const start = n * GUST_EVERY + hash(n, 2) * (GUST_EVERY - 600); // early enough in its stretch to finish in it
  const from = dir > 0 ? x : world.W - x; // px in from the side it comes from
  const u = ((t - start) * GUST_SPEED - from) / GUST_WIDTH; // 0..1 across the gust
  const gust = u > 0 && u < 1 ? Math.sin(Math.PI * u) ** 2 * (1.2 + 0.8 * hash(n, 3)) : 0;
  return (swell + dir * gust) * params.breeze;
};

const cellOf = (world, x, y) => world.terrain.cells[cellAt(world.terrain, x, y)];
const open = (world, x, y) => y < world.ground.y0 - 1 && cellOf(world, x, y) === EMPTY; // air: no terrain, no water

// How much of the tank's open space is air rather than water, 0..1, worked out afresh when the terrain changes.
const airs = new WeakMap();
const airShare = (world) => {
  const ter = world.terrain;
  const known = airs.get(ter);
  if (known?.version === ter.version) return known.share;
  let [air, water] = [0, 0];
  for (const m of ter.cells) {
    if (m === EMPTY) air++;
    else if (m === WATER) water++;
  }
  const share = air / (air + water || 1);
  airs.set(ter, { version: ter.version, share });
  return share;
};

// How many of something living in the air the tank has room for, `most` at the most: the greener the tank, the more
// (a starting tank's one plant gets one, eight or more plants, grass patches and vines get them all), and the more of
// it that's air rather than water (full of water, none; nine tenths water, a few).
export const room = (world, most) => {
  const green = world.objects.filter((o) => o.kind === 'plant' || o.kind === 'grass' || o.kind === 'vine').length;
  return Math.round(most * Math.min(1, green / 8) * Math.min(1, airShare(world) / 0.6));
};

const MAX_RIPPLES = 30;

// A ring spreading out along the water's surface, over (x, y) in the water.
export const ripple = (world, x, y) => {
  const ter = world.terrain;
  if (world.ripples.length >= MAX_RIPPLES) return;
  while (cellOf(world, x, y - CELL) === WATER) y -= CELL;
  world.ripples.push({ x, y: ter.top + Math.floor((y - ter.top) / CELL) * CELL, age: 0 });
};

// ---------- fireflies ----------

// Where fireflies hang about: just over the top of a plant or grass, or round the end of a vine.
const homeOf = (o) => {
  if (o.kind === 'plant') return o.stems.reduce((a, st) => (st.tip.y < a.y ? st.tip : a), o.base);
  if (o.kind === 'grass') return { x: o.base.x, y: Math.min(...o.tufts.map((t) => t.y - o.genome.height * t.size)) };
  if (o.kind === 'vine') return o.nodes.at(-1);
  return null;
};

// Somewhere new to drift over to, within its wander of the plant it keeps to, and how long till it changes its mind.
const roam = (world, f) => {
  const [r, reach] = [world.lifeRand, params.fireflyWander];
  f.home = { x: f.plant.x + (r() - 0.5) * 2 * reach, y: f.plant.y - 6 - r() * reach };
  f.roam = 180 + r() * 300;
};

// Each rises out of its plant and roams about over it.
const spawnFirefly = (world, at) => {
  const r = world.lifeRand;
  const f = {
    x: at.x,
    y: at.y + 4,
    vx: 0,
    vy: -0.1,
    plant: at,
    clock: r(),
    pace: 1 + (r() - 0.5) * 0.04, // its clock runs a touch fast or slow
    age: 0,
    life: 3600 + r() * 7200,
  };
  roam(world, f);
  world.fireflies.push(f);
};

// They drift lazily from spot to spot over the plant they came from, keeping out of the terrain and the water, each
// blinking on its own clock, and every flash nudges the clocks of those near it on a little: soon they flash together.
const stepFireflies = (world) => {
  const list = world.fireflies;
  if (world.time % 60 === 0 && world.lifeRand() < 0.25) {
    const places = world.objects.map(homeOf).filter((p) => p && open(world, p.x, p.y - 6));
    if (list.length < room(world, params.fireflies) && places.length) {
      spawnFirefly(world, places[Math.floor(world.lifeRand() * places.length)]);
    }
  }
  const flashed = [];
  for (const f of list) {
    f.age++;
    if (--f.roam <= 0) roam(world, f);
    f.vx = (f.vx + (world.lifeRand() - 0.5) * 0.03 + (f.home.x - f.x) * 0.0004 + wind(world, f.x) * 0.002) * 0.97;
    f.vy = (f.vy + (world.lifeRand() - 0.5) * 0.03 + (f.home.y - f.y) * 0.0004) * 0.97;
    const speed = Math.hypot(f.vx, f.vy);
    if (speed > FIREFLY_SPEED) [f.vx, f.vy] = [(f.vx * FIREFLY_SPEED) / speed, (f.vy * FIREFLY_SPEED) / speed];
    if (open(world, f.x + f.vx, f.y + f.vy)) {
      f.x += f.vx;
      f.y += f.vy;
    } else if (open(world, f.x, f.y)) {
      [f.vx, f.vy] = [-f.vx, -Math.abs(f.vy)]; // bounce off, and up
    } else {
      f.y -= 1; // buried or flooded where it was: up and out
    }
    f.x = Math.min(Math.max(f.x, 2), world.W - 3);
    f.y = Math.max(f.y, 2);
    f.clock += f.pace / params.fireflyBlink;
    if (f.clock >= 1) {
      f.clock -= 1;
      flashed.push(f);
    }
  }
  for (const a of flashed) {
    for (const b of list) {
      if (b === a || b.clock < params.fireflyFlash || Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > SYNC_REACH) continue;
      b.clock = Math.min(1, b.clock * (1 + params.fireflySync));
    }
  }
  world.fireflies = list.filter((f) => f.age < f.life);
};

// ---------- bubbles ----------

// Everything growing under water gives off a bubble now and then, which wobbles up faster and faster and pops at
// the surface.
const stepBubbles = (world) => {
  if (world.time % BUBBLE_TICKS === 0) {
    const r = world.lifeRand;
    const puff = (p) => {
      if (world.bubbles.length >= MAX_BUBBLES || r() >= params.bubbleRate || cellOf(world, p.x, p.y) !== WATER) return;
      const vy = -(0.2 + 0.2 * r()) * params.bubbleSpeed;
      world.bubbles.push({ x: p.x, y: p.y - 1, vy, seed: r() * 6, big: r() < params.bigBubbles });
    };
    for (const o of world.objects) {
      if (o.kind === 'plant') {
        // A clump plant's leaves are many short stems: every third one, so a tussock doesn't fizz.
        for (const st of o.stems) if (!o.species.form || st.depth % 3 === 2) puff(st.tip);
      } else if (o.kind === 'vine') for (let i = 2; i < o.nodes.length; i += 2) puff(o.nodes[i]);
      else if (o.kind === 'grass') for (const t of o.tufts) if (t.wet) puff({ x: t.x, y: t.y - 2 });
    }
  }
  world.bubbles = world.bubbles.filter((b) => {
    b.vy = Math.max(b.vy - params.bubbleSpeed * 0.008, -params.bubbleSpeed);
    b.x += Math.sin(world.time * 0.15 + b.seed) * 0.12;
    b.y += b.vy;
    const here = cellOf(world, b.x, b.y);
    if (here === WATER) return true;
    if (here === EMPTY && b.big) ripple(world, b.x, b.y + CELL); // out at the surface: pop
    return false;
  });
};

// ---------- dust ----------

// A few specks of dust adrift in the air, wandering on the breeze. One that settles into the terrain or the water
// is gone, and another is somewhere else. Under a snowy sky (the winter wallpaper) they're snowflakes instead,
// more of them, drifting down from the top and swaying, gone where they land.
export const snowing = (world) => world.wallpaper?.style === 'winter';
const stepMotes = (world) => {
  const snow = snowing(world);
  const somewhere = () => {
    for (let k = 0; k < 5; k++) {
      const x = world.lifeRand() * world.W;
      // Snow comes in at the top, once there's enough of it about to begin with.
      const top = snow && world.motes.length >= SNOWFLAKES / 2;
      const y = world.lifeRand() * (top ? 4 : world.ground.y0);
      if (open(world, x, y)) return { x, y, vx: 0, vy: 0, seed: world.lifeRand() * 6 };
    }
    return null;
  };
  while (world.motes.length < (snow ? SNOWFLAKES : MOTES)) {
    const m = somewhere();
    if (!m) break;
    world.motes.push(m);
  }
  if (!snow && world.motes.length > MOTES) world.motes.length = MOTES;
  world.motes = world.motes.filter((m) => {
    if (snow) {
      m.vx = wind(world, m.x) * 0.15 + Math.sin(world.time * 0.03 + m.seed) * 0.08;
      m.vy = SNOW_SPEED * (0.8 + 0.4 * Math.sin(m.seed * 9));
    } else {
      m.vx = (m.vx + (world.lifeRand() - 0.5) * 0.004 + wind(world, m.x) * 0.0006) * 0.99;
      m.vy = (m.vy + (world.lifeRand() - 0.5) * 0.004) * 0.99;
    }
    m.x += m.vx;
    m.y += m.vy;
    return m.x >= 0 && m.x < world.W && m.y >= 0 && open(world, m.x, m.y);
  });
};

export const stepLife = (world) => {
  stepFireflies(world);
  stepBubbles(world);
  stepMotes(world);
  world.ripples = world.ripples.filter((r) => ++r.age < RIPPLE_TICKS);
};
