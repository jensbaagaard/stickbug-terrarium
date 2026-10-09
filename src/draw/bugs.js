// Drawing stick insects: the body along its points, coloured and patterned from its genes, its legs, feet and antennae,
// and how it holds itself (walking, dancing, its quirks).
import {
  idealFoot,
  legLayout,
  MID,
  sampleBody,
  SEGMENTS,
  standHeight,
  strideLen,
  tangentAt,
  thighFor,
} from '../anatomy.js';
import { bodyHex, FAR_SHADE, patternHex, patternOf } from '../genome.js';
import { add, clamp, hash, hslHex, lerp, normalize, segNormal } from '../geom.js';
import { floorBelow } from '../sim.js';
import { ARROW, NOTE } from './marks.js';
import { COIN, sprite, strokeBy } from './pixelart.js';

// Colour along one part of a bug: u is px along the part, len its length, f where it joins the body
// (0 head .. 1 tail) for legs and antennae.
const painter = (t, seed) => {
  const pattern = patternOf(t);
  return (part, len, f = 0, dark = 0, salt = 0) =>
    (u) => {
      const along = part === 'body' ? u / len : f;
      const base = bodyHex(t, along, dark);
      const mark = () => patternHex(t, along, dark);
      switch (pattern) {
        case 'bands':
          return Math.floor(u / t.patternScale) % 2 ? mark() : base;
        case 'speckle':
          return hash(seed, Math.floor(u), salt) < 0.22 ? mark() : base;
        case 'spots':
          return part === 'body' && u % (t.patternScale * 2.5) < 1.5 ? mark() : base;
        case 'tipped':
          return (part === 'body' ? along < 0.1 || along > 0.9 : u / len > 0.7) ? mark() : base;
        case 'tiger': {
          // Dark stripes, unevenly spaced and of uneven width.
          const k = u / t.patternScale;
          return Math.sin(k * 2.2 + Math.sin(k * 0.9 + seed) * 1.5) > 0.45 ? patternHex(t, along, dark + 12) : base;
        }
        case 'piebald': {
          // Big patches of the pattern colour by turns, with ragged edges, legs and all.
          const at = part === 'body' ? u : f * 40;
          const patch = Math.floor((at + Math.sin(at * 0.4 + seed) * t.patternScale) / (t.patternScale * 2.5));
          return (patch + Math.floor(seed)) % 2 ? mark() : base;
        }
        case 'rainbow':
          // The hue goes most of the way round the wheel from head to tail.
          return hslHex(t.hue + along * 300, Math.max(t.sat, 55), clamp(t.light, 40, 70) - dark);
        case 'starry':
          // A night sky: dark all over, scattered with little stars.
          return hash(seed, Math.floor(u), salt + 11) < 0.12
            ? hslHex(t.hue + t.patternHue, 35, 88 - dark)
            : bodyHex(t, along, dark + 28);
        default:
          return base;
      }
    };
};

export const drawBug = (ctx, world, bug) => {
  const t = bug.t;
  const time = world.time;
  const up = bug.surf ? segNormal(bug.surf) : { x: 0, y: -1 };
  const down = { x: -up.x, y: -up.y };
  const anchor = bug.pts.map((p) => ({ x: p.x, y: p.y }));
  const pose = bug.surf && bug.pose ? bug.pose : anchor;
  const h = standHeight(t);
  const dancing = bug.state === 'dance';

  // The stickbug rock: feet stay planted while the body sways fore and aft over them, hanging at each end
  // and dipping as the legs lean. Each dance starts and ends centred, so it needs no easing.
  const beat = dancing ? bug.beat : 0;
  const rock = Math.sign(Math.sin(beat)) * Math.abs(Math.sin(beat)) ** (1 - t.danceHang);
  const axis = tangentAt(anchor, MID);
  const sway = t.danceSway * h * rock;
  const dip = t.danceDip * h * rock * rock;
  // Resting bugs drift fore and aft like a twig in a breeze, each catching its own gusts.
  const breeze = time * t.idleSwaySpeed + bug.seed;
  const gust = 0.7 * Math.sin(breeze) + 0.3 * Math.sin(breeze * 2.3 + 1);
  const drift = bug.calm * t.idleSway * h * gust;
  const body = anchor.map((p) => add(add(p, axis, sway + drift), up, -dip));
  // Eating: the head goes down to the leaf and stays there, bopping gently with each chew. The antennae aim
  // as if each chew dipped antennaShake times as far.
  const headDrop = t.headDown * t.size;
  const chewDip = (t.chewBop * t.size * (1 - Math.cos(bug.chew))) / 2;
  const aim = add(body[0], down, bug.munch * (headDrop + chewDip * t.antennaShake));
  body[0] = add(body[0], down, bug.munch * (headDrop + chewDip));
  body[1] = add(body[1], down, bug.munch * headDrop * 0.3);
  // Waving rears the front end up a little.
  const rear = bug.quirk === 'wave' ? bug.raise * t.size * 1.5 : 0;
  body[0] = add(body[0], up, rear);
  body[1] = add(body[1], up, rear * 0.6);
  aim.x += up.x * rear;
  aim.y += up.y * rear;

  const paint = painter(t, bug.seed);
  const scale = t.size * t.legLength;
  const fwd = normalize({ x: aim.x - body[1].x, y: aim.y - body[1].y });
  const antLen = t.antenna * t.size * (0.4 + 0.6 * bug.squash);
  const head = body[0];

  // Front legs during quirks: waved in the air, held out in front like a twig, or one combing an antenna.
  const quirkLeg = (L, hip) => {
    const reach = (t.thigh + t.shin) * scale * 0.5;
    if (bug.quirk === 'wave') {
      const a = 0.6 * Math.sin(time * t.waveSpeed + (L.near ? 0 : Math.PI));
      const knee = add(add(hip, fwd, reach * 0.5), up, reach * 0.4);
      const lift = t.waveHeight * t.size;
      return [knee, add(add(knee, up, Math.cos(a) * lift), fwd, Math.sin(a) * lift + lift * 0.3)];
    }
    if (bug.quirk === 'twig') {
      const foot = add(add(head, fwd, antLen * 0.55), down, L.near ? 0 : 1);
      return [lerp(hip, foot, 0.45), foot];
    }
    if (bug.quirk === 'groom' && L.near) {
      const stroke = 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(time * 0.18));
      return [add(add(hip, up, 2 * t.size), fwd, 2 * t.size), add(add(head, fwd, antLen * stroke), down, 1)];
    }
    return null;
  };

  const legPath = (L, k) => {
    const r = L.reach * bug.squash;
    const hip = sampleBody(body, L.at);
    const tan = tangentAt(body, L.at);
    let knee = add(hip, thighFor(t, tan, r, down));
    let foot = bug.surf ? bug.legs[k].foot : null;
    if (!foot) {
      // Loose: dangling, or paddling while held or swimming.
      let ahead = 0;
      let raise = 0;
      if (bug.state === 'held' || bug.state === 'swim') {
        const kick = time * 0.4 + Math.PI * L.tripod;
        ahead = strideLen(t) * Math.sin(kick);
        raise = t.footLift * t.size * Math.max(0, Math.cos(kick));
      }
      foot = add(idealFoot(t, pose, L, bug.squash, down, ahead), up, raise);
      foot.y = Math.min(foot.y, floorBelow(world, foot.x, knee.y).y - 1);
    }
    if (L.front && bug.raise > 0.01) {
      const q = quirkLeg(L, hip);
      if (q) {
        knee = lerp(knee, q[0], bug.raise);
        foot = lerp(foot, q[1], bug.raise);
      }
    }
    return [hip, knee, foot];
  };

  const drawLeg = (L, k) => {
    const pts = legPath(L, k);
    const span = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    const len = span(pts[0], pts[1]) + span(pts[1], pts[2]);
    strokeBy(ctx, pts, paint('leg', len || 1, L.at / (SEGMENTS - 1), L.near ? 0 : FAR_SHADE, k + 1));
  };

  const layout = legLayout(t);
  layout.forEach((L, k) => !L.near && drawLeg(L, k));
  let bodyLen = 0;
  for (let i = 0; i < SEGMENTS - 1; i++) bodyLen += Math.hypot(body[i + 1].x - body[i].x, body[i + 1].y - body[i].y);
  strokeBy(ctx, body, paint('body', bodyLen || 1));
  layout.forEach((L, k) => L.near && drawLeg(L, k));

  // Antennae wave while the bug is busy, hold still while it rests, and trail the rock while dancing; a
  // twig pose holds them together straight ahead.
  const wave =
    t.antennaTwitch * Math.sin(time * 0.07 + bug.seed) * (1 - bug.calm) * (1 - bug.groove) +
    0.2 * bug.groove * Math.sin(beat - 1);
  const spread = 0.21 * (bug.quirk === 'twig' ? 1 - 0.85 * bug.raise : 1);
  for (const s of [1, -1]) {
    // Grooming bends one antenna down to the leg combing it.
    const groom = bug.quirk === 'groom' && s === 1 ? 0.35 * bug.raise * Math.sign(fwd.x || 1) : 0;
    const a = s * spread + wave + groom;
    const dir = { x: fwd.x * Math.cos(a) - fwd.y * Math.sin(a), y: fwd.x * Math.sin(a) + fwd.y * Math.cos(a) };
    strokeBy(ctx, [head, add(head, dir, antLen)], paint('antenna', antLen || 1, 0, 0, 10 + s));
  }

  if (dancing) {
    const rise = (time * 0.25 + bug.seed * 7) % 14;
    if (rise < 11) {
      const p = add(body[MID], up, 8 + rise);
      ctx.fillStyle = '#e3d3b5';
      sprite(ctx, NOTE, p.x - 2, p.y - 3);
    }
  }
  if (world.selected === bug) {
    const p = add(body[MID], up, 9 + h * 0.2);
    ctx.fillStyle = COIN;
    sprite(ctx, ARROW, p.x - 2, p.y - 2 + (Math.floor(time / 20) % 2));
  }
};
