// Drawing the tank's ambient life: fireflies and dust (or snow) in the air, the visitors (dragonflies, bees and gnats)
// and the aphids.
import { hslHex } from '../geom.js';
import { snowing } from '../life.js';
import { params } from '../tuning.js';
import { line } from './pixelart.js';

const MOTE = '#fff3d6';
const SNOWFLAKE = '#eef4ff';
const FIREFLY = '#e2ff7a';

// What's in the air: dust catching the light, brighter higher up, and fireflies, glowing faintly between flashes.
export const drawAir = (ctx, world) => {
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

export const drawVisitors = (ctx, world) => {
  for (const v of world.visitors) {
    if (v.kind === 'dragonfly') drawDragonfly(ctx, world, v);
    else if (v.kind === 'bee') drawBee(ctx, world, v);
    else drawGnats(ctx, world, v);
  }
};

// Aphids: pale green specks along the stems, the grown ones two pixels long.
export const drawAphids = (ctx, world) => {
  for (const a of world.aphids) {
    ctx.fillStyle = a.size < 1 ? '#c8e6a0' : '#94c45c';
    ctx.fillRect(Math.round(a.x), Math.round(a.y), a.size < 1 ? 1 : 2, 1);
  }
};
