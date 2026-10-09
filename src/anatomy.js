// Body and leg geometry, shared by the simulation (which plants feet) and the renderer. Most functions take a bug's
// traits t.
import { add, dot, normalize } from './geom.js';

export const SEGMENTS = 7; // body points, index 0 is the head
export const MID = (SEGMENTS - 1) / 2;
export const THICKNESS = 1.3; // line width of a bug's body, legs and antennae
export const FOOT_CLEAR = (THICKNESS + 1) / 2; // feet stand this far off a surface

export const standHeight = (t) => (t.leg + t.kneeDrop) * t.size * t.legLength;
export const bodySegLen = (t) => t.seg * t.size;
export const strideLen = (t) => t.stride * t.size;

// Interpolated point at fractional body index i.
export const sampleBody = (pts, i) => {
  const c = Math.min(Math.max(i, 0), SEGMENTS - 1);
  const k = Math.min(Math.floor(c), SEGMENTS - 2);
  const f = c - k;
  return { x: pts[k].x + (pts[k + 1].x - pts[k].x) * f, y: pts[k].y + (pts[k + 1].y - pts[k].y) * f };
};

// Unit tangent at body index i, pointing toward the head.
export const tangentAt = (pts, i) => {
  const a = sampleBody(pts, i - 1);
  const b = sampleBody(pts, i + 1);
  return normalize({ x: a.x - b.x, y: a.y - b.y });
};

// Six legs: three on the near side (drawn in front) and three shorter ones on the far side. Near front,
// near hind and far middle make tripod 0; the other three tripod 1.
export const legLayout = (t) => [
  { at: MID - t.spacing, reach: t.front, near: true, tripod: 0, front: true },
  { at: MID, reach: t.mid, near: true, tripod: 1 },
  { at: MID + t.spacing, reach: t.hind, near: true, tripod: 0 },
  { at: MID - t.spacing, reach: t.front * 0.5, near: false, tripod: 1, front: true },
  { at: MID, reach: t.mid * 0.5, near: false, tripod: 0 },
  { at: MID + t.spacing, reach: t.hind * 0.5, near: false, tripod: 1 },
];

// Hip-to-knee vector for a leg reaching r along a body running along tan.
export const thighFor = (t, tan, r, down) => {
  let side = { x: -tan.y, y: tan.x };
  if (dot(side, down) < 0) side = { x: -side.x, y: -side.y };
  const scale = t.size * t.legLength;
  const thigh = {
    x: (tan.x * r * t.thigh + side.x * t.kneeDrop) * scale,
    y: (tan.y * r * t.thigh + side.y * t.kneeDrop) * scale,
  };
  return add(thigh, down, -Math.min(0, dot(thigh, down))); // knee never above the body
};

// Where a leg's foot wants to be for a body at pose, reaching `ahead` further along the heading.
export const idealFoot = (t, pose, leg, squash, down, ahead = 0) => {
  const r = leg.reach * squash;
  const tan = tangentAt(pose, leg.at);
  const scale = t.size * t.legLength;
  const knee = add(sampleBody(pose, leg.at), thighFor(t, tan, r, down));
  return add(add(knee, tan, r * t.shin * scale + ahead), down, t.leg * scale);
};
