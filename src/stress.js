// Stress test: a tank packed with everything at once, timed. `npm run stress` times the simulation in node;
// stress.html, on the dev server, times the drawing too.
import { buyReroll, createWorld, pointerDown, pointerUp, startPlacing, step } from './sim.js';
import { paintTerrain } from './terrain.js';
import { params } from './tuning.js';

// A dirt bank on the left with grass, plants, clump plants, sticks and bugs on it; a pond walled in stone on the
// right, topped up by a fountain forever (so the terrain never rests), with plants, grass and fish in it; vines
// hanging over it all. The tank's life turned all the way up: the most fireflies, and leaves and flowers dropping as
// fast as they can. crowd puts in that many of every plant, clump plant, grass and vine, side by side.
export const stressWorld = (crowd = 1, W = 256, H = 341) => {
  Object.assign(params, { fireflies: 12, leafLife: 0.1, bloomLife: 0.1 });
  const world = createWorld(W, H, { seed: 7, scene: false });
  world.coins = 1e9;
  const floor = world.ground.y0;
  const paint = (x, y, m) => paintTerrain(world.terrain, x, y, m, 0, () => 0);
  const steps = (n) => {
    for (let i = 0; i < n; i++) step(world);
  };
  for (let y = floor - 40; y < floor; y += 2) for (let x = 0; x < 110; x += 2) paint(x, y, 'dirt');
  for (let y = floor - 70; y < floor; y += 2) for (const x of [118, 120, 250, 252]) paint(x, y, 'stone');
  steps(200);
  for (let y = floor - 60; y < floor; y += 2) for (let x = 122; x < 250; x += 2) paint(x, y, 'water');
  steps(200);
  const place = (kind, type, x, y) => {
    let offer;
    while (!(offer = world.shop[kind].find((o) => !o.sold && (o.type ?? o.kind) === type))) buyReroll(world);
    startPlacing(world, kind, offer);
    pointerDown(world, x, y);
    pointerUp(world, x, y);
  };
  for (const x of [55, 105]) place('stick', 'stick', x, floor - 45);
  for (let k = 0; k < crowd; k++) {
    for (const x of [15, 28, 40, 65, 82, 95]) place('plant', 'plant', x + k * 3, floor - 45);
    for (const x of [150, 190, 230]) place('plant', 'plant', x + k * 3, floor - 20);
    for (const x of [48, 72]) place('plant', 'clump', x + k * 3, floor - 45);
    place('plant', 'clump', 210 + k * 3, floor - 20);
    for (const x of [20, 80]) place('plant', 'grass', x + k * 5, floor - 45);
    place('plant', 'grass', 170 + k * 5, floor - 10);
    for (const x of [30, 100, 170, 220]) place('plant', 'vine', x + k * 6, 2);
  }
  for (let i = 0; i < 8; i++) place('fish', 'fish', 135 + i * 13, floor - 30);
  for (let i = 0; i < 8; i++) place('bug', 'bug', 10 + i * 12, floor - 120);
  startPlacing(world, 'fountain');
  pointerDown(world, 200, floor - 100);
  pointerUp(world, 200, floor - 100);
  // Grow it all at four times the speed, then let it run a while at the usual speed.
  const growth = params.plantGrowth;
  params.plantGrowth = 4;
  steps(5000);
  params.plantGrowth = growth;
  steps(600);
  return world;
};

// Times fn run n times: mean, 95th percentile and worst, in ms.
export const timeOf = (fn, n) => {
  const ms = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    fn(i);
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  const r = (v) => Math.round(v * 1000) / 1000;
  return { mean: r(ms.reduce((a, b) => a + b, 0) / n), p95: r(ms[Math.floor(n * 0.95)]), max: r(ms[n - 1]) };
};

export const census = (world) => ({
  plants: world.objects.filter((o) => o.kind === 'plant').length,
  leaves: world.objects.reduce((n, o) => n + (o.stems?.reduce((m, st) => m + st.leaves.length, 0) ?? 0), 0),
  tufts: world.objects.reduce((n, o) => n + (o.tufts?.length ?? 0), 0),
  vineNodes: world.objects.reduce((n, o) => n + (o.nodes?.length ?? 0), 0),
  bugs: world.bugs.length,
  fish: world.fish.length,
  ...Object.fromEntries(
    ['crumbs', 'debris', 'litter', 'fireflies', 'bubbles', 'motes', 'ripples']
      .filter((k) => world[k])
      .map((k) => [k, world[k].length]),
  ),
});

// `node src/stress.js [crowd]`
if (globalThis.process?.argv[1]?.endsWith('stress.js')) {
  let t = performance.now();
  const world = stressWorld(Number(process.argv[2] ?? 1));
  console.log(`built in ${Math.round(performance.now() - t)} ms`, census(world));
  console.log('step, ms over 6000 ticks:', timeOf(() => step(world), 6000));
  console.log(census(world));
}
