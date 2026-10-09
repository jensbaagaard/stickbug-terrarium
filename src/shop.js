// The shop: the offers on show (bugs, fliers, fish, plants, sticks and wallpapers), their prices, rerolling, and
// putting in what's bought; and an offer staged in a scratch tank for its picture. Pure data + functions.
import { GENES, params } from './tuning.js';
import { patternRarity, randomGenes, randomName } from './genome.js';
import { mulberry32, project } from './geom.js';
import { makeClump, makeGrass, makeSpecies, makeStick, makeVine, makeWallpaper, rarePrice } from './decor.js';
import { fountainAt, placeFountain } from './terrain.js';
import { fishShape, guppyName, guppyPrice, makeGuppy, newFish } from './fish.js';
import { addFlier, flierName, flierPrice, flierShape, makeFlier, newFlier } from './fliers.js';
import { step } from './sim.js';
import { floorAt } from './surfaces.js';
import { addBug, bodyPose, land, newBug } from './bugs.js';
import { crownFull, growGrass, growPlant, growVine } from './plants.js';
import { addDecor, sowAt, standAt, vineAnchor } from './objects.js';

export const PRICES = { fountain: 15 }; // fixed prices for anything not showcased; showcased kinds are priced per offer
const SHOP_KINDS = ['bug', 'fish', 'plant', 'stick', 'wallpaper']; // showcased in the shop, OFFERS of each
export const OFFERS = 4;

// What a shop item becomes if put down at (x, y). Bugs drop from there, vines hang from it; everything else
// stands on the floor below, remembering what it stands on (on).
export const build = (world, kind, seed, x, y, genes) => {
  const rand = mulberry32(seed);
  if (kind === 'bug') return { kind, base: { x, y }, genes };
  if (kind === 'fish') return { kind, base: { x, y }, genome: genes }; // let go where you tap, in water or not
  if (kind === 'flier') return { kind, base: { x, y }, genome: genes }; // let go where you tap, to fly off
  // A fountain goes where you tap, mid-air or not; base is under the middle of the block.
  if (kind === 'fountain') {
    const box = fountainAt(world.terrain, x, y);
    return { kind, box, base: { x: box.x + box.size / 2, y: box.y + box.size } };
  }
  if (kind === 'vine') return { kind, ...vineAnchor(world, x, y), genome: makeVine(rand) };
  // Plants and sticks need something to stand on not far below; null if there's nothing.
  const at = kind === 'grass' ? sowAt(world, x, y) : standAt(world, x, y);
  if (!at) return null;
  if (kind === 'grass') return { kind, ...at, genome: makeGrass(rand) };
  if (kind === 'stick') return { kind, ...at, ...makeStick(rand, at.base, world.W, world.H) };
  if (kind === 'clump') return { kind: 'plant', ...at, species: makeClump(rand) };
  return { kind, ...at, species: makeSpecies(rand) };
};

// The item being placed, following the pointer (or, for its how-to, wherever that is).
export const previewAt = (world, x = world.pointer.x, y = world.pointer.y) => {
  const pl = world.placing;
  return pl && build(world, pl.kind, pl.seed, x, y, pl.offer?.genes ?? pl.offer?.genome);
};

// Pick something to buy: an offer from the showcase, or a fixed-price item. Picking it again puts it back.
export const startPlacing = (world, kind, offer = null) => {
  kind = offer?.type ?? kind; // a plant offer may be grass or a vine
  const price = offer ? offer.price : PRICES[kind];
  const same = world.placing?.kind === kind && world.placing.offer === offer;
  const full =
    (kind === 'bug' && world.bugs.length >= params.maxBugs) ||
    (kind === 'flier' && world.fliers.length >= params.maxFliers);
  const ok = !same && !full && !offer?.sold && world.coins >= price;
  const seed = offer?.seed ?? Math.floor(world.rand() * 2 ** 31);
  world.placing = ok ? { kind, offer, price, seed, at: world.time } : null;
  if (world.placing) Object.assign(world, { tool: 'hand', demo: null });
};

// Esc: put down whatever is waiting to go somewhere, a shop item or a plant picked to propagate.
export const cancelPlacing = (world) => {
  Object.assign(world, { placing: null, moving: null });
};

// Wallpaper goes straight up when bought, over whatever was there before, and is kept to put back up any time.
export const buyWallpaper = (world, offer) => {
  if (offer.sold || world.coins < offer.price) return;
  world.wallpaper = makeWallpaper(mulberry32(offer.seed));
  world.wallpapers.push(world.wallpaper);
  world.coins -= offer.price;
  offer.sold = true;
  world.placing = null;
};

// Put a wallpaper bought before back up, or none (null) for plain black. Free.
export const hangWallpaper = (world, wp) => {
  world.wallpaper = wp;
};

export const placeItem = (world, x, y) => {
  const { kind, seed, offer, price } = world.placing;
  const decor = !['bug', 'fish', 'flier', 'fountain'].includes(kind) && build(world, kind, seed, x, y);
  if (decor === null) return; // nothing to stand on near there: keep holding it
  world.placing = null;
  if (world.coins < price || offer?.sold) return;
  if (kind === 'bug') {
    if (!addBug(world, x, y, offer.genes, offer.name)) return; // the tank is full
  } else if (kind === 'fish') {
    world.fish.push(newFish(world, x, y, offer.genome, offer.name));
  } else if (kind === 'flier') {
    if (world.fliers.length >= params.maxFliers) return;
    addFlier(world, x, y, offer.genome, offer.name);
  } else if (kind === 'fountain') {
    placeFountain(world.terrain, x, y, world.rand);
  } else {
    addDecor(world, decor);
  }
  world.coins -= price;
  if (offer) offer.sold = true;
};

// A showcased offer: a particular bug, plant, stick or wallpaper, priced by how special it is.
export const makeOffer = (world, kind) => {
  const offer = { id: ++world.offers, kind, seed: Math.floor(world.rand() * 2 ** 31), sold: false };
  if (kind === 'bug') {
    // Bugs come as stick insects or one of the fliers (ladybugs, shield bugs and soldier beetles), each with its own
    // genome.
    const type = world.rand();
    if (type < 0.55) {
      const kind = type < 0.25 ? 'ladybug' : type < 0.4 ? 'shieldbug' : 'soldier';
      const genome = makeFlier(mulberry32(offer.seed), kind);
      return { ...offer, type: 'flier', genome, name: flierName(world.rand, kind), price: flierPrice(genome) };
    }
    const genes = randomGenes(world.rand, params.variety);
    const rarity = GENES.reduce((n, g) => n + Math.abs(genes[g.key]) / g.spread, 0) / GENES.length;
    const pattern = [0, 15, 40][patternRarity(genes)]; // a rare pattern, or a rarer one
    return { ...offer, genes, name: randomName(world.rand), price: 10 + Math.round(rarity * 60) + pattern };
  }
  if (kind === 'fish') {
    const genome = makeGuppy(mulberry32(offer.seed));
    return { ...offer, genome, name: guppyName(world.rand), price: guppyPrice(genome) };
  }
  if (kind === 'plant') {
    // Plants come in four types, each with its own genome: flowering plants, clump plants (a crown of leaves
    // with flower stalks or runners), grass and hanging vines.
    const type = world.rand();
    if (type < 0.2) {
      const g = makeGrass(mulberry32(offer.seed));
      return { ...offer, type: 'grass', name: g.name, price: 6 + Math.round(g.height) + (g.blossom ? 3 : 0) };
    }
    if (type < 0.4) {
      const g = makeVine(mulberry32(offer.seed));
      return { ...offer, type: 'vine', name: g.name, price: 8 + Math.round(g.maxNodes / 3) + (g.flower ? 3 : 0) };
    }
    if (type < 0.65) {
      const sp = makeClump(mulberry32(offer.seed));
      const showy = sp.form === 'strelitzia' ? 8 : sp.flower ? 4 : 0;
      const price = 8 + Math.round(sp.leafLen / 4) + showy + (sp.premium ?? 0) + rarePrice(sp);
      return { ...offer, type: 'clump', name: sp.name, price };
    }
    const sp = makeSpecies(mulberry32(offer.seed));
    return { ...offer, name: sp.name, price: 6 + sp.maxNodes + Math.round(sp.flower.size * 3) + rarePrice(sp) };
  }
  if (kind === 'wallpaper') {
    const wp = makeWallpaper(mulberry32(offer.seed));
    return { ...offer, name: wp.name, price: 6 + 2 * wp.detail + (wp.vivid ? 15 : 0) };
  }
  const stick = makeStick(mulberry32(offer.seed), { x: world.W, y: world.ground.y0 }, 2 * world.W, world.H); // whole
  return { ...offer, name: stick.name, price: 4 + 2 * Math.min(stick.pieces.length, 12) };
};

// Fill the showcase with fresh offers.
export const rerollShop = (world) => {
  const offers = (kind) => Array.from({ length: OFFERS }, () => makeOffer(world, kind));
  world.shop = Object.fromEntries(SHOP_KINDS.map((kind) => [kind, offers(kind)]));
  if (world.placing?.offer) world.placing = null;
};

// Rerolling: the first reroll in a minute is free, then each one after it that minute costs REROLL_STEP more
// than the last (10, 20, 30...). A minute after the free one, the next is free again and the prices start over.
export const FREE_REROLL_TICKS = 3600;
const REROLL_STEP = 10;

const freshRerolls = (world) => !world.rerolls || world.time - world.rerolls.since >= FREE_REROLL_TICKS;

export const rerollCost = (world) => (freshRerolls(world) ? 0 : world.rerolls.count * REROLL_STEP);

// Ticks until the next free reroll; 0 when it's free now.
export const freeRerollIn = (world) =>
  freshRerolls(world) ? 0 : world.rerolls.since + FREE_REROLL_TICKS - world.time;

export const buyReroll = (world) => {
  const cost = rerollCost(world);
  if (world.coins < cost) return;
  world.coins -= cost;
  if (cost === 0) world.rerolls = { since: world.time, count: 1 };
  else world.rerolls.count++;
  rerollShop(world);
};

// Put an offer into a scratch world, fully grown (or for wallpaper, hung), for its picture. Returns the box
// around it.
export const stageOffer = (world, offer) => {
  const x = world.W / 2;
  const box = (pts, pad) => {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      x0: Math.min(...xs) - pad,
      y0: Math.min(...ys) - pad,
      x1: Math.max(...xs) + pad,
      y1: Math.max(...ys) + pad,
    };
  };
  if ((offer.type ?? offer.kind) === 'flier') {
    // On the floor, facing right.
    const b = Object.assign(newFlier(world, x, world.ground.y0, offer.genome), { mode: 'ground', dir: 1 });
    world.fliers.push(b);
    const { len, high } = flierShape(offer.genome);
    return { x0: x - len / 2 - 1, x1: x + len / 2 + 2, y0: b.y - high - 2, y1: b.y + 1 };
  }
  if (offer.kind === 'bug') {
    const bug = newBug(world, x, 0, offer.genes);
    const floor = floorAt(world, x);
    land(world, bug, floor, project(floor, x, world.ground.y0), 1);
    bodyPose(floor, bug.s, bug.dir, 1, bug.t).forEach((p, i) =>
      Object.assign(bug.pts[i], { x: p.x, y: p.y, px: p.x, py: p.y }),
    );
    world.bugs.push(bug);
    for (let i = 0; i < 6; i++) step(world);
    const reach = bug.t.antenna * bug.t.size;
    const b = box([...bug.pts, ...bug.legs.map((l) => l.foot).filter(Boolean)], 3);
    return { x0: b.x0 - reach, x1: b.x1 + reach, y0: b.y0 - reach * 0.5, y1: world.ground.y0 + 2 };
  }
  if (offer.kind === 'fish') {
    // Side on, facing right, mid-stroke.
    const fish = Object.assign(newFish(world, x, world.H / 2, offer.genome), { facing: 1, tail: 1 });
    world.fish.push(fish);
    const { len, tail, spread, dorsal } = fishShape(offer.genome);
    return { x0: x - len / 2 - tail - 2, x1: x + len / 2 + 2, y0: fish.y - spread - dorsal, y1: fish.y + spread + 1 };
  }
  if (offer.kind === 'wallpaper') {
    world.wallpaper = offer.wallpaper ?? makeWallpaper(mulberry32(offer.seed)); // one already bought, or on offer
    return { x0: 0, y0: 0, x1: world.W, y1: world.H };
  }
  const kind = offer.type ?? offer.kind;
  if (kind === 'vine') {
    // Nothing to hang from in a scratch world, so it hangs from the top, fully grown.
    const vine = addDecor(world, build(world, kind, offer.seed, x, 30));
    while (vine.nodes.length < vine.genome.maxNodes) growVine(world, vine, vine.genome.growTicks);
    for (let i = 0; i < 300; i++) growVine(world, vine, 0);
    return { ...box(vine.nodes, 4 + 5 * vine.genome.leafSize), y0: 0 };
  }
  if (kind === 'grass') {
    const patch = addDecor(world, build(world, kind, offer.seed, x, world.H));
    for (let i = 0; i < 8000 && patch.tufts.length < 10; i++) growGrass(world, patch, 4); // a small sample patch
    for (let i = 0; i < 400; i++) growGrass(world, patch, 4);
    const tops = patch.tufts.map((t) => ({ x: t.x, y: t.y - patch.genome.height }));
    return { ...box(tops, 4), y1: world.ground.y0 + 2 };
  }
  const obj = addDecor(world, build(world, kind, offer.seed, x, world.H));
  if (obj.kind === 'plant') {
    const sp = obj.species;
    const growing = () => obj.stems.some((st) => st.growing || st.sprout > 0 || (st.bud && st.flower < 1));
    const busy = () => growing() || (sp.form && !crownFull(obj));
    for (let i = 0; i < 20000 && busy(); i++) growPlant(world, obj, sp.form ? 10 : 4);
    const pad = sp.form ? 3 + sp.leafWidth + 6 * (sp.flower?.size ?? 0) : 8 + sp.flower.size * 6;
    const b = box(obj.stems.flatMap((st) => [st.root, st.tip]), pad);
    return { ...b, y1: world.ground.y0 + 2 };
  }
  const b = box(obj.segs.flatMap((g) => [g.root, g.tip]), 6 * obj.foliage.size);
  return { ...b, y1: world.ground.y0 + 2 };
};
