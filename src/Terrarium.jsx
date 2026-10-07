import { useEffect, useRef } from 'react';
import { createWorld, resizeWorld, step, pointerDown, pointerMove, pointerUp, pointerCancel } from './sim.js';
import { drawWorld } from './render.js';

const PIXEL_SCALE = 1.5; // screen pixels per world pixel (before devicePixelRatio)
const TICK_MS = 1000 / 60;

export default function Terrarium({ className, style, worldRef }) {
  const canvasRef = useRef(null);

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

    const world = createWorld(...fit());
    if (worldRef) worldRef.current = world;
    const ro = new ResizeObserver(() => resizeWorld(world, ...fit()));
    ro.observe(canvas);

    const toWorld = (e) => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * world.W, ((e.clientY - r.top) / r.height) * world.H];
    };
    const abort = new AbortController();
    const on = (type, fn) => canvas.addEventListener(type, fn, { signal: abort.signal });
    on('pointerdown', (e) => {
      pointerDown(world, ...toWorld(e));
      canvas.setPointerCapture(e.pointerId);
    });
    on('pointermove', (e) => pointerMove(world, ...toWorld(e)));
    on('pointerup', (e) => pointerUp(world, ...toWorld(e)));
    on('pointercancel', () => pointerCancel(world));

    // Fixed-timestep loop, capped so a backgrounded tab doesn't fast-forward.
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    const frame = (now) => {
      acc = Math.min(acc + now - last, 100);
      last = now;
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
      if (worldRef?.current === world) worldRef.current = null;
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
