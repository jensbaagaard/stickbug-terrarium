// The tank's canvas: sized to a whole number of screen px per tank px (the most that fits), turning pointer events
// into tank coordinates for the tools, and running the world a fixed 60 ticks a second, drawn every frame.
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
// room for the panel). Resizing the window leaves it be until it no longer fits, or the next size up does. A bigger
// tank shows more, not smaller: never narrower than a smaller one would be, even if that means pixels a touch uneven.
// In full screen it fills the screen, pixels a touch uneven or not.
const MAX_SCALE = 2;
const HEIGHT_SHARE = 0.7;
const GUTTER = 38; // css px beside the tank: the page's padding and the tank's frame
// Medium and large tanks may go bigger, up to BIG_SCALE css px to a world pixel, filling the room they have (a
// whole number of screen pixels to each if that nearly fills it); and on a wide enough screen beside the panel
// (PANEL_WIDTH css px, plus GAP), where they can be as tall as the window, if that makes them no smaller.
const BIG_SCALE = 3;
const PANEL_WIDTH = 380; // styles.css --panel-width
const GAP = 14;
const TICK_MS = 1000 / 60;

// The cursor says what a press would do there.
const AIM_CURSORS = {
  bug: 'grab',
  fish: 'grab',
  flier: 'grab',
  cut: SCISSORS_CURSOR,
  lift: 'grab',
  pick: 'pointer',
  drop: 'copy',
};
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
      if (document.fullscreenElement?.contains(canvas)) {
        const w = Math.min(innerWidth, (innerHeight * W) / H);
        Object.assign(canvas.style, { width: `${w}px`, height: `${(w * H) / W}px` });
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const across = document.documentElement.clientWidth - GUTTER;
      // How a tank W by H is shown on its own: css px wide, and whether beside the panel. Small: whole screen pixels
      // to a world pixel, as many as fit. Bigger: as big as fits, under the panel or beside it.
      const [sw, sh] = TANK_SIZES.small;
      const own = (W, H) => {
        const room = Math.min(W * MAX_SCALE, across, (innerHeight * HEIGHT_SHARE * W) / H);
        const crisp = (W * Math.max(1, Math.floor((room * dpr) / W))) / dpr;
        if (W * H <= sw * sh) return { w: crisp, side: false };
        const under = Math.min(W * BIG_SCALE, across, (innerHeight * HEIGHT_SHARE * W) / H);
        const beside = Math.min(W * BIG_SCALE, across - GAP - PANEL_WIDTH, ((innerHeight - GUTTER) * W) / H);
        const side = beside >= under; // beside, the panel stays in view too
        const k = ((side ? beside : under) * dpr) / W; // screen pixels to a world pixel, filling it
        return { w: Math.max(crisp, (W * (Math.floor(k) >= k * 0.92 ? Math.floor(k) : k)) / dpr), side };
      };
      // ... and never narrower than a smaller size would be.
      const { side } = own(W, H);
      const sizes = Object.values(TANK_SIZES).filter(([tw, th]) => tw * th <= W * H);
      const w = Math.max(own(W, H).w, ...sizes.map(([tw, th]) => own(tw, th).w));
      const h = (w * H) / W;
      Object.assign(canvas.style, { width: `${w}px`, height: `${h}px` });
      document.documentElement.style.setProperty('--tank-width', `${w}px`);
      document.documentElement.classList.toggle('side', side);
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
    document.addEventListener('fullscreenchange', fit, { signal: abort.signal });

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
