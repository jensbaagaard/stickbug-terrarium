// Pixel-art canvas rendering for the terrarium.
import { params, SEGMENTS, MID, segDir, segNormal, segLength, pointAt, floorBelow } from './sim.js';

const NOTE = ['..#.', '..##', '..#.', '..#.', '###.', '##..'];

const normalize = (v) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};
const dot = (a, b) => a.x * b.x + a.y * b.y;
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k });

// Fill a pixel-snapped square of width w centred on (x, y).
const plot = (ctx, x, y, w) => {
  const h = w / 2;
  const x0 = Math.ceil(x - h);
  const y0 = Math.ceil(y - h);
  ctx.fillRect(x0, y0, Math.ceil(x + h) - x0, Math.ceil(y + h) - y0);
};

const line = (ctx, a, b, w = params.thickness) => {
  const steps = Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1));
  for (let i = 0; i <= steps; i++) plot(ctx, a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, w);
};

// Interpolated point at fractional body index i.
const sampleBody = (pts, i) => {
  const t = Math.min(Math.max(i, 0), SEGMENTS - 1);
  const k = Math.min(Math.floor(t), SEGMENTS - 2);
  const f = t - k;
  return { x: pts[k].x + (pts[k + 1].x - pts[k].x) * f, y: pts[k].y + (pts[k + 1].y - pts[k].y) * f };
};

// Unit tangent at body index i, pointing toward the head.
const tangentAt = (pts, i) => {
  const a = sampleBody(pts, i - 1);
  const b = sampleBody(pts, i + 1);
  return normalize({ x: a.x - b.x, y: a.y - b.y });
};

const drawBranch = (ctx, br) => {
  const n = segNormal(br);
  const a = { x: br.x0, y: br.y0 };
  const b = { x: br.x1, y: br.y1 };
  ctx.fillStyle = '#5a3d24';
  line(ctx, add(a, n, -1.5), add(b, n, -1.5), 3);
  ctx.fillStyle = '#8a6440';
  line(ctx, add(a, n, -0.5), add(b, n, -0.5), 1);
};

const drawLeaf = (ctx, br, leaf) => {
  const n = segNormal(br);
  const d = segDir(br);
  const base = pointAt(br, leaf.t * segLength(br));
  const axis = normalize({ x: n.x * 0.8 + d.x * 0.6 * leaf.lean, y: n.y * 0.8 + d.y * 0.6 * leaf.lean });
  const len = 2 + 6 * leaf.size;
  ctx.fillStyle = '#3f8f4f';
  for (let i = 0; i <= len; i++) {
    plot(ctx, base.x + axis.x * i, base.y + axis.y * i, 1 + 2.2 * leaf.size * Math.sin((Math.PI * i) / len));
  }
};

const drawBug = (ctx, world, bug) => {
  const time = world.time;
  const up = bug.surf ? segNormal(bug.surf) : { x: 0, y: -1 };
  const down = { x: -up.x, y: -up.y };
  const anchor = bug.pts.map((p) => ({ x: p.x, y: p.y }));
  const dancing = bug.state === 'dance';
  // Partners share a phase so they dance in sync.
  const phase = time * 0.13 + (bug.partner ? 0 : bug.seed);
  const axis = tangentAt(anchor, MID);
  const sway = dancing ? 2.5 * Math.sin(phase) : 0;
  const bob = dancing ? 1.2 * Math.abs(Math.sin(phase)) : 0;
  const body = anchor.map((p) => add(add(p, axis, sway), up, bob));
  if (bug.state === 'eat') body[0] = add(body[0], down, 1.5 * (1 + Math.sin(time * 0.5)));

  const scale = params.size * params.legLength;
  const moving = bug.state === 'walk' || bug.state === 'held';
  const stride = 1.6 * params.size;
  const lift = 1.4 * params.size;
  const gaitPhase = (bug.gait * Math.PI) / (2 * stride);
  const footClear = (params.thickness + 1) / 2;

  const drawLeg = (at, reach, legPhase, raised) => {
    const hip = sampleBody(body, at);
    const rootHip = sampleBody(anchor, at);
    const t = tangentAt(body, at);
    let side = { x: -t.y, y: t.x };
    if (dot(side, down) < 0) side = { x: -side.x, y: -side.y };
    const r = reach * bug.squash;
    let thigh = {
      x: (t.x * r * params.thigh + side.x * params.kneeDrop) * scale,
      y: (t.y * r * params.thigh + side.y * params.kneeDrop) * scale,
    };
    thigh = add(thigh, down, -Math.min(0, dot(thigh, down))); // knee never above the body
    const knee = add(hip, thigh);
    let foot;
    if (raised) {
      foot = add(add(knee, t, params.shin * scale * 1.2), up, (2 + 1.5 * Math.sin(phase * 2)) * scale);
    } else {
      const swing = moving ? Math.sin(gaitPhase + legPhase) : 0;
      const raise = moving ? Math.max(0, Math.cos(gaitPhase + legPhase)) * lift : 0;
      foot = add(add(add(rootHip, thigh), t, r * params.shin * scale + swing * stride), down, params.leg * scale - raise);
      if (bug.surf) {
        const depth = dot({ x: foot.x - bug.surf.x0, y: foot.y - bug.surf.y0 }, up);
        if (depth < footClear) foot = add(foot, up, footClear - depth);
      } else {
        foot.y = Math.min(foot.y, floorBelow(world, foot.x, knee.y).y - footClear);
      }
    }
    line(ctx, hip, knee);
    line(ctx, knee, foot);
  };

  const legs = [
    [MID - params.spacing, params.front, true],
    [MID, params.mid, false],
    [MID + params.spacing, params.hind, false],
  ];

  // Far-side legs, darker and shorter.
  ctx.fillStyle = '#3d5a22';
  legs.forEach(([at, reach], i) => drawLeg(at, reach * 0.5, Math.PI * (i + 1), false));

  ctx.fillStyle = '#8fbf4a';
  for (let i = 0; i < SEGMENTS - 1; i++) line(ctx, body[i], body[i + 1]);

  // Near-side legs; the front one waves while dancing.
  legs.forEach(([at, reach, isFront], i) => drawLeg(at, reach, Math.PI * i, dancing && isFront));

  const head = body[0];
  const fwd = normalize({ x: body[0].x - body[1].x, y: body[0].y - body[1].y });
  const antLen = params.antenna * params.size * (0.4 + 0.6 * bug.squash);
  const wave = dancing
    ? 0.3 * Math.sin(phase * 2)
    : 0.12 * Math.sin(time * 0.07 + bug.seed) * (bug.state === 'idle' ? 1.6 : 0.7);
  for (const s of [1, -1]) {
    const a = s * 0.21 + wave;
    const dir = { x: fwd.x * Math.cos(a) - fwd.y * Math.sin(a), y: fwd.x * Math.sin(a) + fwd.y * Math.cos(a) };
    line(ctx, head, add(head, dir, antLen));
  }

  if (dancing) {
    const rise = (time * 0.25 + bug.seed * 7) % 14;
    if (rise < 11) {
      const p = add(body[MID], up, 8 + rise);
      ctx.fillStyle = '#e3d3b5';
      NOTE.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch === '#') ctx.fillRect(Math.round(p.x) - 2 + x, Math.round(p.y) - 3 + y, 1, 1);
        }),
      );
    }
  }
};

export const drawWorld = (ctx, world) => {
  const floor = world.ground.y0;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, world.W, world.H);
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(0, floor, world.W, world.H - floor);
  ctx.fillStyle = '#9c7448';
  ctx.fillRect(0, floor, world.W, 1);
  for (const br of world.branches) drawBranch(ctx, br);
  for (const br of world.branches) for (const leaf of br.leaves) drawLeaf(ctx, br, leaf);
  const d = world.draft;
  if (d) {
    ctx.globalAlpha = 0.5;
    drawBranch(ctx, d.x1 < d.x0 ? { x0: d.x1, y0: d.y1, x1: d.x0, y1: d.y0 } : d);
    ctx.globalAlpha = 1;
  }
  for (const bug of world.bugs) drawBug(ctx, world, bug);
};
