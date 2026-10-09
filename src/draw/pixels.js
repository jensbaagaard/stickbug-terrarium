// Drawing straight into image data, which is far quicker than a canvas call for every few px: whole opaque colours as
// pixels, images to write them into, and a stand-in for the canvas for the passes of the drawing that are nothing but
// opaque fills of whole px (the plants, sticks, vines and bugs).
import { rgb } from '../geom.js';

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const pixelCache = new Map();

// A #rrggbb colour as a whole opaque pixel, to write straight into image data.
export const pixel = (hex) => {
  let v = pixelCache.get(hex);
  if (v === undefined) {
    const [r, g, b] = rgb(hex);
    v = (LITTLE_ENDIAN ? (255 << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
    pixelCache.set(hex, v);
  }
  return v;
};

// An image to write pixels into (whole colours from pixel), then draw onto the tank.
export const imageLayer = (w, h) => {
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(w, h);
  return { canvas, ctx, image, pixels: new Uint32Array(image.data.buffer) };
};

// A stand-in for a W by H canvas that knows only fillStyle (#rrggbb) and fillRect: the rects are filled into an
// image, and flush puts all of it onto the real canvas at once (and clears it for the next pass). What's drawn there
// lands exactly as it would have drawn straight onto the canvas, so long as it's all opaque.
const layers = new Map(); // by size, kept from frame to frame
export const pixelLayer = (W, H) => {
  const key = `${W}x${H}`;
  if (!layers.has(key)) layers.set(key, makePixelLayer(W, H));
  return layers.get(key);
};

const makePixelLayer = (W, H) => {
  const { canvas, ctx, image, pixels } = imageLayer(W, H);
  let color = 0;
  let [x0, y0, x1, y1] = [W, H, 0, 0]; // what's been drawn in since the last flush
  return {
    set fillStyle(hex) {
      color = pixel(hex);
    },
    fillRect(x, y, w, h) {
      // As the canvas does: a negative size goes the other way. Then clipped to the image.
      let l = Math.round(w < 0 ? x + w : x);
      let t = Math.round(h < 0 ? y + h : y);
      let r = Math.round(w < 0 ? x : x + w);
      let b = Math.round(h < 0 ? y : y + h);
      if (l < 0) l = 0;
      if (t < 0) t = 0;
      if (r > W) r = W;
      if (b > H) b = H;
      if (l >= r || t >= b) return;
      if (r - l === 1) for (let row = t; row < b; row++) pixels[row * W + l] = color;
      else for (let row = t; row < b; row++) pixels.fill(color, row * W + l, row * W + r);
      if (l < x0) x0 = l;
      if (t < y0) y0 = t;
      if (r > x1) x1 = r;
      if (b > y1) y1 = b;
    },
    flush(onto) {
      if (x0 >= x1) return;
      const [w, h] = [x1 - x0, y1 - y0];
      ctx.putImageData(image, 0, 0, x0, y0, w, h);
      onto.drawImage(canvas, x0, y0, w, h, x0, y0, w, h);
      for (let row = y0; row < y1; row++) pixels.fill(0, row * W + x0, row * W + x1);
      [x0, y0, x1, y1] = [W, H, 0, 0];
    },
  };
};
