# Stickbug Terrarium

A tiny pixel-art terrarium of stick insects that walk, climb, eat leaves, dance and do odd stick insect things, each
with its own genome. Paint the landscape in stone, sandstone, wood, dirt, sand and water, decorate it from the
shop, and tune everything.

## Run

```sh
npm install
npm run dev     # local dev server
npm run build   # static build in dist/
```

## Interact

The panel under the tank has five tabs: Editor (terrain), Shop, Gardening (Prune, Relocate and Propagate), Saves and
Settings.

- Editor: pick stone, sandstone, wood, dirt, sand or water (or erase) and draw in the tank; hold still to keep
  pouring. Stone, sandstone (in soft layers) and wood (with its grain running along it) stay where they're drawn,
  sand slides into slopes, dirt falls straight down and stacks up, and water runs, fills hollows and spills out of
  the sides of the tank (wall them with stone to keep it in). Bugs walk over the terrain's outline and wade through
  water, and anything you plant can stand on it.
- Drag a bug to pick it up; tap it to inspect it (name, colours, traits). From the card you can release the bug.
- Bugs climb anything that touches the ground or each other: the starting stick and whatever you buy.
- Tap a branch, stick or plant to prune it there; whatever stood on a cut-off piece comes down with it. The Prune
  tool (Gardening) cuts along a dragged line instead. Plant clippings sell for coins.
- Relocate (Gardening): drag a plant, grass patch or vine somewhere else. Plants and grass land on whatever is below
  where you let go (grass withers off dirt); vines hang from the nearest stick or ledge, or the top of the tank.
- Propagate (Gardening): fully grown flowering plants get a blinking green plus. Tap one, then tap where a seedling
  of the same species should go; the parent is cut back to a seedling too, so both grow again. Tap the plant again
  or press Esc to cancel.
- Shop: four bugs, four plants, four sticks and four wallpapers on show, each with a picture and a price (rarer
  ones cost more), plus fountains. Pick one and tap the tank to put it in; Reroll fills the shop with new ones.
  Plants and sticks stand on whatever is below where you tap, terrain included. Wallpaper goes up on the back of
  the tank as soon as you buy it, replacing the last one. A fountain is a little block that goes exactly where you
  tap, even in mid-air, and pours out water forever, like Powder Game's clone; erase it in the Editor. The only
  way to earn coins is to grow plants and sell the clippings.
- Plants come in three types, each with its own genome: flowering plants that grow node by node; grass that you sow
  on dirt (painted dirt or the tank floor) and that spreads tuft by tuft, withering if buried or flooded;
  and hanging vines that hang from the nearest branch, stick, or underside or face of the terrain (a stone ledge,
  say), or else from a hook at the top of the tank; they sway and drape onto the floor. Shop cards show which kind
  a plant is with a little icon. Tap grass to mow it or a vine to cut it back; both grow back, and the clippings
  sell.
- Saves: save the tank (terrain, plants, sticks, bugs, coins and the shop) into a new slot, each shown with a
  little photo of the tank; load, overwrite or delete one (delete asks twice). Autosave, on unless you switch it
  off, saves into its own slot every 10 seconds and when you leave (its photo is retaken once a minute, as that's
  most of a save's cost), and the tank comes back as it was next visit.
  Loading another save first puts the tank you had into the autosave. Saves live in the browser's localStorage;
  Export downloads one as a `.stickbug.json` file (name, photo and tank) and Import adds such a file back as a new
  save, to keep a tank safe or move it to another browser.
- Settings: Reset tank (asks twice) starts over with a fresh tank; saves are kept. Debug mode (off to start,
  remembered) shows Load sample tank (asks twice; swaps in the tank in `src/samples/`), buttons that make every bug
  idle, walk, eat, dance, wave its front legs, pose as a twig or groom at once, and all the tuning sliders.

## Code

- `src/tuning.js` – every slider: `[key, label, default, spread, step]`, so each default sits mid-range. Gene groups
  are carried per bug.
- `src/genome.js` – random genes (Variety sets how far they stray from the sliders), traits, colours, names.
- `src/anatomy.js` – body and leg geometry shared by the simulation and the renderer.
- `src/sim.js` – world, surfaces and junctions, bugs (kicked tripod steps with feet planted in the world, crawling
  round corners at junctions, quirks), decorations, plants growing node by node, spreading grass, vines as swaying
  ropes, pruning, the shop and coins. Pure logic, no DOM.
- `src/terrain.js` – the falling-sand grid (stone, sandstone, wood, dirt, sand, water, fountains): painting,
  stepping, and its skyline, which `sim.js` turns into walkable surfaces.
- `src/decor.js` – random sticks (with their own foliage), wallpapers, and the plant genomes: flowering
  species with a flower genome (form, petals, colours, size), grasses and hanging vines.
- `src/geom.js` – maths, segment and colour helpers.
- `src/render.js` – canvas drawing (scenery, flowers, genome colours and patterns, quirk poses, previews, coin
  popups).
- `src/thumbs.js` – shop pictures: each offer built in a scratch world, grown, drawn and cropped.
- `src/saves.js` – save slots, the autosave and remembered settings in localStorage, and the save photos. The tank
  itself is turned into plain data and back by `exportWorld` / `importWorld` in `sim.js`, which fit it to the
  current tank size.
- `src/samples/tank-1.stickbug.json` – the sample tank, a save file like the ones Export writes.
- `src/Terrarium.jsx` – canvas component: sizing, pointer input, fixed 60 Hz step loop. It reads the world from a
  ref each frame, so a loaded or reset tank can be swapped in.
- `src/App.jsx` – tank, bug inspector, and the Editor / Shop / Gardening / Saves / Settings tabs (sliders mutate
  `params` live).
