import { useEffect, useRef } from 'react';
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

// The tank is always this many world pixels, scaled up to fit the page.
const W = 256;
const H = 341;
const TICK_MS = 1000 / 60;

// The cursor says what a press would do there.
const AIM_CURSORS = { bug: 'grab', cut: SCISSORS_CURSOR, lift: 'grab', pick: 'pointer', drop: 'copy' };
const cursorOf = (world) => {
  if (world.held || (world.moving && world.tool === 'move')) return 'grabbing';
  if (world.tool === 'paint') return 'crosshair';
  if (world.placing) return previewAt(world) ? 'copy' : 'not-allowed';
  const aim = aimAt(world);
  return aim ? AIM_CURSORS[aim.kind] : world.tool === 'prune' ? 'crosshair' : 'default';
};

// The world lives in worldRef (or a ref of its own), and everything here reads it from there, so the parent can
// swap in another world, a loaded save say, at any time.
export default function Terrarium({ className, style, worldRef }) {
  const canvasRef = useRef(null);
  const ownRef = useRef(null);
  const ref = worldRef ?? ownRef;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    ref.current = createWorld(W, H);

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
      className={className}
      style={{
        display: 'block',
        width: '100%',
        aspectRatio: `${W} / ${H}`,
        touchAction: 'none',
        imageRendering: 'pixelated',
        ...style,
      }}
    />
  );
}
