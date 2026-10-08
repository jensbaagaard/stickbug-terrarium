import { useLayoutEffect, useRef } from 'react';
import {
  TANK_SIZES,
  aimAt,
  createWorld,
  previewAt,
  step,
  pointerDown,
  pointerMove,
  pointerUp,
  pointerCancel,
} from './sim.js';
import { drawWorld } from './render.js';
import { SCISSORS_CURSOR } from './icons.js';

// The tank is one of a few sizes in world pixels (TANK_SIZES; size picks which to start with, and the world
// swapped in later may be another), shown a whole number of screen pixels to each so they all come out the same
// size: the most that fits, up to MAX_SCALE css px to a world pixel and HEIGHT_SHARE of the window's height (leaving
// room for the panel). Resizing the window leaves it be until it no longer fits, or the next size up does.
const MAX_SCALE = 2;
const HEIGHT_SHARE = 0.7;
const GUTTER = 38; // css px beside the tank: the page's padding and the tank's frame
const TICK_MS = 1000 / 60;

// The cursor says what a press would do there.
const AIM_CURSORS = { bug: 'grab', fish: 'grab', cut: SCISSORS_CURSOR, lift: 'grab', pick: 'pointer', drop: 'copy' };
const cursorOf = (world) => {
  if (world.held || world.pull || (world.moving && world.tool === 'move')) return 'grabbing';
  if (world.tool === 'paint') return 'crosshair';
  if (world.placing) return previewAt(world) ? 'copy' : 'not-allowed';
  const aim = aimAt(world);
  if (world.tool === 'hand' && aim?.hit && !aim.hit.seg) return 'grab'; // a plant to pull about; a tap still cuts it
  return aim ? AIM_CURSORS[aim.kind] : world.tool === 'prune' ? 'crosshair' : 'default';
};

// The world lives in worldRef, and everything here reads it from there, so the parent can swap in another world,
// a loaded save say, at any time.
export default function Terrarium({ worldRef: ref, size = 'small' }) {
  const canvasRef = useRef(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    ref.current = createWorld(...TANK_SIZES[size]);

    // The canvas matches the world, and the page's column is as wide as the tank, so the panel under it lines up.
    const fit = () => {
      const { W, H } = ref.current;
      [canvas.width, canvas.height] = [W, H];
      const dpr = window.devicePixelRatio || 1;
      const across = document.documentElement.clientWidth - GUTTER;
      const room = Math.min(W * MAX_SCALE, across, (innerHeight * HEIGHT_SHARE * W) / H);
      // Whole screen pixels to a world pixel, unless that's just the one with room for half as much again (on a
      // low-resolution screen, a big tank): then as many as fit, pixels a little uneven rather than a tank too small.
      const fits = (room * dpr) / W;
      const k = fits >= 1.5 && fits < 2 ? fits : Math.max(1, Math.floor(fits));
      const [w, h] = [(W * k) / dpr, (H * k) / dpr];
      Object.assign(canvas.style, { width: `${w}px`, height: `${h}px` });
      document.documentElement.style.setProperty('--tank-width', `${w}px`);
    };
    fit();

    const toWorld = (world, e) => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * world.W, ((e.clientY - r.top) / r.height) * world.H];
    };
    const abort = new AbortController();
    const on = (type, fn) =>
      canvas.addEventListener(
        type,
        (e) => {
          const world = ref.current;
          if (!world) return;
          fn(world, e);
          canvas.style.cursor = cursorOf(world);
        },
        { signal: abort.signal },
      );
    on('pointerdown', (world, e) => {
      world.hover = true;
      pointerDown(world, ...toWorld(world, e));
      canvas.setPointerCapture(e.pointerId);
    });
    on('pointermove', (world, e) => {
      world.hover = true;
      pointerMove(world, ...toWorld(world, e));
    });
    on('pointerup', (world, e) => pointerUp(world, ...toWorld(world, e)));
    on('pointercancel', (world) => pointerCancel(world));
    on('pointerleave', (world) => (world.hover = false));
    window.addEventListener('resize', fit, { signal: abort.signal }); // also fires when the zoom or screen changes

    // Fixed-timestep loop, capped so a backgrounded tab doesn't fast-forward.
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    const frame = (now) => {
      acc = Math.min(acc + now - last, 100);
      last = now;
      const world = ref.current;
      if (world.W !== canvas.width || world.H !== canvas.height) fit(); // a tank of another size swapped in
      while (acc >= TICK_MS) {
        step(world);
        acc -= TICK_MS;
      }
      drawWorld(ctx, world);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      abort.abort();
      ref.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        touchAction: 'none',
        imageRendering: 'pixelated',
      }}
    />
  );
}
