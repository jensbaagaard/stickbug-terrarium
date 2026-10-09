# Architecture

A map of the code, so a change can start from the few files it touches. Every module opens with a comment saying
what's in it; this is the index to those.

## The shape of it

- **The world** is one plain object holding everything in the tank: terrain, objects (sticks, plants, grass, vines),
  bugs, fish, fliers, the shop, coins and so on. `createWorld` in `src/sim.js` makes one.
- **The simulation** is pure data and functions over the world, with no DOM. It runs in node too: the checks and the
  stress test do.
- **A tick**: `src/Terrarium.jsx` steps the world at a fixed 60 per second (`step` in `src/sim.js`) and draws it every
  animation frame (`drawWorld` in `src/render.js`).
- **The panel** (`src/App.jsx`) reads a `snapshot` of the world five times a second, and changes it only through the
  functions `src/sim.js` exports, wrapped in `act()`.
- **Randomness is seeded**, so a tank plays out the same every time: `world.rand` for the simulation,
  `world.lifeRand` for the ambient life (fireflies, dust, visitors), `world.biomeRand` for the biomes' goings-on.
  Each has its own stream so one never reshuffles another. Drawing never rolls dice: it uses `hash()` (`geom.js`)
  for noise that mustn't flicker, and the time. Never use `Math.random`.

## Where things are

### The simulation (`src/`)

| File | What's in it |
| --- | --- |
| `sim.js` | `createWorld`, `step` (the order a tick goes in), `snapshot` for the panel; re-exports the public API |
| `surfaces.js` | What bugs walk on: stick segments, the walkable outline round the terrain, the floor; junctions, routes |
| `bugs.js` | Stick insects: bodies, tripod steps, walking, falling, swimming; behaviour (food, dancing, quirks) |
| `plants.js` | Flowering plants, clump plants, grass, vines: growing, ageing, swaying, pruning |
| `objects.js` | Putting sticks and plants in and taking them out; where something stands or hangs; footing |
| `shop.js` | Offers and prices, rerolling, putting in what's bought, staging an offer for its picture |
| `tools.js` | The pointer and tools: dragging creatures, pulling plants, pruning, painting, relocating, propagating |
| `effects.js` | Crumbs, debris, fallen leaves and petals, coins and their popups |
| `persist.js` | `exportWorld` / `importWorld` (fitted to another tank size), `TANK_SIZES` |
| `terrain.js` | The falling-sand grid: materials, painting, `stepTerrain` |
| `fish.js` | Guppies: genome, price, names, how they live |
| `fliers.js` | Ladybugs, shield bugs, soldier beetles (genome, behaviour, finding a way through the air), and aphids |
| `life.js` | The breeze (`wind`, a function of time), fireflies, bubbles, dust and snow, ripples; `room` for flying life |
| `visitors.js` | Dragonflies, bees and gnats that come and go |
| `biomes.js` | What the tank is made of, so which biome it is; each biome's goings-on and wild flowers |
| `anatomy.js`, `genome.js` | A bug's body and leg geometry; its genes, traits, colours and names |
| `geom.js` | Maths, segments, colours (`hslHex`, `rgb`), `hash`, seeded `mulberry32`, `pick`, `range` |
| `tuning.js` | Every slider, and `params`, their live values |

### Generators (`src/`): the random things the shop sells

| File | What it makes |
| --- | --- |
| `sticks.js` | Sticks in eight styles and a dozen woods, with their foliage |
| `species.js` | Flowering plant species (and rare leaves), grasses, vines |
| `clumps.js` | Clump plants in fifteen forms |
| `wallpapers.js` | Wallpapers: patterns and themed scenes |

### Drawing (`src/render.js`, `src/draw/`)

`render.js` is `drawWorld`, the order everything is drawn in, back to front. How each thing is drawn lives in `draw/`:

| File | What it draws |
| --- | --- |
| `pixelart.js` | The basics: `plot`, `line`, `strokeBy`, `sprite`, the coin digits, shared colours |
| `pixels.js` | Image-data drawing: `pixel`, `imageLayer`, and `pixelLayer` (see "A frame" below) |
| `plants.js` | Sticks, leaves, flowers of every form, plants, clump plants, grass, vines, fallen leaves |
| `bugs.js`, `fish.js`, `fliers.js` | The creatures |
| `life.js` | Fireflies, dust and snow, visitors, aphids |
| `terrain.js` | Materials' colours and textures, the terrain and water images, the editor's swatches, light on water |
| `wallpaper.js` | The wallpapers, in depth layers, and the life in the scenes (stars, clouds, mist...) |
| `biomes.js` | The biomes' goings-on |
| `marks.js` | Marks under the pointer, previews, the relocation ghost, the brush |
| `demos.js` | The tools' how-to animations |

`thumbs.js` draws shop pictures (an offer staged in a scratch world, drawn and cropped); `icons.js` holds the
panel's pixel icons.

### The app (`src/`, `src/ui/`)

`main.jsx` mounts `App.jsx`: the tank, the inspector and the tabs (Editor, Shop, Garden, Saves, Settings), with
debug mode's tank stats and sliders under Settings. `Terrarium.jsx` is the canvas: fitting it to the screen, pointer
input, the tick loop. `ui/` holds the panel's smaller pieces (`parts.jsx`, `Save.jsx`, `Inspector.jsx`), and
`saves.js` the save slots, autosave and settings in localStorage.

## A tick

`step` in `sim.js`, in order: the time; painting under a held pointer; the terrain (`stepTerrain`), and its walkable
outline when it's changed; stick leaves; footing (things on terrain that's gone come down); plants; bugs; fish;
fliers; crumbs, debris, litter; ambient life; visitors; the biome (which may hand back a wild flower to plant);
popups.

## A frame

`drawWorld` in `render.js`, back to front: wallpaper and floor; plants, aphids and sticks; the terrain's solids;
grass and vines; the biome's goings-on on the ground; the marks and previews; bugs and fallen leaves; the water;
fish, fliers and visitors; crumbs and debris; the marks under the pointer; popups; the air (fireflies, dust); the
how-tos; the brush.

Everything is drawn in whole pixels and `#rrggbb` colours. A canvas call per few pixels is slow, so the passes that
are nothing but opaque fills (plants and sticks, vines, bugs and fallen leaves) draw into `pixelLayer` (a stand-in
for the canvas that fills an image) and are put on the canvas in one go. Anything see-through (`globalAlpha`) draws
on the canvas itself.

## Saving

`exportWorld` keeps the terrain (run-length encoded), the objects, bugs, fish and fliers, the shop, coins, the
wallpapers and the wild flowers found. The ambient life, visitors, biome goings-on, crumbs, debris and fallen leaves
aren't saved: they come back on their own. `saves.js` keeps slots in localStorage, each with a photo; the autosave
is slot `AUTO`. A save made at another tank size is fitted to this one by `importWorld`.

## Adding things

- **A creature**: a pure module like `fish.js` (genome, price, name, `stepX(world)`), called from `step`; drawing in
  `draw/`, called from `drawWorld`; an offer kind in `shop.js`; saved in `persist.js`; a check.
- **A wallpaper scene**: its style and colours in `wallpapers.js`; its picture (an ink per pixel, by depth) and its
  life in `draw/wallpaper.js`.
- **A biome, goings-on or wild flower**: `BIOMES`, `GOINGS` and `WILD` in `biomes.js`; drawing in `draw/biomes.js`.
- **A material**: `terrain.js` (its value, `MATERIALS`, how it moves in `stepTerrain`) and its colours in
  `draw/terrain.js`.
- **A slider**: `tuning.js`. A slider is `[key, label, default, spread, step]`, running from default - spread to
  default + spread, so the default always sits in the middle; keep the spread a whole number of steps.

## Checking

- `npm run check` runs every `src/*.check.js` in node (a few minutes): each builds a tank, runs it, and asserts what
  should happen. Each opens with a comment saying what it checks.
- `npm run stress` times the simulation of a tank packed with everything; `stress.html` on the dev server
  (`npm run dev`) times the drawing too, and counts the canvas calls a frame.
- Pushing to main deploys the site (GitHub Pages, `.github/workflows/pages.yml`).
