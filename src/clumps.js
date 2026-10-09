// Random clump plant species: a crown of leaves straight from the ground, then flower stalks or runners, in fifteen
// forms of house plant, each with its own names, leaves and habit. Pure generators.
import { hsl, pick, range } from './geom.js';
import { rareLeaves } from './species.js';

// Clump plants grow a crown of leaves straight from the base instead of up a stem, plus flower stalks or runners
// once the crown is full. Each form has its own names, leaf shape and habit; colours and sizes vary within it.
// Lengths are px; leafWidth is half a leaf's width at its widest; fan is how far (radians) the outer leaves lean
// from upright; curl how much each few px of a leaf turns toward hanging down, so a leaf arches over; crown is how
// far either side of the middle leaves come out of the ground.
const CLUMP_FORMS = {
  // Big paddle leaves on long stalks, and now and then a stalk with an orange-crested bird of a flower.
  strelitzia: (rand) => ({
    name: pick(rand, ['Strelitzia', 'Bird of paradise', 'Crane flower']),
    leaf: { h: range(rand, 120, 150), s: range(rand, 25, 45), l: range(rand, 26, 34) },
    stem: { h: range(rand, 95, 125), s: range(rand, 25, 40), l: range(rand, 30, 38) },
    shape: 'paddle',
    leaves: 5 + Math.floor(rand() * 4),
    leafLen: range(rand, 38, 55),
    leafWidth: range(rand, 3.6, 5),
    petiole: range(rand, 0.4, 0.55),
    fan: range(rand, 0.3, 0.5),
    curl: range(rand, 0.01, 0.03),
    crown: 2,
    stripe: null,
    bands: false,
    stalks: 1 + Math.floor(rand() * 2),
    stalkLen: range(rand, 0.95, 1.1), // of leafLen
    stalkCurl: 0.01,
    flower: {
      kind: 'bird',
      size: range(rand, 1.3, 1.8),
      // Orange, or now and then yellow.
      crest:
        rand() < 0.15
          ? { h: 50, s: 90, l: 60 }
          : { h: range(rand, 22, 38), s: range(rand, 85, 95), l: range(rand, 52, 60) },
      tongue: { h: range(rand, 220, 245), s: range(rand, 60, 80), l: range(rand, 45, 58) },
      beak: { h: range(rand, 110, 140), s: range(rand, 25, 40), l: range(rand, 28, 36) },
      blush: { h: range(rand, 330, 350), s: range(rand, 35, 55), l: range(rand, 32, 42) },
    },
  }),
  // A tall tussock of grass that stays put (it doesn't spread), arching over like a fountain, with feathery plumes.
  tussock: (rand) => {
    const leaf = pick(rand, [
      () => ({ h: range(rand, 80, 120), s: range(rand, 35, 55), l: range(rand, 30, 40) }), // green
      () => ({ h: range(rand, 170, 200), s: range(rand, 12, 25), l: range(rand, 42, 50) }), // blue-grey
      () => ({ h: range(rand, 345, 372), s: range(rand, 25, 40), l: range(rand, 26, 34) }), // burgundy
      () => ({ h: range(rand, 45, 58), s: range(rand, 45, 60), l: range(rand, 40, 48) }), // golden
    ])();
    return {
      name: pick(rand, ['Pampas grass', 'Fountain grass', 'Feather grass', 'Miscanthus', 'Muhly grass', 'Oat grass']),
      leaf,
      stem: { h: range(rand, 38, 50), s: range(rand, 25, 40), l: range(rand, 50, 60) },
      shape: 'blade',
      leaves: 14 + Math.floor(rand() * 9),
      leafLen: range(rand, 35, 60),
      leafWidth: range(rand, 0.5, 0.8),
      petiole: 0,
      fan: range(rand, 0.3, 0.55),
      curl: range(rand, 0.025, 0.06),
      crown: 3,
      stripe: null,
      bands: false,
      stalks: 2 + Math.floor(rand() * 4),
      stalkLen: range(rand, 1.1, 1.35),
      stalkCurl: range(rand, 0.02, 0.05),
      flower: {
        kind: 'plume',
        size: range(rand, 0.8, 1.3),
        color: pick(rand, [
          { h: 40, s: 40, l: 75 }, // buff
          { h: 45, s: 30, l: 85 }, // cream
          { h: 340, s: 45, l: 75 }, // pink
          { h: 290, s: 30, l: 58 }, // purple
          { h: 20, s: 45, l: 55 }, // rust
        ]),
      },
    };
  },
  // A rosette of arching striped leaves that sends out runners: they arch out and hang down with little white
  // flowers along them and a baby plant at the end.
  spider: (rand) => {
    const cream = { h: range(rand, 50, 60), s: range(rand, 35, 50), l: range(rand, 82, 90) };
    const r = rand();
    return {
      name: pick(rand, ['Spider plant', 'Chlorophytum', 'Airplane plant', 'Ribbon plant', 'Hen and chickens']),
      leaf: { h: range(rand, 90, 120), s: range(rand, 40, 60), l: range(rand, 34, 44) },
      stem: { h: range(rand, 60, 75), s: range(rand, 30, 45), l: range(rand, 58, 66) },
      shape: 'strap',
      leaves: 9 + Math.floor(rand() * 6),
      leafLen: range(rand, 18, 30),
      leafWidth: range(rand, 1, 1.5),
      petiole: 0,
      fan: range(rand, 0.5, 0.8),
      curl: range(rand, 0.12, 0.22),
      crown: 1.5,
      stripe: r < 0.55 ? { where: 'centre', ...cream } : r < 0.8 ? { where: 'edge', ...cream } : null,
      bands: false,
      stalks: 2 + Math.floor(rand() * 3),
      stalkLen: range(rand, 1.8, 2.8),
      stalkCurl: range(rand, 0.14, 0.22),
      flower: { kind: 'runner', size: range(rand, 0.8, 1.2), color: { h: 60, s: 20, l: 95 } },
    };
  },
  // Stiff upright sword leaves with wavy pale bands across them, sometimes yellow-edged.
  sword: (rand) => {
    const leaf = { h: range(rand, 100, 140), s: range(rand, 30, 50), l: range(rand, 22, 30) };
    return {
      name: pick(rand, ['Snake plant', 'Sansevieria', "Mother-in-law's tongue", 'Bowstring hemp']),
      leaf,
      stem: leaf,
      shape: 'sword',
      leaves: 5 + Math.floor(rand() * 5),
      leafLen: range(rand, 30, 52),
      leafWidth: range(rand, 1.4, 2.2),
      petiole: 0,
      fan: range(rand, 0.15, 0.35),
      curl: range(rand, 0, 0.02),
      crown: 3,
      stripe:
        rand() < 0.5 ? { where: 'edge', h: range(rand, 50, 60), s: range(rand, 60, 80), l: range(rand, 55, 65) } : null,
      bands: true,
      stalks: 0,
      stalkLen: 1,
      stalkCurl: 0,
      flower: null,
    };
  },

  // Common house plants. Each leaves out what it doesn't have (see CLUMP_DEFAULTS); shapes past the four above:
  // lance, heart, monstera (split heart) and coin blades on stalks, pinnate fronds (leaflets along a stalk), fleshy
  // succulent leaves, and cactus columns. pattern marks a blade: feather (dark bars), silver (patches), veins
  // (pale ones), spots (pale dots); teeth edge a fleshy leaf, tips colour its tip. premium adds to the price.

  // Glossy dark lance leaves on stalks, and white hooded flowers.
  peaceLily: (rand) => ({
    name: pick(rand, ['Peace lily', 'Spathiphyllum']),
    leaf: hsl(rand, [120, 145], [35, 50], [22, 30]),
    stem: hsl(rand, [100, 125], [30, 45], [28, 36]),
    shape: 'lance',
    leaves: 7 + Math.floor(rand() * 5),
    leafLen: range(rand, 28, 40),
    leafWidth: range(rand, 2.4, 3.2),
    petiole: range(rand, 0.35, 0.5),
    fan: range(rand, 0.4, 0.65),
    curl: range(rand, 0.03, 0.07),
    stalks: 1 + Math.floor(rand() * 3),
    stalkLen: range(rand, 1, 1.2),
    stalkCurl: 0.02,
    flower: {
      kind: 'spathe',
      hood: true,
      size: range(rand, 1, 1.4),
      spathe: { h: 60, s: 15, l: 94 },
      spadix: { h: 55, s: 45, l: 78 },
    },
  }),
  // Heart leaves on stalks, and glossy red (or pink, or white) hearts of flowers, each with a yellow spike.
  anthurium: (rand) => ({
    name: pick(rand, ['Anthurium', 'Flamingo flower', 'Laceleaf']),
    leaf: hsl(rand, [115, 140], [35, 50], [24, 32]),
    stem: hsl(rand, [100, 125], [30, 45], [30, 38]),
    shape: 'heart',
    leaves: 5 + Math.floor(rand() * 4),
    leafLen: range(rand, 26, 36),
    leafWidth: range(rand, 3, 4),
    petiole: range(rand, 0.4, 0.55),
    fan: range(rand, 0.45, 0.7),
    curl: range(rand, 0.03, 0.06),
    stalks: 1 + Math.floor(rand() * 3),
    stalkLen: range(rand, 0.9, 1.1),
    stalkCurl: 0.03,
    flower: {
      kind: 'spathe',
      hood: false,
      size: range(rand, 1.1, 1.5),
      spathe: pick(rand, [
        { h: 355, s: 80, l: 45 },
        { h: 340, s: 60, l: 65 },
        { h: 10, s: 85, l: 50 },
        { h: 60, s: 15, l: 92 },
      ]),
      spadix: { h: 50, s: 70, l: 62 },
    },
    premium: 6,
  }),
  // Big split hearts on long stalks.
  monstera: (rand) => ({
    name: pick(rand, ['Monstera', 'Swiss cheese plant', 'Split-leaf philodendron']),
    leaf: hsl(rand, [120, 145], [35, 50], [22, 30]),
    stem: hsl(rand, [100, 120], [30, 45], [30, 38]),
    shape: 'monstera',
    leaves: 4 + Math.floor(rand() * 4),
    leafLen: range(rand, 36, 50),
    leafWidth: range(rand, 6, 7.5),
    petiole: range(rand, 0.5, 0.58),
    fan: range(rand, 0.5, 0.8),
    curl: range(rand, 0.04, 0.08),
    premium: 8,
  }),
  // Arrow-shaped leaves held up on long stalks, with pale veins.
  alocasia: (rand) => ({
    name: pick(rand, ['Alocasia', 'Elephant ear', 'African mask']),
    leaf: hsl(rand, [125, 160], [30, 45], [16, 24]),
    stem: hsl(rand, [95, 120], [25, 40], [32, 40]),
    shape: 'heart',
    pattern: 'veins',
    leaves: 3 + Math.floor(rand() * 3),
    leafLen: range(rand, 34, 48),
    leafWidth: range(rand, 3.6, 4.8),
    petiole: range(rand, 0.5, 0.62),
    fan: range(rand, 0.3, 0.55),
    curl: range(rand, 0.01, 0.03),
    premium: 6,
  }),
  // Patterned paddles: dark feathered bars either side of the midrib.
  calathea: (rand) => ({
    name: pick(rand, ['Calathea', 'Prayer plant', 'Rattlesnake plant', 'Peacock plant']),
    leaf: hsl(rand, [95, 130], [30, 45], [36, 44]),
    stem: hsl(rand, [90, 120], [25, 40], [30, 38]),
    shape: 'lance',
    pattern: 'feather',
    leaves: 6 + Math.floor(rand() * 5),
    leafLen: range(rand, 24, 34),
    leafWidth: range(rand, 2.6, 3.4),
    petiole: range(rand, 0.35, 0.45),
    fan: range(rand, 0.4, 0.7),
    curl: range(rand, 0.02, 0.05),
    premium: 4,
  }),
  // Lance leaves splashed with silver.
  aglaonema: (rand) => ({
    name: pick(rand, ['Chinese evergreen', 'Aglaonema']),
    leaf: hsl(rand, [110, 140], [30, 45], [24, 32]),
    stem: hsl(rand, [95, 120], [20, 35], [40, 48]),
    shape: 'lance',
    pattern: 'silver',
    leaves: 6 + Math.floor(rand() * 4),
    leafLen: range(rand, 22, 32),
    leafWidth: range(rand, 2.2, 3),
    petiole: range(rand, 0.25, 0.35),
    fan: range(rand, 0.4, 0.65),
    curl: range(rand, 0.04, 0.08),
  }),
  // Round coin leaves on long thin stalks, every way out from the middle.
  pilea: (rand) => ({
    name: pick(rand, ['Chinese money plant', 'Pilea', 'Pancake plant']),
    leaf: hsl(rand, [95, 120], [40, 55], [34, 42]),
    stem: hsl(rand, [90, 110], [30, 45], [38, 46]),
    shape: 'coin',
    leaves: 8 + Math.floor(rand() * 6),
    leafLen: range(rand, 18, 24),
    leafWidth: range(rand, 3, 3.8),
    petiole: range(rand, 0.6, 0.68),
    fan: range(rand, 0.7, 1.1),
    curl: range(rand, 0.02, 0.05),
    crown: 1,
  }),
  // Upright stalks of paired glossy oval leaflets.
  zz: (rand) => ({
    name: pick(rand, ['ZZ plant', 'Zanzibar gem', 'Zamioculcas']),
    leaf: hsl(rand, [120, 145], [40, 55], [22, 30]),
    stem: hsl(rand, [100, 125], [35, 50], [26, 34]),
    shape: 'pinnate',
    leaflet: { len: range(rand, 3.5, 5), width: range(rand, 1.6, 2.2), spacing: range(rand, 4, 5), angle: 0.9 },
    leaves: 5 + Math.floor(rand() * 4),
    leafLen: range(rand, 26, 40),
    leafWidth: 1,
    petiole: range(rand, 0.15, 0.25),
    fan: range(rand, 0.25, 0.45),
    curl: range(rand, 0.01, 0.03),
  }),
  // Arching fronds thick with little leaflets.
  fern: (rand) => ({
    name: pick(rand, ['Boston fern', 'Sword fern', 'Bird\'s nest fern', 'Asparagus fern']),
    leaf: hsl(rand, [85, 115], [45, 60], [32, 42]),
    stem: hsl(rand, [85, 110], [35, 50], [28, 36]),
    shape: 'pinnate',
    leaflet: { len: range(rand, 2.5, 4), width: 1, spacing: 2, angle: range(rand, 0.9, 1.2), droop: 0.2 },
    leaves: 12 + Math.floor(rand() * 7),
    leafLen: range(rand, 22, 36),
    leafWidth: 1,
    petiole: 0.1,
    fan: range(rand, 0.6, 0.9),
    curl: range(rand, 0.1, 0.18),
  }),
  // A few long arching fronds on bare stems, the leaflets long and narrow and drooping.
  palm: (rand) => ({
    name: pick(rand, ['Parlor palm', 'Areca palm', 'Kentia palm', 'Majesty palm']),
    leaf: hsl(rand, [95, 130], [35, 50], [30, 38]),
    stem: hsl(rand, [80, 105], [30, 45], [32, 40]),
    shape: 'pinnate',
    leaflet: {
      len: range(rand, 5, 8),
      width: 1,
      spacing: range(rand, 2, 3),
      angle: range(rand, 0.5, 0.7),
      droop: 0.5,
    },
    leaves: 4 + Math.floor(rand() * 4),
    leafLen: range(rand, 38, 56),
    leafWidth: 1,
    petiole: range(rand, 0.25, 0.35),
    fan: range(rand, 0.3, 0.55),
    curl: range(rand, 0.05, 0.1),
    premium: 4,
  }),
  // Thick, fleshy, toothed leaves, often spotted, and now and then a tall spike of orange tubes.
  aloe: (rand) => ({
    name: pick(rand, ['Aloe vera', 'Aloe', 'Tiger aloe']),
    leaf: hsl(rand, [120, 150], [15, 30], [36, 46]),
    stem: hsl(rand, [100, 130], [15, 25], [40, 48]),
    shape: 'fleshy',
    pattern: rand() < 0.6 ? 'spots' : null,
    teeth: true,
    leaves: 7 + Math.floor(rand() * 5),
    leafLen: range(rand, 20, 30),
    leafWidth: range(rand, 2, 2.8),
    fan: range(rand, 0.4, 0.7),
    curl: range(rand, 0.03, 0.08),
    stalks: rand() < 0.6 ? 1 : 0,
    stalkLen: range(rand, 1.6, 2.1),
    stalkCurl: 0.01,
    flower: { kind: 'bells', size: 1, color: { h: range(rand, 15, 30), s: 85, l: 55 } },
  }),
  // A low rosette of plump pointed leaves, blue-grey and blushing at the tips, and an arching spray of coral bells.
  echeveria: (rand) => ({
    name: pick(rand, ['Echeveria', 'Mexican snowball', 'Painted lady']),
    leaf: hsl(rand, [150, 190], [15, 30], [52, 62]),
    stem: hsl(rand, [100, 140], [20, 30], [42, 50]),
    shape: 'fleshy',
    tips: hsl(rand, [330, 360], [40, 60], [60, 70]),
    leaves: 14 + Math.floor(rand() * 7),
    leafLen: range(rand, 7, 11),
    leafWidth: range(rand, 1.6, 2.2),
    fan: range(rand, 1, 1.35),
    curl: range(rand, 0.02, 0.06),
    crown: 1,
    stalks: 1 + Math.floor(rand() * 2),
    stalkLen: range(rand, 2.2, 3),
    stalkCurl: range(rand, 0.1, 0.16),
    flower: { kind: 'bells', size: 0.9, color: { h: range(rand, 5, 25), s: 75, l: 62 } },
  }),
  // A few broad leaves low down, and a tall arching spike of flowers.
  orchid: (rand) => {
    const h = pick(rand, [300, 320, 340, 60, 280]);
    return {
      name: pick(rand, ['Moth orchid', 'Phalaenopsis', 'Orchid']),
      leaf: hsl(rand, [110, 140], [30, 45], [26, 34]),
      stem: hsl(rand, [90, 120], [20, 35], [32, 40]),
      shape: 'strap',
      leaves: 3 + Math.floor(rand() * 3),
      leafLen: range(rand, 14, 20),
      leafWidth: range(rand, 2.6, 3.4),
      fan: range(rand, 0.9, 1.2),
      curl: range(rand, 0.12, 0.2),
      stalks: 1 + Math.floor(rand() * 2),
      stalkLen: range(rand, 2.4, 3.2),
      stalkCurl: range(rand, 0.06, 0.1),
      flower: {
        kind: 'orchid',
        size: range(rand, 1, 1.3),
        count: 4 + Math.floor(rand() * 4),
        petal: h === 60 ? { h: 60, s: 15, l: 94 } : { h, s: range(rand, 45, 70), l: range(rand, 72, 84) },
        lip: { h: h === 60 ? 330 : h, s: 60, l: 45 },
      },
      premium: 10,
    };
  },
  // A rosette of glossy straps around a bright cone of bracts.
  bromeliad: (rand) => ({
    name: pick(rand, ['Bromeliad', 'Guzmania', 'Urn plant']),
    leaf: hsl(rand, [110, 140], [40, 55], [28, 36]),
    stem: hsl(rand, [100, 130], [35, 50], [30, 38]),
    shape: 'strap',
    leaves: 10 + Math.floor(rand() * 6),
    leafLen: range(rand, 20, 28),
    leafWidth: range(rand, 1.3, 1.8),
    fan: range(rand, 0.6, 0.9),
    curl: range(rand, 0.08, 0.14),
    crown: 1,
    stalks: 1,
    stalkLen: range(rand, 0.7, 0.9),
    stalkCurl: 0,
    flower: {
      kind: 'bract',
      size: range(rand, 1, 1.3),
      color: pick(rand, [
        { h: 355, s: 80, l: 50 },
        { h: 25, s: 90, l: 55 },
        { h: 50, s: 90, l: 55 },
        { h: 330, s: 70, l: 60 },
      ]),
    },
    premium: 4,
  }),
  // A few thick ribbed columns, covered in spines.
  cactus: (rand) => ({
    name: pick(rand, ['Cactus', 'Fairy castle', 'Old man cactus', 'Totem pole cactus']),
    leaf: hsl(rand, [105, 140], [30, 45], [26, 34]),
    stem: hsl(rand, [100, 130], [25, 40], [30, 36]),
    shape: 'column',
    spines: hsl(rand, [40, 60], [20, 40], [75, 88]),
    leaves: 1 + Math.floor(rand() * 4),
    leafLen: range(rand, 18, 40),
    leafWidth: range(rand, 2.6, 3.6),
    fan: range(rand, 0.12, 0.3),
    curl: 0,
    crown: 2,
  }),
};

const CLUMP_KINDS = Object.keys(CLUMP_FORMS);

// What a clump plant has unless its form says otherwise.
const CLUMP_DEFAULTS = {
  petiole: 0,
  crown: 2,
  stripe: null,
  bands: false,
  pattern: null,
  teeth: false,
  tips: null,
  stalks: 0,
  stalkLen: 1,
  stalkCurl: 0,
  flower: null,
  premium: 0,
};

// A random clump plant species.
export const makeClump = (rand) => {
  const form = pick(rand, CLUMP_KINDS);
  const sp = { form, speed: range(rand, 0.012, 0.022), ...CLUMP_DEFAULTS, ...CLUMP_FORMS[form](rand) };
  return rareLeaves(rand, sp);
};
