// Little things that come and go: crumbs dropped while eating, debris flung by pruning or knocking things down,
// fallen leaves and petals (fluttering down, floating a while, rotting), and the coins earned, with their popups.
// Pure data + functions.
import { params } from './tuning.js';
import { clamp, dist, lerp, segNormal } from './geom.js';
import { CELL } from './terrain.js';
import { ripple, wind } from './life.js';
import { floorBelow } from './surfaces.js';
import { wetAt } from './objects.js';

const MAX_CRUMBS = 200;
const MAX_DEBRIS = 80;
export const MAX_LITTER = 60; // fallen leaves and petals
const LITTER_ROT = 1 / 3600; // how fast a fallen leaf lying on the ground browns and curls up, per tick
const PETAL_ROT = 4; // times as fast as a leaf, a fallen petal shrivels
const FLOAT_TICKS = 600; // a leaf fallen on the water floats this long before it sinks

// A few leaf crumbs fall from the mouth at the bottom of each chew.
export const dropCrumbs = (world, bug) => {
  const t = bug.t;
  const n = segNormal(bug.surf);
  const drop = (t.headDown + t.chewBop) * t.size;
  const count = Math.floor(t.crumbs * (0.5 + world.rand()) + 0.5);
  for (let i = 0; i < count && world.crumbs.length < MAX_CRUMBS; i++) {
    world.crumbs.push({
      x: bug.pts[0].x - n.x * drop,
      y: bug.pts[0].y - n.y * drop,
      vx: (world.rand() - 0.5) * 0.5,
      vy: -0.15 - world.rand() * 0.25,
      life: 150,
      landed: false,
      shade: world.rand() < 0.5 ? 0 : 1,
      seed: world.rand() * 6,
    });
  }
};

// Crumbs flutter down, settle on the first flat surface below them, and soon vanish.
export const stepCrumbs = (world) => {
  world.crumbs = world.crumbs.filter((c) => {
    c.life--;
    if (!c.landed) {
      const y0 = c.y;
      c.vy = Math.min(c.vy + 0.03, wetAt(world.terrain, c) ? 0.12 : 0.6); // they sink slowly in water
      c.x += c.vx + 0.15 * Math.sin(world.time * 0.2 + c.seed);
      c.y += c.vy;
      c.vx *= 0.97;
      const floor = floorBelow(world, c.x, y0).y;
      if (c.y >= floor - 1) {
        c.y = floor - 1;
        c.landed = true;
        c.life = Math.min(c.life, 45);
      }
    }
    return c.life > 0 && c.x >= 0 && c.x < world.W;
  });
};

// Pruned or knocked-down pieces tumble to the floor and lie there a moment. look says how to draw them.
export const fling = (world, a, b, look) => {
  if (world.debris.length >= MAX_DEBRIS || dist(a, b) < 1) return;
  world.debris.push({
    c: lerp(a, b, 0.5),
    h: { x: (b.x - a.x) / 2, y: (b.y - a.y) / 2 },
    vx: (world.rand() - 0.5) * 0.6,
    vy: -world.rand() * 0.5,
    spin: (world.rand() - 0.5) * 0.1,
    look,
    life: 240,
    landed: false,
  });
};

export const stepDebris = (world) => {
  world.debris = world.debris.filter((p) => {
    if (!p.landed) {
      const low0 = p.c.y + Math.abs(p.h.y);
      p.vy = Math.min(p.vy + params.gravity * 0.5, 3);
      p.c = { x: p.c.x + p.vx, y: p.c.y + p.vy };
      const [cs, sn] = [Math.cos(p.spin), Math.sin(p.spin)];
      p.h = { x: p.h.x * cs - p.h.y * sn, y: p.h.x * sn + p.h.y * cs };
      const floor = floorBelow(world, p.c.x, low0).y - 1;
      const low = p.c.y + Math.abs(p.h.y);
      if (low >= floor) {
        p.c.y -= low - floor;
        p.landed = true;
        p.life = Math.min(p.life, 150);
      }
    }
    return --p.life > 0;
  });
};

// Fallen leaves and petals flutter down, rocking side to side and blown along by the breeze. On the ground they lie,
// brown, curl up and are gone in a minute (a petal in 15 s); on the water they float a while, then sink, and fish
// nibble at them.
export const stepLitter = (world) => {
  const ter = world.terrain;
  world.litter = world.litter.filter((it) => {
    const y0 = it.y;
    if (it.state === 'fall') {
      it.phase += 0.05;
      it.x = clamp(it.x + Math.cos(it.phase) * 0.35 + wind(world, it.x) * 0.3, 1, world.W - 2);
      it.y += 0.06 + 0.3 * Math.cos(it.phase) ** 2; // quickest at the bottom of each swing
      if (wetAt(ter, { x: it.x, y: it.y - CELL })) {
        it.state = 'sink'; // dropped under water
      } else if (wetAt(ter, it)) {
        it.y = ter.top + Math.floor((it.y - ter.top) / CELL) * CELL - 0.5; // on the surface
        Object.assign(it, { state: 'float', float: FLOAT_TICKS });
        ripple(world, it.x, it.y + 1);
      }
    } else if (it.state === 'float') {
      it.x = clamp(it.x + wind(world, it.x) * 0.05 + Math.sin(world.time * 0.02 + it.phase) * 0.03, 1, world.W - 2);
      if (!wetAt(ter, { x: it.x, y: it.y + 1 })) it.state = 'fall'; // drifted off the edge of the water, or it drained
      else if (--it.float <= 0) it.state = 'sink';
    } else if (it.state === 'sink') {
      it.phase += 0.03;
      it.x = clamp(it.x + Math.cos(it.phase) * 0.08, 1, world.W - 2);
      it.y += 0.05;
    } else {
      it.rot += LITTER_ROT * (it.look.petal ? PETAL_ROT : 1);
    }
    // Falling or sinking it lands on the floor; lying, it falls again if the floor goes from under it.
    if (it.state !== 'float' && (it.state !== 'lie' || world.time % 10 === 0)) {
      const floor = floorBelow(world, it.x, Math.min(y0, it.y) - 1).y - 1;
      if (it.y >= floor) Object.assign(it, { y: floor, state: 'lie' });
      else if (it.state === 'lie') it.state = 'fall';
    }
    return it.life > 0 && it.rot < 1;
  });
};

export const earn = (world, n, x, y) => {
  world.coins += n;
  world.popups.push({ x, y, text: `+${n}`, life: 70 });
};
