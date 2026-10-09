// Random wallpapers for the back of the tank: patterns, and themed scenes with their own names and colours, kept dim
// so the tank stands out (now and then a rare vivid one). Pure generators; draw/wallpaper.js draws them.
import { hsl, pick, range } from './geom.js';

// Wallpaper styles: [key, label, detail (1..5, sets the price), smallest and largest pattern size in px]. Patterns
// first, then scenes.
const WALLPAPER_STYLES = [
  ['stripes', 'stripes', 1, 3, 7],
  ['dots', 'dots', 1, 6, 11],
  ['diagonal', 'diagonals', 1, 3, 6],
  ['gingham', 'gingham', 2, 4, 9],
  ['waves', 'waves', 2, 4, 8],
  ['scales', 'scales', 2, 6, 10],
  ['brick', 'brick', 3, 4, 7],
  ['plaid', 'plaid', 3, 4, 7],
  ['argyle', 'argyle', 3, 6, 10],
  ['herringbone', 'herringbone', 3, 4, 7],
  ['dusk', 'dusk', 4, 1, 1],
  ['hills', 'hills', 5, 1, 1],
  ['winter', 'winter', 5, 1, 1],
  ['forest', 'forest', 5, 1, 1],
  ['mountains', 'mountains', 5, 1, 1],
  ['desert', 'desert', 4, 1, 1],
  ['ocean', 'ocean', 4, 1, 1],
  ['aurora', 'aurora', 5, 1, 1],
  ['city', 'city', 5, 1, 1],
  ['space', 'space', 4, 1, 1],
  ['jungle', 'jungle', 5, 1, 1],
  ['fungal', 'fungal forest', 5, 1, 1],
];
const HUE_NAMES = [
  [20, 'Wine'], [45, 'Umber'], [70, 'Olive'], [150, 'Forest'], [190, 'Teal'], [240, 'Navy'], [280, 'Indigo'],
  [330, 'Plum'], [360, 'Wine'],
];
// c, a little lighter: hue within dh, lightness up by dl ([lo, hi]), saturation up by ds.
const lighter = (rand, c, dh, dl, ds = 0) => ({
  h: c.h + range(rand, -dh, dh),
  s: c.s + ds,
  l: c.l + range(rand, ...dl),
});
const THEMES = {
  winter: {
    names: ['Snowy night', 'Winter hills', 'First snow'],
    palette: (r) => {
      const base = hsl(r, [212, 230], [30, 45], [7, 11]);
      return { base, accent: lighter(r, base, 10, [9, 13], -10), glow: { h: 50, s: 30, l: 60 } };
    },
  },
  forest: {
    names: ['Pine forest', 'Evergreens', 'Woodland dusk'],
    palette: (r) => {
      const base = hsl(r, [150, 200], [25, 40], [8, 12]);
      return { base, accent: lighter(r, base, 10, [5, 8], 5), glow: hsl(r, [45, 55], [35, 50], [50, 60]) };
    },
  },
  mountains: {
    names: ['Mountain dusk', 'High peaks', 'Alpine night'],
    palette: (r) => {
      const base = hsl(r, [230, 280], [25, 40], [8, 12]);
      return { base, accent: lighter(r, base, 20, [6, 9]), glow: { h: 50, s: 40, l: 55 } };
    },
  },
  desert: {
    names: ['Desert dunes', 'Sand sea', 'Dune moon'],
    palette: (r) => {
      const base = hsl(r, [15, 35], [30, 45], [9, 13]);
      return { base, accent: lighter(r, base, 8, [6, 9], 8), glow: hsl(r, [38, 50], [50, 70], [42, 52]) };
    },
  },
  ocean: {
    names: ['Deep sea', 'Coral sea', 'Kelp forest'],
    palette: (r) => {
      const base = hsl(r, [192, 215], [45, 65], [8, 12]);
      return { base, accent: lighter(r, base, 10, [6, 9], 5), glow: hsl(r, [170, 190], [30, 45], [30, 40]) };
    },
  },
  aurora: {
    names: ['Aurora', 'Northern lights', 'Polar night'],
    palette: (r) => {
      const base = hsl(r, [220, 240], [30, 45], [6, 9]);
      const accent = r() < 0.7 ? hsl(r, [120, 170], [50, 70], [16, 20]) : hsl(r, [280, 320], [45, 65], [16, 20]);
      return { base, accent, glow: { h: 60, s: 20, l: 70 } };
    },
  },
  city: {
    names: ['City lights', 'Skyline', 'Night city'],
    palette: (r) => {
      const base = hsl(r, [228, 262], [25, 40], [8, 12]);
      return { base, accent: lighter(r, base, 10, [5, 8]), glow: hsl(r, [38, 52], [65, 85], [42, 52]) };
    },
  },
  space: {
    names: ['Starfield', 'Nebula', 'Ringed planet'],
    palette: (r) => {
      const base = hsl(r, [240, 290], [20, 35], [5, 8]);
      const accent = hsl(r, [0, 360], [40, 60], [13, 17]);
      return { base, accent, glow: hsl(r, [0, 360], [30, 50], [25, 35]) };
    },
  },
  jungle: {
    names: ['Jungle', 'Rainforest', 'Monstera'],
    palette: (r) => {
      const base = hsl(r, [118, 160], [30, 45], [7, 10]);
      return { base, accent: lighter(r, base, 15, [5, 8], 10), glow: { h: 70, s: 40, l: 30 } };
    },
  },
  fungal: {
    names: ['Fungal forest', 'Mushroom grove', 'Glowcap wood'],
    palette: (r) => {
      const base = hsl(r, [230, 290], [25, 40], [7, 10]);
      // The glow: blue-green, lime or magenta.
      const glow = [
        () => hsl(r, [165, 195], [55, 75], [40, 50]),
        () => hsl(r, [85, 120], [50, 70], [38, 48]),
        () => hsl(r, [290, 320], [45, 65], [45, 55]),
      ][Math.floor(r() * 3)]();
      return { base, accent: lighter(r, base, 15, [5, 8], 5), glow };
    },
  },
};

const VIVID_CHANCE = 0.07; // now and then a wallpaper comes in intense colours, and costs more

// A random wallpaper for the back of the tank: a style and its colours, kept dim so whatever is in the tank still
// stands out against it (unless it's a rare vivid one). seed places the stars, hills, trees and so on.
export const makeWallpaper = (rand) => {
  const [style, label, detail, lo, hi] = pick(rand, WALLPAPER_STYLES);
  const theme = THEMES[style];
  let { base, accent, glow } = theme?.palette(rand) ?? {};
  if (!theme) {
    const h = rand() * 360;
    base = { h, s: range(rand, 15, 45), l: range(rand, 7, 12) };
    accent = { h: h + range(rand, -40, 40), s: base.s + range(rand, 0, 15), l: base.l + range(rand, 4, 7) };
  }
  const name = theme ? pick(rand, theme.names) : `${HUE_NAMES.find(([upTo]) => base.h < upTo)[1]} ${label}`;
  const size = lo + Math.floor(rand() * (hi - lo + 1));
  const seed = Math.floor(rand() * 2 ** 31);
  const vivid = rand() < VIVID_CHANCE;
  if (vivid) {
    base = { ...base, s: Math.max(base.s, range(rand, 60, 85)), l: base.l + range(rand, 8, 13) };
    accent = { ...accent, s: range(rand, 70, 95), l: base.l + range(rand, 9, 14) };
    glow &&= { ...glow, s: Math.min(100, glow.s + 25), l: Math.min(80, glow.l + 10) };
  }
  return { style, name: vivid ? `Vivid ${name.toLowerCase()}` : name, detail, vivid, size, base, accent, glow, seed };
};
