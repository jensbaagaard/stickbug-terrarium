// Pixel-art canvas rendering of the whole tank, back to front (drawWorld): the wallpaper and the floor, plants and
// sticks, the terrain, grass and vines, the biome's goings-on on the ground, the marks and previews, bugs and fallen
// leaves, the water, fish, fliers and visitors, crumbs and debris, the marks under the pointer, coin popups, the air
// and the tools' how-tos. How each is drawn lives in draw/.
import { stickWidth } from './sticks.js';
import { add } from './geom.js';
import { aimAt, previewAt, relocationAt } from './sim.js';
import { CELL } from './terrain.js';
import { drawGoingsInAir, drawGoingsOnGround } from './draw/biomes.js';
import { drawBug } from './draw/bugs.js';
import { drawDemo, drawPlaceDemo } from './draw/demos.js';
import { drawFish } from './draw/fish.js';
import { drawFlier } from './draw/fliers.js';
import { drawAir, drawAphids, drawVisitors } from './draw/life.js';
import { CUT, drawAim, drawBrush, drawPreview, drawReady, drawRelocation } from './draw/marks.js';
import { COIN, GLYPHS, line, plot, sprite } from './draw/pixelart.js';
import { pixelLayer } from './draw/pixels.js';
import {
  debrisColor,
  drawBranch,
  drawGrass,
  drawLeaf,
  drawLitter,
  drawPlant,
  drawVine,
  woodColors,
} from './draw/plants.js';
import { drawTerrain, drawWater } from './draw/terrain.js';
import { drawWallpaper } from './draw/wallpaper.js';

export { drawSwatch, MATERIAL_COLORS } from './draw/terrain.js';

const CRUMB_COLORS = ['#3f8f4f', '#7fbf5a']; // bits of leaf dropped while eating
const FLAKE_COLORS = ['#d9583b', '#e9a23b', '#e8d36a', '#8fbf5a']; // fish food

export const drawWorld = (ctx, world) => {
  const floor = world.ground.y0;
  drawWallpaper(ctx, world);
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(0, floor, world.W, world.H - floor);
  ctx.fillStyle = '#9c7448';
  ctx.fillRect(0, floor, world.W, 1);

  // The plants, sticks, vines and bugs are only opaque fills of whole px, so they're drawn into px, a pass at a time,
  // and each pass put onto the tank in one go.
  const px = pixelLayer(world.W, world.H);
  for (const obj of world.objects) if (obj.kind === 'plant') drawPlant(px, obj);
  drawAphids(px, world);
  const sticks = world.branches.filter((g) => g.kind === 'stick');
  for (const g of sticks) {
    drawBranch(px, g, woodColors(g.obj.wood), stickWidth(g.obj.style, g.depth), g.obj.foliage, g.obj.style);
  }
  for (const g of sticks) for (const leaf of g.leaves) drawLeaf(px, g, leaf, g.obj.foliage);
  px.flush(ctx);
  drawTerrain(ctx, world, false);
  drawGrass(ctx, world, world.objects.filter((obj) => obj.kind === 'grass'));
  for (const obj of world.objects) if (obj.kind === 'vine') drawVine(px, obj);
  px.flush(ctx);
  drawGoingsOnGround(ctx, world);
  if (world.tool === 'propagate') drawReady(ctx, world);

  const move = relocationAt(world);
  if (move) drawRelocation(ctx, world, move);
  if (world.placing && !world.hover) drawPlaceDemo(ctx, world);
  const preview = world.hover && previewAt(world);
  if (preview) drawPreview(ctx, world, preview);

  for (const bug of world.bugs) drawBug(px, world, bug);
  drawLitter(px, world);
  px.flush(ctx);
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
  drawGoingsInAir(ctx, world);

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
