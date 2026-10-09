// Run with `node src/biomes.check.js`: a tank takes its biome from what it's made of (sand, with a pond or not, or
// brownstone a desert; snow a tundra; basalt volcanic; stone, dirt and water, wood or grass the wilds; water all over
// a sea; anything else a garden). A biome's wild flowers come up at random, one of each kind at most: in a desert a
// white lotus on the sand (which flowers) and a paintbrush, and by a pond a blue lotus out of the shallows; in the
// wilds a pink lotus out of a pond's shallows. Which have turned up is saved. Each biome's goings-on come and go, the
// tumbleweeds rolling over the ground (never into it) and the jellyfish keeping to the water.
import assert from 'node:assert/strict';
import { createWorld, exportWorld, importWorld, step } from './sim.js';
import { surveyOf } from './biomes.js';
import { snowing } from './life.js';
import { BASALT, BROWNSTONE, CELL, cellAt, DIRT, EMPTY, SAND, SNOW, STONE, WATER, WOOD } from './terrain.js';
import { params } from './tuning.js';

// An empty tank (no plants, no bug), its bottom `deep` rows filled in by fill(r, c), r counted down from the top of
// the fill.
const tank = (fill, deep = 40) => {
  const world = createWorld(256, 341, { seed: 3, scene: false });
  const { cols, rows, cells } = world.terrain;
  for (let r = rows - deep; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells[r * cols + c] = fill(r - (rows - deep), c, cols);
  }
  Object.assign(world.terrain, { skyDirty: true, version: world.terrain.version + 1 }); // its outline, next step
  return world;
};
const of = (m) => () => m;
// A pond in the top `depth` rows of the fill, across all but the ends.
const pond = (m, depth) => (r, c, cols) => (r < depth && c > 4 && c < cols - 5 ? WATER : m);
const biome = (world) => surveyOf(world).biome.key;
const cell = (world, x, y) => world.terrain.cells[cellAt(world.terrain, x, y)];
const steps = (world, n, each = () => {}) => {
  for (let i = 0; i < n; i++) {
    step(world);
    each();
  }
};

{
  assert.equal(biome(createWorld(256, 341, { seed: 1, scene: false })), 'garden', 'nothing in it');
  assert.equal(biome(createWorld(256, 341, { seed: 1 })), 'garden', 'the starting tank: one plant');
  assert.equal(biome(tank(of(SAND))), 'desert');
  assert.equal(biome(tank(pond(SAND, 15))), 'desert', 'with a pond');
  assert.equal(biome(tank(of(BROWNSTONE))), 'desert', 'of brownstone');
  assert.equal(biome(tank(of(SNOW))), 'tundra');
  assert.equal(biome(tank(of(BASALT))), 'volcanic');
  assert.equal(biome(tank(of(STONE))), 'wilds', 'rocky crags');
  assert.equal(biome(tank(pond(DIRT, 14))), 'wilds', 'a wetland');
  assert.equal(biome(tank(of(WOOD))), 'wilds', 'a wood');
  const meadow = tank(of(DIRT));
  meadow.objects.push({ kind: 'grass', base: { x: 0, y: 0 } }, { kind: 'grass', base: { x: 0, y: 0 } });
  assert.equal(biome(meadow), 'wilds', 'a meadow');
  assert.equal(biome(tank((r, c, cols) => (c === 0 || c === cols - 1 ? STONE : WATER), 160)), 'sea');
}

{
  // Wild flowers coming up every time they might: in a sandy desert a white lotus on the sand and a paintbrush, one of
  // each, the lotus growing and flowering; a reload remembers they turned up.
  params.wildFlowers = 50;
  const desert = tank(of(SAND));
  const wild = (world, key) => world.objects.filter((o) => o.species?.wild === key);
  steps(desert, 3700);
  assert.equal(wild(desert, 'whiteLotus').length, 1, 'a white lotus seeds itself in the desert');
  assert.equal(wild(desert, 'paintbrush').length, 1, 'and a paintbrush');
  assert.equal(wild(desert, 'blueLotus').length, 0, 'but no blue lotus, without water');
  const [lotus] = wild(desert, 'whiteLotus');
  assert.equal(cell(desert, lotus.base.x, lotus.base.y + 1), SAND, 'on the sand');
  assert.ok(desert.found.includes('whiteLotus') && desert.news, 'and the news is out');
  steps(desert, 8000);
  assert.equal(wild(desert, 'whiteLotus').length, 1, 'one of each kind');
  assert.ok(lotus.stems.some((st) => st.flower > 0.5), 'it flowers');
  assert.equal(lotus.species.flower.form, 'lotus');
  const back = importWorld(JSON.parse(JSON.stringify(exportWorld(desert))), 256, 341, 2);
  assert.ok(back.found.includes('whiteLotus'), 'which have turned up is saved');
  assert.equal(wild(back, 'whiteLotus').length, 1, 'and the lotus with it');

  // A pond in the desert: a blue lotus roots in its shallows, under the water; and in the wilds, a pink one.
  for (const [world, key] of [
    [tank(pond(SAND, 15)), 'blueLotus'],
    [tank(pond(DIRT, 14)), 'pinkLotus'],
  ]) {
    steps(world, 3700);
    const [lotus] = wild(world, key);
    assert.ok(lotus, `a ${key} comes up`);
    assert.equal(cell(world, lotus.base.x, lotus.base.y - 1), WATER, 'out of the water');
    for (const o of world.objects) assert.equal(wild(world, o.species.wild).length, 1, 'one of each kind');
  }
  params.wildFlowers = 1;
}

{
  // Each biome, its goings-on coming twenty times as often: they come, and nothing goes wrong.
  params.biomeLife = 20;
  const cave = (r, c) => (r >= 15 && r < 25 && c > 20 && c < 60 ? EMPTY : STONE); // overhangs to drip from
  const lake = (r, c, cols) => (c === 0 || c === cols - 1 ? STONE : WATER);
  const cases = [
    ['desert', tank(of(SAND)), ['tumbleweed', 'dustDevil']],
    ['volcanic', tank((r, c, cols) => (r < 6 && c > 40 && c < cols - 40 ? WATER : BASALT)), ['embers', 'steam']],
    ['wilds', tank(cave), ['drips']],
    ['wilds', tank(pond(DIRT, 14)), ['wisps', 'rain']],
    ['wilds', tank(of(WOOD)), ['mushrooms']],
    ['sea', tank(lake, 160), ['jellyfish']],
  ];
  for (const [key, world, kinds] of cases) {
    assert.equal(biome(world), key);
    const seen = new Set();
    steps(world, 6000, () => {
      for (const h of world.happenings) {
        seen.add(h.kind);
        if (h.kind === 'tumbleweed' && h.x > 0 && h.x < world.W) {
          assert.equal(cell(world, h.x, h.y + h.size - 1), EMPTY, 'a tumbleweed rolls over the ground, not into it');
        }
        if (h.kind === 'jellyfish' && h.age > 1) {
          assert.equal(cell(world, h.x, h.y), WATER, 'jellyfish keep to the water');
        }
      }
    });
    for (const kind of kinds) assert.ok(seen.has(kind), `${kind} in the ${key}`);
  }
  // In the tundra, now and then it snows.
  const tundra = tank(of(SNOW));
  let snowed = false;
  steps(tundra, 6000, () => (snowed ||= snowing(tundra)));
  assert.ok(snowed, 'a flurry in the tundra');
  params.biomeLife = 1;
}

console.log('ok');
