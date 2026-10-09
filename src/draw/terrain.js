// Drawing the terrain: each material's colours and texture (wood grain, sandstone and ice shading), the solids and the
// water drawn into images that are redrawn only when the cells change, the editor's swatches, and light on the water:
// glints along the surface, bubbles and rings.
import { hash, hslHex } from '../geom.js';
import { RIPPLE_TICKS } from '../life.js';
import {
  BASALT,
  BROWNSTONE,
  CELL,
  DIRT,
  EMPTY,
  FOUNTAIN,
  ICE,
  makeTerrain,
  SAND,
  SANDSTONE,
  SNOW,
  STONE,
  WATER,
  WOOD,
} from '../terrain.js';
import { imageLayer, pixel } from './pixels.js';

// Each material is one colour with just a hint of grain: three shades a couple of percent apart, and each
// grain keeps its own shade as it moves. Wood and sandstone (and brownstone, a darker sandstone) never move, so their
// shade comes from where they are instead: wavy grain lines in wood, soft layers in sandstone.
const shades = (h, s, l, [a, b] = [-2, 2]) => [l, l + a, l + b].map((v) => hslHex(h, s, v));
export const MATERIAL_COLORS = {
  [STONE]: shades(240, 3, 44),
  [BASALT]: shades(225, 8, 30, [-3, 3]),
  [DIRT]: shades(28, 40, 25),
  [SAND]: shades(44, 52, 70),
  [WATER]: shades(212, 60, 47),
  [FOUNTAIN]: shades(186, 38, 56),
  // Plain, grain line, light streak, dim streak: all within a few percent, so the grain is felt more than seen.
  [WOOD]: [0, -3, 1, -1].map((d) => hslHex(28, 26, 36 + d)),
  [SANDSTONE]: shades(33, 48, 56, [-4, 3]),
  [BROWNSTONE]: shades(18, 40, 41, [-4, 3]),
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

// Each terrain's drawing caches: its layers, its wood grain and its water's surface.
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

export const drawTerrain = (ctx, world, water) => {
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
export const drawWater = (ctx, world) => {
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
