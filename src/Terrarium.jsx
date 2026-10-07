import { useEffect, useRef } from 'react';
import { createWorld, resizeWorld, step, pointerDown, pointerMove, pointerUp, pointerCancel } from './sim.js';
import { drawWorld } from './render.js';

const PIXEL_SCALE = 1.5; // screen pixels per world pixel (before devicePixelRatio)
const TICK_MS = 1000 / 60;

// The world lives in worldRef (or a ref of its own), and everything here reads it from there, so the parent can
// swap in another world, a loaded save say, at any time.
export default function Terrarium({ className, style, worldRef }) {
  const canvasRef = useRef(null);
  const ownRef = useRef(null);
  const ref = worldRef ?? ownRef;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const px = Math.max(1, Math.floor(dpr * PIXEL_SCALE));
      const w = Math.max(32, Math.round((canvas.clientWidth * dpr) / px));
      const h = Math.max(32, Math.round((canvas.clientHeight * dpr) / px));
      if (w !== canvas.width || h !== canvas.height) [canvas.width, canvas.height] = [w, h];
      return [w, h];
    };

    ref.current = createWorld(...fit());
    const ro = new ResizeObserver(() => ref.current && resizeWorld(ref.current, ...fit()));
    ro.observe(canvas);

    const toWorld = (world, e) => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * world.W, ((e.clientY - r.top) / r.height) * world.H];
    };
    const abort = new AbortController();
    const on = (type, fn) =>
      canvas.addEventListener(type, (e) => ref.current && fn(ref.current, e), { signal: abort.signal });
    on('pointerdown', (world, e) => {
      pointerDown(world, ...toWorld(world, e));
      canvas.setPointerCapture(e.pointerId);
    });
    on('pointermove', (world, e) => pointerMove(world, ...toWorld(world, e)));
    on('pointerup', (world, e) => pointerUp(world, ...toWorld(world, e)));
    on('pointercancel', (world) => pointerCancel(world));

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
      ro.disconnect();
      abort.abort();
      ref.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        display: 'block',
        width: '100%',
        aspectRatio: '3 / 4',
        touchAction: 'none',
        imageRendering: 'pixelated',
        cursor: 'grab',
        ...style,
      }}
    />
  );
}
