// Every tunable value and its slider. Each slider is [key, label, default, spread, step, names]: it runs
// from default - spread to default + spread, so the default always sits in the middle. Times are in
// ticks (60 per second); lengths in "size units" scale with the bug.
//
// Groups marked genes are carried per bug: a bug's value is the slider value plus its own genetic
// offset (clamped to the slider range), so moving a slider shifts every bug while they stay individuals.

// Plain in the middle, the commoner patterns either side of it, and out at the ends the rare ones (tiger, piebald)
// and rarer still (rainbow, starry), which genes seldom stray far enough to reach (see randomGenes).
export const PATTERNS = ['rainbow', 'tiger', 'speckle', 'bands', 'plain', 'spots', 'tipped', 'piebald', 'starry'];

export const GROUPS = [
  {
    title: 'Body',
    genes: true,
    sliders: [
      ['seg', 'Body segment', 5, 4, 1],
      ['thigh', 'Thigh reach', 5, 5, 1],
      ['kneeDrop', 'Knee drop', 2, 2, 0.5],
      ['shin', 'Shin reach', 5, 5, 1],
      ['leg', 'Shin drop', 9, 8, 1],
      ['antenna', 'Antennae', 14, 14, 1],
      ['front', 'Front legs', 0.4, 2, 0.1],
      ['mid', 'Middle legs', -0.4, 1.5, 0.1],
      ['hind', 'Hind legs', -0.6, 1.8, 0.1],
      ['spacing', 'Leg spacing', 2.1, 2.1, 0.1],
      ['size', 'Size', 0.8, 0.7, 0.1],
      ['legLength', 'Leg length', 1.25, 1, 0.05],
    ],
  },
  {
    title: 'Colour',
    genes: true,
    sliders: [
      ['hue', 'Hue', 85, 180, 1], // degrees; wraps round the colour wheel
      ['sat', 'Saturation', 48, 48, 1],
      ['light', 'Lightness', 52, 30, 1],
      ['tailHue', 'Tail hue', 0, 90, 1], // gradient: how far the hue turns from head to tail
      ['tailLight', 'Tail light', 0, 30, 1],
      ['pattern', 'Pattern', 4, 4, 1, PATTERNS],
      ['patternHue', 'Pattern hue', 0, 180, 1], // relative to the body
      ['patternLight', 'Pattern light', -20, 40, 1],
      ['patternScale', 'Pattern size', 4, 3, 0.5], // px
    ],
  },
  {
    title: 'Movement',
    genes: true,
    sliders: [
      // Walking is a run of kicked steps, Stick Ranger style: one tripod of legs stays planted while the
      // other is flung forward, and the body springs along after it.
      ['stepTicks', 'Step time', 48, 42, 1],
      ['stride', 'Stride', 1.2, 1, 0.1], // half a step: how far a foot reaches ahead of / behind its hip
      ['footLift', 'Foot lift', 1.5, 1.5, 0.1],
      ['stepBob', 'Step bob', 1.6, 1.6, 0.1], // body hop per step
      ['bodySpring', 'Body spring', 0.3, 0.25, 0.01], // body points chase their pose with a spring
      ['bodyDamp', 'Body damping', 0.55, 0.35, 0.01],
      ['turnTicks', 'Turn time', 24, 20, 1],
      ['turnHop', 'Turn hop', 0.15, 0.15, 0.01], // fraction of stand height
      ['antennaTwitch', 'Antenna wave', 0.12, 0.12, 0.01], // radians
    ],
  },
  {
    title: 'Idle',
    genes: true,
    sliders: [
      // Standing still, swaying like a twig in a breeze.
      ['restChance', 'Rest chance', 0.63, 0.37, 0.01], // per decision; otherwise dance, quirk or wander
      ['idleTicks', 'Idle time', 2700, 2640, 30], // average rest, also taken after arriving somewhere
      ['idleSway', 'Sway', 0.04, 0.04, 0.005], // fraction of stand height
      ['idleSwaySpeed', 'Sway speed', 0.03, 0.025, 0.005], // radians per tick
    ],
  },
  {
    title: 'Eating',
    genes: true,
    sliders: [
      ['appetite', 'Appetite', 1, 1, 0.1], // hunger rate multiplier
      ['hungryAt', 'Hungry at', 0.5, 0.45, 0.05],
      ['bite', 'Bite size', 0.003, 0.002, 0.001],
      ['headDown', 'Head down', 2.5, 2.5, 0.1], // how far the head lowers to the leaf
      ['chewBop', 'Chew bop', 1, 1, 0.05], // extra dip on each chew
      ['chewSpeed', 'Chew speed', 0.12, 0.1, 0.01], // radians per tick
      ['antennaShake', 'Antenna shake', 1, 1, 0.05], // how far the antennae tip with each chew
      ['crumbs', 'Crumbs', 1.5, 1.5, 0.25], // leaf crumbs dropped per chew, on average
    ],
  },
  {
    title: 'Dance',
    genes: true,
    sliders: [
      // The stickbug rock.
      ['danceChance', 'Dance chance', 0.15, 0.15, 0.01], // per decision
      ['danceBops', 'Bops', 8, 7, 0.5], // full rocks per dance; a half is a coin flip for one more
      ['danceCooldown', 'Cooldown', 1500, 1500, 60],
      ['danceTempo', 'Tempo', 0.1, 0.08, 0.01], // radians per tick
      ['danceSway', 'Sway', 0.28, 0.28, 0.01], // fraction of stand height
      ['danceDip', 'Dip', 0.1, 0.1, 0.01], // fraction of stand height
      ['danceHang', 'Hang at ends', 0.35, 0.35, 0.05], // how long the rock lingers at each end
    ],
  },
  {
    title: 'Quirks',
    genes: true,
    sliders: [
      // Rare stick insect things: waving the front legs, posing as a twig, grooming.
      ['quirkChance', 'Quirk chance', 0.06, 0.06, 0.01], // per decision
      ['quirkTicks', 'Quirk time', 300, 240, 30],
      ['waveSpeed', 'Wave speed', 0.15, 0.1, 0.01], // radians per tick
      ['waveHeight', 'Wave height', 5, 5, 0.5],
    ],
  },
  {
    title: 'World',
    genes: false,
    sliders: [
      ['variety', 'Variety', 0.5, 0.5, 0.05], // how far new bugs' genes stray from the sliders
      ['leafGrowth', 'Leaf growth', 1, 1, 0.1], // multiplier
      ['plantGrowth', 'Plant growth', 1, 1, 0.1], // multiplier
      ['gravity', 'Gravity', 0.15, 0.13, 0.01],
      ['maxBugs', 'Max bugs', 8, 7, 1],
    ],
  },
  {
    title: 'Life',
    genes: false,
    sliders: [
      ['breeze', 'Breeze', 1, 1, 0.1], // how hard the breeze blows, swells and gusts alike
      ['leafLife', 'Leaf life', 1, 0.9, 0.1], // multiplier on how long a leaf lasts before it yellows and drops
      ['bloomLife', 'Bloom life', 1, 0.9, 0.1], // multiplier on how long a flower stays open before it wilts
      ['visitors', 'Visitors', 1, 1, 0.1], // multiplier on how often dragonflies, water striders, bees and gnats come
    ],
  },
  {
    title: 'Fireflies',
    genes: false,
    sliders: [
      ['fireflies', 'Fireflies', 6, 6, 1], // at most, and never more than two to a plant
      ['fireflyWander', 'Wander', 50, 45, 5], // px from its plant a firefly roams
      ['fireflyBlink', 'Blink time', 240, 180, 10], // ticks between a firefly's flashes, give or take
      ['fireflyFlash', 'Flash length', 0.12, 0.1, 0.01], // the share of that it's lit
      ['fireflySync', 'Sync', 0.08, 0.08, 0.01], // how far a flash pulls on nearby clocks; at 0 they never fall in step
    ],
  },
  {
    title: 'Flying bugs',
    genes: false,
    sliders: [
      ['maxFliers', 'Max flying bugs', 8, 7, 1],
      ['aphids', 'Aphids', 1, 1, 0.1], // multiplier on how often aphids settle on the plants, and breed
    ],
  },
  {
    title: 'Bubbles',
    genes: false,
    sliders: [
      // The chance a stem tip, vine node or tuft under water lets a bubble go, every 15 ticks.
      ['bubbleRate', 'Bubble rate', 0.0005, 0.0005, 0.00005],
      ['bubbleSpeed', 'Bubble speed', 0.19, 0.18, 0.01], // px per tick at the most; they start slower and speed up
      ['bigBubbles', 'Big bubbles', 0.25, 0.25, 0.05], // the share that are big, and pop with a ring at the surface
    ],
  },
];

// Flat list with the range worked out.
export const SLIDERS = GROUPS.flatMap((g) =>
  g.sliders.map(([key, label, def, spread, step, names]) => ({
    key,
    label,
    def,
    spread,
    step,
    names,
    min: def - spread,
    max: def + spread,
    gene: g.genes,
  })),
);

export const GENES = SLIDERS.filter((s) => s.gene);

// The live values. Mutated by the tuning panel.
export const params = Object.fromEntries(SLIDERS.map((s) => [s.key, s.def]));
