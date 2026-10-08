// Pictures for the shop: build each offer in a scratch world (plants fully grown and in flower, wallpaper
// hung), draw that world, and crop to the item.
import { createWorld, stageOffer } from './sim.js';
import { drawWorld } from './render.js';

const W = 240;
const H = 320;
const PAPER = 64; // wallpapers are shown hung in a little square tank of their own
let scratch = null;

export const drawThumb = (canvas, offer) => {
  // Sticks in a tank twice as wide, so even a long one leaning out from the middle doesn't meet the glass.
  const size = offer.kind === 'wallpaper' ? [PAPER, PAPER] : offer.kind === 'stick' ? [2 * W, H] : [W, H];
  const world = createWorld(...size, { seed: offer.seed, scene: false });
  const box = stageOffer(world, offer);
  scratch ??= document.createElement('canvas');
  if (scratch.width !== world.W) scratch.width = world.W;
  scratch.height = H;
  drawWorld(scratch.getContext('2d'), world);
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const w = Math.min(world.W, Math.ceil(box.x1)) - x0;
  const h = Math.min(H, Math.ceil(box.y1)) - y0;
  // Square it up so every card shows its item at a sensible size.
  const side = Math.max(w, h, offer.kind === 'fish' ? 60 : 40); // fish in a bigger square, so they look small
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, side, side);
  // Hanging plants hang from a line along the top of their picture, like the ground line everything else
  // stands on at the bottom. Fish swim in the middle.
  const hanging = offer.type === 'vine';
  const top = hanging ? 0 : offer.kind === 'fish' ? Math.floor((side - h) / 2) : side - h;
  ctx.drawImage(scratch, x0, y0, w, h, Math.floor((side - w) / 2), top, w, h);
  if (hanging) {
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(0, 0, side, 1);
    ctx.fillStyle = '#9c7448';
    ctx.fillRect(0, 1, side, 1);
  }
};
