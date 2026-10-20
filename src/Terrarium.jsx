// The tank's canvas: sized to a whole number of screen px per tank px (the most that fits), turning pointer events
// into tank coordinates for the tools, and running the world a fixed 60 ticks a second, drawn every frame. And the zoom
// (view.js): its buttons in the tank's corner, and zoom mode, where a press zooms or moves the view.
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
const DRAG_SLOP = 4; // css px a press in zoom mode can move and still be a tap, which zooms, not a drag
const WHEEL_STEP = 50; // px of wheel, or of pinch, to a step of zoom
const LINE_PX = 16; // px to a line, for a wheel that scrolls in lines

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
  // The view (view.js), and zoom mode, like a tool of its own: while it's on, a tap zooms in about where it lands (out
  // with the right button, Alt or Shift), a drag moves the view, and the wheel zooms. entered is what was going on when
  // it came on: picking a tool, something to put in or another tank leaves it, so the next press is theirs.
  const view = useRef(UNZOOMED);
  const [zoom, setZoom] = useState(1);
  const [zooming, setZoomingState] = useState(false);
  const zoomingRef = useRef(false);
  const entered = useRef(null);
  const setZooming = (on) => {
    const world = ref.current;
    if (!world) return;
    if (on) {
      world.hover = false; // no marks or brush under the pointer while it zooms
      entered.current = { world, tool: world.tool, placing: world.placing };
    }
    zoomingRef.current = on;
    setZoomingState(on);
    canvasRef.current.style.cursor = on ? 'zoom-in' : cursorOf(world);
  };

  // css px to a world px, magnified z times.
  const cssPx = (z) => (parseFloat(canvasRef.current.style.width) / ref.current.W) * z;
  // Show view v, kept inside the tank: the canvas magnified v.z times and moved, by whole screen px.
  const show = (v) => {
    const canvas = canvasRef.current;
    const { W, H } = ref.current;
    v = view.current = clampView(v, W, H);
    const k = cssPx(v.z);
    const dpr = window.devicePixelRatio || 1;
    const at = (n) => Math.round(-n * k * dpr) / dpr;
    canvas.style.transform = v.z === 1 ? '' : `translate(${at(v.x)}px, ${at(v.y)}px) scale(${v.z})`;
    setZoom(v.z);
  };
  const zoomOut = () => {
    const { W, H } = ref.current;
    show(zoomMiddle(view.current, nextZoom(view.current.z, -1), W, H));
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

    const toWorld = (world, e) => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * world.W, ((e.clientY - r.top) / r.height) * world.H];
    };
    const abort = new AbortController();

    // Zoom mode's press: where it went down (client px), the view then, whether it zooms out, and whether it's moved
    // far enough to be a drag.
    let press = null;
    const zoomOutKey = (e) => e.button === 2 || e.altKey || e.shiftKey;
    const zoomCursor = (e) => {
      if (press?.moved) return 'grabbing';
      if (zoomOutKey(e)) return 'zoom-out';
      return view.current.z < ZOOMS.at(-1) ? 'zoom-in' : 'grab';
    };
    const zoomPress = {
      pointerdown: (world, e) => {
        press = { x: e.clientX, y: e.clientY, from: view.current, out: zoomOutKey(e), moved: false };
        canvas.setPointerCapture(e.pointerId);
      },
      pointermove: (world, e) => {
        if (!press) return;
        const [dx, dy] = [e.clientX - press.x, e.clientY - press.y];
        press.moved ||= Math.hypot(dx, dy) > DRAG_SLOP;
        const k = cssPx(press.from.z);
        if (press.moved) show(panBy(press.from, -dx / k, -dy / k, world.W, world.H));
      },
      pointerup: (world, e) => {
        if (press && !press.moved) {
          const z = nextZoom(view.current.z, press.out ? -1 : 1);
          show(zoomAbout(view.current, z, ...toWorld(world, e), world.W, world.H));
        }
        press = null;
      },
      pointercancel: () => (press = null),
    };

    // In zoom mode a press is the zoom's (zoomPress), not the tools', to the end, even if zoom mode ends first.
    const on = (type, fn) =>
      canvas.addEventListener(
        type,
        (e) => {
          const world = ref.current;
          if (!world) return;
          if (zoomingRef.current || press) {
            zoomPress[type]?.(world, e);
            canvas.style.cursor = zoomCursor(e);
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
    canvas.addEventListener('contextmenu', (e) => zoomingRef.current && e.preventDefault(), { signal: abort.signal });

    // The wheel: in zoom mode, or pinched (or with Ctrl), it zooms about the pointer, a step for every WHEEL_STEP px of
    // it; otherwise, zoomed in, it moves the view, and at 1:1 it scrolls the page as ever.
    let wheel = 0;
    let wheelAt = 0;
    canvas.addEventListener(
      'wheel',
      (e) => {
        const world = ref.current;
        if (!world) return;
        const v = view.current;
        const px = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? canvas.clientHeight : 1;
        if (zoomingRef.current || e.ctrlKey) {
          e.preventDefault();
          if (e.timeStamp - wheelAt > 300 || Math.sign(e.deltaY) !== Math.sign(wheel)) wheel = 0; // a fresh turn
          wheelAt = e.timeStamp;
          wheel += e.deltaY * px;
          if (Math.abs(wheel) < WHEEL_STEP) return;
          show(zoomAbout(v, nextZoom(v.z, wheel < 0 ? 1 : -1), ...toWorld(world, e), world.W, world.H));
          wheel = 0;
        } else if (v.z > 1) {
          e.preventDefault();
          const k = cssPx(v.z);
          show(panBy(v, (e.deltaX * px) / k, (e.deltaY * px) / k, world.W, world.H));
        }
      },
      { passive: false, signal: abort.signal },
    );
    window.addEventListener('keydown', (e) => e.key === 'Escape' && zoomingRef.current && setZooming(false), {
      signal: abort.signal,
    });
    window.addEventListener('resize', fit, { signal: abort.signal }); // also fires when the page zoom or screen changes
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
      const was = entered.current;
      if (zoomingRef.current && (world !== was.world || world.tool !== was.tool || world.placing !== was.placing)) {
        setZooming(false);
      }
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
        {zoom > 1 && (
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={zoomOut}>
            <Icon name="unzoom" />
          </button>
        )}
        <button
          type="button"
          aria-label="Zoom"
          aria-pressed={zooming}
          title="Zoom: click to zoom in, right-click to zoom out, drag to move"
          onClick={() => setZooming(!zooming)}
        >
          <Icon name="zoom" />
        </button>
        {children}
      </div>
    </>
  );
}
