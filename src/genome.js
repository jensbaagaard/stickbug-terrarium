// Genes, traits, colours and names. Each bug carries an offset per gene slider; its traits are the
// slider values plus those offsets, clamped to the slider range.
import { GENES, PATTERNS, params } from './tuning.js';
import { clamp, hslHex, pick } from './geom.js';

// Random offsets: variety 0 makes clones of the sliders, 1 lets a gene land anywhere in its range. Two
// dice make middling bugs common and extreme ones rare.
export const randomGenes = (rand, variety) =>
  Object.fromEntries(GENES.map((g) => [g.key, (rand() + rand() - 1) * variety * g.spread]));

export const traitsOf = (genes) => {
  const t = {};
  for (const g of GENES) t[g.key] = clamp(params[g.key] + (genes[g.key] ?? 0), g.min, g.max);
  return t;
};

export const patternOf = (t) => PATTERNS[clamp(Math.round(t.pattern), 0, PATTERNS.length - 1)];

// Base colours: f runs 0..1 from head to tail.
export const bodyHex = (t, f, dark = 0) =>
  hslHex(t.hue + t.tailHue * f, t.sat, clamp(t.light + t.tailLight * f - dark, 6, 94));
export const patternHex = (t, f, dark = 0) =>
  hslHex(t.hue + t.patternHue + t.tailHue * f, t.sat, clamp(t.light + t.patternLight + t.tailLight * f - dark, 6, 94));

// Far-side legs sit in shadow.
export const FAR_SHADE = 28;

const TITLES = ['Sir ', 'Lady ', 'Old ', 'Little ', 'Big ', 'Professor ', 'Captain ', 'Auntie '];
const ROOTS = [
  'Twig', 'Stick', 'Sprig', 'Bramble', 'Fern', 'Moss', 'Thistle', 'Bark', 'Reed', 'Hazel', 'Juniper',
  'Nettle', 'Clover', 'Birch', 'Willow', 'Pickle', 'Noodle', 'Linus', 'Phasma', 'Pip', 'Bean', 'Stalk',
];
const ENDINGS = ['', '', '', 'o', 'kins', 'ington', 'bert', 'ette', 'ius', 'sworth'];

export const randomName = (rand) => (rand() < 0.2 ? pick(rand, TITLES) : '') + pick(rand, ROOTS) + pick(rand, ENDINGS);
