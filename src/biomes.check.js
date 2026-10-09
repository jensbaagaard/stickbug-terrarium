// Run with `node src/biomes.check.js`: a tank takes its biome from what it's made of (sand a desert, and with a pond
// an oasis; snow a tundra; basalt volcanic; brownstone a canyon; stone crags; dirt and water a wetland; wood a
// woodland; grass a meadow; water all over a sea; a plant alone a garden; nothing a bare tank). A desert's white lotus
// seeds itself on the sand, only one, and flowers; a wetland's pink lotus comes up out of the shallows; which wild
// flowers have turned up is saved. Each biome's goings-on come and go, the tumbleweeds rolling over the ground (never
// into it) and the jellyfish keeping to the water.
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
  assert.equal(biome(createWorld(256, 341, { seed: 1, scene: false })), 'bare');
  assert.equal(biome(createWorld(256, 341, { seed: 1 })), 'garden', 'the starting tank: one plant');
  assert.equal(biome(tank(of(SAND))), 'desert');
  assert.equal(biome(tank(pond(SAND, 15))), 'oasis');
  assert.equal(biome(tank(of(SNOW))), 'tundra');
  assert.equal(biome(tank(of(BASALT))), 'volcanic');
  assert.equal(biome(tank(of(BROWNSTONE))), 'canyon');
  assert.equal(biome(tank(of(STONE))), 'crags');
  assert.equal(biome(tank(pond(DIRT, 14))), 'wetland');
  assert.equal(biome(tank(of(WOOD))), 'woodland');
  const meadow = tank(of(DIRT));
  meadow.objects.push({ kind: 'grass', base: { x: 0, y: 0 } }, { kind: 'grass', base: { x: 0, y: 0 } });
  assert.equal(biome(meadow), 'meadow');
  assert.equal(biome(tank((r, c, cols) => (c === 0 || c === cols - 1 ? STONE : WATER), 160)), 'sea');
}

{
  // A desert, its wild flower coming up every time it might: one white lotus, on the sand, and only the one; it grows
  // and flowers; and a reload remembers it turned up.
  params.wildFlowers = 50;
  const desert = tank(of(SAND));
  steps(desert, 700);
  const lotuses = () => desert.objects.filter((o) => o.species?.wild === 'whiteLotus');
  assert.equal(lotuses().length, 1, 'a white lotus seeds itself in the desert');
  const [lotus] = lotuses();
  assert.equal(cell(desert, lotus.base.x, lotus.base.y + 1), SAND, 'on the sand');
  assert.ok(desert.found.includes('whiteLotus') && desert.news, 'and the news is out');
  steps(desert, 8000);
  assert.equal(lotuses().length, 1, 'one of a kind');
  assert.ok(lotus.stems.some((st) => st.flower > 0.5), 'it flowers');
  assert.equal(lotus.species.flower.form, 'lotus');
  const back = importWorld(JSON.parse(JSON.stringify(exportWorld(desert))), 256, 341, 2);
  assert.ok(back.found.includes('whiteLotus'), 'which have turned up is saved');
  assert.equal(back.objects.find((o) => o.species?.wild)?.species.wild, 'whiteLotus', 'and the lotus with it');

  // A wetland's pink lotus roots in the shallows, under the water.
  const wetland = tank(pond(DIRT, 14));
  steps(wetland, 700);
  const pink = wetland.objects.find((o) => o.species?.wild === 'pinkLotus');
  assert.ok(pink, 'a pink lotus comes up in the wetland');
  assert.equal(cell(wetland, pink.base.x, pink.base.y - 1), WATER, 'out of the water');
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
    ['crags', tank(cave), ['drips']],
    ['wetland', tank(pond(DIRT, 14)), ['wisps', 'rain']],
    ['woodland', tank(of(WOOD)), ['mushrooms']],
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
