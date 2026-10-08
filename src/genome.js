// Genes, traits, colours and names. Each bug carries an offset per gene slider; its traits are the
// slider values plus those offsets, clamped to the slider range.
import { GENES, PATTERNS, params } from './tuning.js';
import { clamp, hslHex, pick } from './geom.js';

// Random offsets: variety 0 makes clones of the sliders, 1 lets a gene land anywhere in its range. Two
// dice make middling bugs common and extreme ones rare. Then, now and then (if bugs vary at all), a bug is born
// with a rare pattern, and very rarely a rarer one: out at the ends of the Pattern slider, where the usual spread
// of genes seldom or never reaches.
const RARE_PATTERN = 0.05;
const RARER_PATTERN = 0.01;
export const randomGenes = (rand, variety) => {
  const genes = Object.fromEntries(GENES.map((g) => [g.key, (rand() + rand() - 1) * variety * g.spread]));
  const roll = rand();
  if (variety > 0 && roll < RARE_PATTERN) genes.pattern = (rand() < 0.5 ? -1 : 1) * (roll < RARER_PATTERN ? 4 : 3);
  return genes;
};

// How rare a bug's pattern is: 0 for the usual ones, 1 rare, 2 rarer.
export const patternRarity = (genes) => Math.max(0, Math.round(Math.abs(genes.pattern ?? 0)) - 2);

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
