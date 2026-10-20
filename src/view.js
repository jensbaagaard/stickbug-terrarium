// The tank's zoom, like Dust 2's SCALE: the world magnified a whole number of times (one of ZOOMS), so its pixels stay
// square, and the view moved anywhere inside it. A view is { z, x, y }: z times magnified, with world point (x, y) at
// its top left. Pure maths; Terrarium.jsx shows a view as a CSS transform on the canvas.
import { clamp } from './geom.js';

export const ZOOMS = [1, 2, 4, 8];

export const UNZOOMED = { z: 1, x: 0, y: 0 };

// The view kept inside a W by H world.
export const clampView = ({ z, x, y }, W, H) => ({ z, x: clamp(x, 0, W - W / z), y: clamp(y, 0, H - H / z) });

// The next zoom in (dir 1) or out (dir -1) from z, or z itself at the end.
export const nextZoom = (z, dir) => ZOOMS[clamp(ZOOMS.indexOf(z) + dir, 0, ZOOMS.length - 1)];

// Zoomed to z about world point (px, py), which stays where it was on screen.
export const zoomAbout = (view, z, px, py, W, H) =>
  clampView({ z, x: px - ((px - view.x) * view.z) / z, y: py - ((py - view.y) * view.z) / z }, W, H);

// Zoomed to z about the middle of what's in view.
export const zoomMiddle = (view, z, W, H) =>
  zoomAbout(view, z, view.x + W / view.z / 2, view.y + H / view.z / 2, W, H);

// Moved by (dx, dy) world px.
export const panBy = (view, dx, dy, W, H) => clampView({ ...view, x: view.x + dx, y: view.y + dy }, W, H);
