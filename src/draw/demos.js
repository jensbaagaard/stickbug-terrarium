// The tools' how-to animations, played once when a tool is picked: a ghost pointer showing how it's used; and, while
// something bought waits to go in, the pointer bringing it in from below.
import { hash, lerp, smoothstep } from '../geom.js';
import { previewAt } from '../sim.js';
import { CELL, MATERIALS } from '../terrain.js';
import { CUT, drawBrush, drawPreview, dropArrow, POINTER, READY, READY_GREEN } from './marks.js';
import { COIN, GLYPHS, plot, sprite } from './pixelart.js';
import { MATERIAL_COLORS } from './terrain.js';

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
export const drawDemo = (ctx, world) => {
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
export const drawPlaceDemo = (ctx, world) => {
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
