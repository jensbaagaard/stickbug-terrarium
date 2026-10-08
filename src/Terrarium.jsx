import { useLayoutEffect, useRef } from 'react';
import {
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

// The tank is always this many world pixels, shown a whole number of screen pixels to each so they all come out
// the same size: the most that fits, up to MAX_WIDTH css px wide and HEIGHT_SHARE of the window's height (leaving
// room for the panel). Resizing the window leaves it be until it no longer fits, or the next size up does.
const W = 256;
const H = 341;
const MAX_WIDTH = 512;
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
export default function Terrarium({ worldRef: ref }) {
  const canvasRef = useRef(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    ref.current = createWorld(W, H);

    // The page's column is as wide as the tank, so the panel under it lines up.
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const across = document.documentElement.clientWidth - GUTTER;
      const room = Math.min(MAX_WIDTH, across, (innerHeight * HEIGHT_SHARE * W) / H);
      const k = Math.max(1, Math.floor((room * dpr) / W));
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
      width={W}
      height={H}
      style={{
        display: 'block',
        touchAction: 'none',
        imageRendering: 'pixelated',
      }}
    />
  );
}
