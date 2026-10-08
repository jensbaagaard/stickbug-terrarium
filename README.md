# Stickbug Terrarium

A tiny pixel-art terrarium of stick insects that walk, climb, eat leaves, dance and do odd stick insect things, and
guppies that shoal in its water, each with its own genome. Paint the landscape in stone, sandstone, wood, dirt, sand
and water, decorate it from the shop, and tune everything.

## Run

```sh
npm install
npm run dev     # local dev server
npm run build   # static build in dist/
npm run check   # checks the pointer's marks, pulling plants, flowering under water, the fish, bugs' footing, and the tank's life
npm run stress  # times the simulation on a tank packed with everything (`node src/stress.js 3`: 3x the plants)
```

To time the drawing too, open `/stress.html` on the dev server (`?crowd=3` for three times the plants).

## Interact

The panel under the tank has five tabs, each a pixel icon over its name, with the coins beside them: Editor (terrain),
Shop, Garden (Prune, Relocate, Propagate and Feed), Saves and Settings. The game shows rather than tells:

- Picking a tool (the Editor's brush, Prune, Relocate, Propagate) plays a short ghost animation of how it's used in
  the middle of the tank; a press in the tank stops it. While something bought waits to go in, the tank's frame
  glows and, until the pointer comes over the tank, a ghost pointer brings it in from below and taps it down.
- Over the tank, the cursor and a mark show what a press would do: a hand over a bug or fish, or over a plant, vine or
  grass you can pull about; a blinking red notch where a tap would cut a stem, stick or vine (a line where it
  would mow grass), with scissors over a stick or with Prune; an arrow over a plant Relocate would lift.
- Prices turn red when you can't afford them, the coin count hops when it changes, a save flashes when it's just
  been saved, loaded or imported, and the reroll button fills up until rerolling is free again. Only errors are
  written out.

- Editor: pick stone, sandstone, wood, dirt, sand or water (or erase) and a brush size, and draw in the tank; hold
  still to keep pouring. Stone, sandstone (in soft layers) and wood (with its grain running along it) stay where
  they're drawn, sand slides into slopes, dirt falls straight down and stacks up, and water runs, fills hollows and
  spills out of the sides of the tank (wall them with stone to keep it in). Bugs walk over the terrain and climb its
  walls, along ledges and through caves (never through it, or on air), and wade through shallow water; in deeper
  water they float, paddling for the nearest bank, and climb out. Anything you plant can stand on the terrain.
- Drag a bug to pick it up; tap it to inspect it (its picture, name, and bars for hunger, speed, size, laziness
  and groove). From the card you can release the bug.
- Bugs climb anything that touches the ground or each other: the starting stick and whatever you buy.
- Fish: guppies, each with its own genome. Males are small and bright, with big tails (delta, fan, round, spade, veil,
  sword, double sword or lyre) in patterns; females are bigger and plainer; some are metallic and a rare few albino.
  Let one go in the water and it swims; on dry land it flops about, hopping toward the nearest water, until it's
  back in. They shoal loosely in the upper water, and now and then a sociable one leads the others off as a school
  that swims, turns and beats its tails as one. They graze the plants and pick at the surface, rest by the plants,
  play tag (whoever's tagged counts a moment, then gives chase), come begging at the pointer when they're hungry and
  bold, and dart off when you tap the glass or sweep the pointer through the water, the fright rippling through the
  shoal and the shy ones hiding in the plants after. The males square up to each other nose to nose with their fins
  flared until the less bold one backs off, and court the females with a quivering S-shaped display. Tap one to
  inspect it (hunger, speed, size, boldness and shoaling), drag one to move it. Feed (Garden) sprinkles flakes on
  the water above them; they float a while, then sink, and the fish race for them. Between feedings they eat
  crumbs that fall in.
- Drag a plant, vine or grass to pull it about, a bit like Aqua Box: it bends toward the pointer and springs back
  when you let go.
- Tap a branch, stick or plant to prune it there; whatever stood on a cut-off piece comes down with it. The Prune
  tool (Gardening) cuts along a dragged line instead. Plant clippings sell for coins.
- Relocate (Gardening): drag a plant, grass patch or vine somewhere else. Plants and grass land on whatever is below
  where you let go (grass withers off dirt and sand); vines hang from the nearest stick or ledge, or the top of the
  tank.
- Propagate (Gardening): fully grown flowering plants get a blinking green plus. Tap one, then tap where a seedling
  of the same species should go; the parent is cut back to a seedling too, so both grow again. Tap the plant again
  or press Esc to cancel.
- Shop: four bugs, four fish, four plants, four sticks and four wallpapers on show, each with a picture and a price
  (rarer ones cost more), plus fountains. Pick one and tap the tank to put it in; Reroll fills the shop with new ones.
  Plants and sticks stand on whatever is below where you tap, terrain included. Wallpaper goes up on the back of
  the tank as soon as you buy it, replacing the last one. A fountain is a little block that goes exactly where you
  tap, even in mid-air, and pours out water forever, like Powder Game's clone; erase it in the Editor. The only
  way to earn coins is to grow plants and sell the clippings.
- Plants come in three types, each with its own genome: flowering plants that grow node by node; grass that you sow
  on dirt or sand (painted, or the tank floor) and that spreads tuft by tuft, withering if buried (under water it
  grows on, swaying in the current, but doesn't blossom); and hanging vines that hang from the nearest branch,
  stick, or underside or face of the terrain (a stone ledge, say), or else from a hook at the top of the tank; they
  sway and drape onto the floor. Plants and vines sway more under water, rocked by the current, and only flower out
  of it. Tap grass to mow it or a vine to cut it back; both grow back, and the clippings sell.
- The tank lives on its own. A breeze sways the plants, grass and vines in the air, and now and then a gust rolls
  across the tank, leaning everything over as it passes. Old plant leaves yellow, droop and drop, one at a time, and
  the node grows a new one: fallen leaves flutter down and lie browning on the ground until they're gone, or float on
  the water a while and sink, and the fish nibble them. Fireflies hang about over the plants, blinking, and over a
  minute or two fall into step until they flash together. Whatever grows under water gives off bubbles that pop at
  the surface, light glints along the water, rings spread where something lands on it, and dust drifts in the air.
- Saves: save the tank (terrain, plants, sticks, bugs, coins and the shop) into a new slot, each shown with a
  little photo of the tank; tap the photo to load one, or save over, export or delete it (delete asks twice).
  Autosave, on unless you switch it off, saves into its own slot every 10 seconds and when you leave (its photo is
  retaken once a minute, as that's most of a save's cost), and the tank comes back as it was next visit.
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
  round corners at junctions, quirks), decorations, plants growing node by node (their leaves ageing and dropping),
  fallen leaves, spreading grass, vines as swaying ropes, pruning, the shop and coins. Pure logic, no DOM.
- `src/life.js` – the tank's ambient life: the breeze (a function of time alone, read by the sim and the drawing),
  fireflies, bubbles, dust and ripples. It draws from its own random numbers, so it never changes what else happens.
  Pure logic, no DOM.
- `src/fish.js` – guppies: their genome, price and names, and how they live: cruising and shoaling, food and
  grazing, resting, begging, fleeing, courting, and flopping when stranded. Pure logic, no DOM.
- `src/terrain.js` – the falling-sand grid (stone, sandstone, wood, dirt, sand, water, fountains): painting and
  stepping. `sim.js` traces its outline (and the open floor's) into the surfaces bugs walk on.
- `src/decor.js` – random sticks (with their own foliage), wallpapers, and the plant genomes: flowering
  species with a flower genome (form, petals, colours, size), grasses and hanging vines.
- `src/geom.js` – maths, segment and colour helpers.
- `src/render.js` – canvas drawing (scenery, flowers, ageing and fallen leaves, light on the water, fireflies and
  dust, genome colours and patterns, quirk poses, previews, coin popups, the marks under the pointer and the tools'
  how-to animations).
- `src/stress.js`, `stress.html` – the stress test: a tank packed with everything, timed.
- `src/icons.js` – the panel's pixel icons, as rows of `#`, and the scissors cursor.
- `src/thumbs.js` – shop pictures: each offer built in a scratch world, grown, drawn and cropped.
- `src/saves.js` – save slots, the autosave and remembered settings in localStorage, and the save photos. The tank
  itself is turned into plain data and back by `exportWorld` / `importWorld` in `sim.js`, which fit saves made at
  another size to the tank's.
- `src/samples/tank-1.stickbug.json` – the sample tank, a save file like the ones Export writes.
- `src/Terrarium.jsx` – canvas component: a fixed 256×341 tank shown at a whole number of screen pixels per tank
  pixel (the most that fits, so resizing the window only changes it a step at a time), pointer input and cursor,
  fixed 60 Hz step loop. It reads the world from a ref each frame, so a loaded or reset tank can be swapped in.
- `src/App.jsx` – tank, bug inspector, and the Editor / Shop / Gardening / Saves / Settings tabs (sliders mutate
  `params` live).
