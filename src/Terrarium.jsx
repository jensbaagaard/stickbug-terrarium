// The tank's canvas: sized to a whole number of screen px per tank px (the most that fits), turning pointer events
// into tank coordinates for the tools, and running the world a fixed 60 ticks a second, drawn every frame. And the zoom
// (view.js): its buttons and minimap in the tank's corner, the wheel, and moving the view with the right button.
import { useLayoutEffect, useRef, useState } from 'react';
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
import { Icon } from './ui/parts.jsx';
import { UNZOOMED, ZOOMS, clampView, nextZoom, panBy, zoomAbout, zoomMiddle } from './view.js';

// The tank is one of TANK_SIZES in world pixels (size picks which to start with; a world swapped in later may be
// another), shown a whole number of screen pixels to each so they all come out the same size: the most that fits, up
// to MAX_SCALE css px to a world pixel and HEIGHT_SHARE of the window's height (leaving room for the panel). A bigger
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
const WHEEL_STEP = 50; // px of wheel, or of pinch, to a step of zoom
const LINE_PX = 16; // px to a line, for a wheel that scrolls in lines
const GLIDE = 'transform 0.2s ease-out'; // a step of zoom glides there, so you can see where it went
const MAP_SHARE = 1 / 6; // the minimap's width, of the tank's
const MAP_MIN = 64; // css px

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
// a loaded save say, at any time. children are more buttons for the tank's corner, after the zoom's.
export default function Terrarium({ worldRef: ref, size = 'small', children }) {
  const canvasRef = useRef(null);
  const mapRef = useRef(null);
  // The zoom, like Dust 2's SCALE: the view (view.js), stepped in and out about its middle by the buttons, and while
  // zoomed in, the minimap under them shows where it is; dragging that, scrolling, or dragging the tank with the right
  // (or middle) button moves it. A pinch, or Ctrl and the wheel, zooms about the pointer.
  const view = useRef(UNZOOMED);
  const [zoom, setZoom] = useState(1);

  // css px to a world px, magnified z times.
  const cssPx = (z) => (parseFloat(canvasRef.current.style.width) / ref.current.W) * z;
  // Show view v, kept inside the tank: the canvas magnified v.z times and moved, by whole screen px, gliding there if
  // glide (a step of zoom does; moving about doesn't, so the view keeps up with the pointer).
  const show = (v, glide = false) => {
    const canvas = canvasRef.current;
    const { W, H } = ref.current;
    v = view.current = clampView(v, W, H);
    const k = cssPx(v.z);
    const dpr = window.devicePixelRatio || 1;
    const at = (n) => Math.round(-n * k * dpr) / dpr;
    canvas.style.transition = glide ? GLIDE : '';
    canvas.style.transform = `translate(${at(v.x)}px, ${at(v.y)}px) scale(${v.z})`;
    setZoom(v.z);
  };
  const zoomBy = (dir) => {
    const { W, H } = ref.current;
    show(zoomMiddle(view.current, nextZoom(view.current.z, dir), W, H), true);
  };
  // A press on the minimap puts the middle of the view there, and dragging it takes the view along.
  const onMap = (e) => {
    const map = e.currentTarget;
    if (e.type === 'pointerdown') map.setPointerCapture(e.pointerId);
    else if (!map.hasPointerCapture(e.pointerId)) return;
    const r = map.getBoundingClientRect();
    const { W, H } = ref.current;
    const v = view.current;
    const [x, y] = [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
    show({ ...v, x: x - W / v.z / 2, y: y - H / v.z / 2 }, e.type === 'pointerdown');
  };

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
        show(view.current);
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const across = document.documentElement.clientWidth - GUTTER;
      // How a tank W by H is shown on its own: css px wide, and whether beside the panel. Small: whole screen pixels
      // to a world pixel, as many as fit. Bigger: as big as fits, with the panel under it or beside it.
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
      show(view.current);
    };
    fit();

    // Where the pointer is in the tank, by the view (where it's going, if it's still gliding there) and the box round
    // the canvas, which stays put.
    const toWorld = (world, e) => {
      const r = canvas.parentElement.getBoundingClientRect();
      const { z, x, y } = view.current;
      return [x + (e.clientX - r.left) / cssPx(z), y + (e.clientY - r.top) / cssPx(z)];
    };
    const abort = new AbortController();

    // Zoomed in, a press with the right or middle button moves the view (Dust 2 has SCALE on a button for it): where
    // it went down, in client px, and the view then.
    let pan = null;
    const panning = {
      pointermove: (world, e) => {
        const k = cssPx(pan.from.z);
        show(panBy(pan.from, (pan.x - e.clientX) / k, (pan.y - e.clientY) / k, world.W, world.H));
      },
      pointerup: () => (pan = null),
      pointercancel: () => (pan = null),
    };
    const on = (type, fn) =>
      canvas.addEventListener(
        type,
        (e) => {
          const world = ref.current;
          if (!world) return;
          if (type === 'pointerdown' && e.button > 0 && view.current.z > 1) {
            pan = { x: e.clientX, y: e.clientY, from: view.current };
            canvas.setPointerCapture(e.pointerId);
          }
          if (pan) {
            panning[type]?.(world, e);
            canvas.style.cursor = pan ? 'grabbing' : cursorOf(world);
            return;
          }
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
    canvas.addEventListener('contextmenu', (e) => view.current.z > 1 && e.preventDefault(), { signal: abort.signal });

    // The wheel: pinched, or with Ctrl, it zooms about the pointer, a step for every WHEEL_STEP px of it; otherwise,
    // zoomed in, it moves the view, and at 1:1 it scrolls the page as ever.
    let wheel = 0;
    let wheelAt = 0;
    canvas.addEventListener(
      'wheel',
      (e) => {
        const world = ref.current;
        if (!world) return;
        const v = view.current;
        const px = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? canvas.clientHeight : 1;
        if (e.ctrlKey) {
          e.preventDefault();
          if (e.timeStamp - wheelAt > 300 || Math.sign(e.deltaY) !== Math.sign(wheel)) wheel = 0; // a fresh turn
          wheelAt = e.timeStamp;
          wheel += e.deltaY * px;
          if (Math.abs(wheel) < WHEEL_STEP) return;
          show(zoomAbout(v, nextZoom(v.z, wheel < 0 ? 1 : -1), ...toWorld(world, e), world.W, world.H), true);
          wheel = 0;
        } else if (v.z > 1) {
          e.preventDefault();
          const k = cssPx(v.z);
          show(panBy(v, (e.deltaX * px) / k, (e.deltaY * px) / k, world.W, world.H));
        }
      },
      { passive: false, signal: abort.signal },
    );
    window.addEventListener('resize', fit, { signal: abort.signal }); // also fires when the page zoom or screen changes
    document.addEventListener('fullscreenchange', fit, { signal: abort.signal });

    // The minimap, while zoomed in: the whole tank, small, darkened but for the view, which is framed.
    const drawMap = () => {
      const map = mapRef.current;
      if (!map) return;
      const { W, H } = ref.current;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(MAP_MIN, Math.round(parseFloat(canvas.style.width) * MAP_SHARE));
      const [mw, mh] = [Math.round(w * dpr), Math.round((w * dpr * H) / W)];
      if (map.width !== mw || map.height !== mh) {
        [map.width, map.height] = [mw, mh];
        Object.assign(map.style, { width: `${mw / dpr}px`, height: `${mh / dpr}px` });
      }
      const mctx = map.getContext('2d');
      mctx.drawImage(canvas, 0, 0, mw, mh);
      const v = view.current;
      const [x, y, x1, y1] = [v.x, v.y, v.x + W / v.z, v.y + H / v.z].map((n) => Math.round((n * mw) / W));
      mctx.globalAlpha = 0.5;
      mctx.fillStyle = '#000000';
      mctx.fillRect(0, 0, mw, y);
      mctx.fillRect(0, y1, mw, mh - y1);
      mctx.fillRect(0, y, x, y1 - y);
      mctx.fillRect(x1, y, mw - x1, y1 - y);
      mctx.globalAlpha = 1;
      const t = Math.max(1, Math.round(dpr)); // the frame: a screen px or so, light inside dark, to show over anything
      for (const [colour, d] of [['#17110c', t], ['#e3d3b5', 0]]) {
        mctx.fillStyle = colour;
        mctx.fillRect(x - d, y - d, x1 - x + 2 * d, t);
        mctx.fillRect(x - d, y1 - t + d, x1 - x + 2 * d, t);
        mctx.fillRect(x - d, y - d, t, y1 - y + 2 * d);
        mctx.fillRect(x1 - t + d, y - d, t, y1 - y + 2 * d);
      }
    };

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
      drawMap();
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
    <>
      {/* The canvas is magnified and moved by a transform; the box round it shows only what's in view. */}
      <div className="view">
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            touchAction: 'none',
            imageRendering: 'pixelated',
            transformOrigin: '0 0',
          }}
        />
      </div>
      <div className="corner">
        <div className="buttons">
          <div className={zoom > 1 ? 'zoom zoomed' : 'zoom'} role="group" aria-label="Zoom">
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out"
              disabled={zoom === 1}
              onClick={() => zoomBy(-1)}
            >
              <Icon name="unzoom" />
            </button>
            <span className="level" aria-live="polite">
              x{zoom}
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              title="Zoom in"
              disabled={zoom === ZOOMS.at(-1)}
              onClick={() => zoomBy(1)}
            >
              <Icon name="zoom" />
            </button>
          </div>
          {children}
        </div>
        {zoom > 1 && (
          <canvas
            ref={mapRef}
            className="minimap"
            aria-label="Where the view is: drag to move it"
            onPointerDown={onMap}
            onPointerMove={onMap}
          />
        )}
      </div>
    </>
  );
}
