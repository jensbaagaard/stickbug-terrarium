# Stickbug Terrarium

A tiny pixel-art terrarium of stick insects that walk, climb, eat leaves, dance and do odd stick insect things, and
guppies that shoal in its water, each with its own genome. Paint the landscape in stone, basalt, sandstone,
brownstone, wood, ice, dirt, sand, snow and water, decorate it from the shop, and tune everything.

## Run

```sh
npm install
npm run dev     # local dev server
npm run build   # static build in dist/
npm run check   # checks the pointer's marks, pulling plants, flowering under water, clump plants, the fish, bugs' footing, the tank's life, the fliers and the visitors
npm run stress  # times the simulation on a tank packed with everything (`node src/stress.js 3`: 3x the plants)
```

To time the drawing too, open `/stress.html` on the dev server (`?crowd=3` for three times the plants).

## Interact

The panel under the tank has five tabs, each a pixel icon over its name, with the coins beside them: Editor (terrain),
Shop, Garden (Prune, Relocate, Propagate and Feed), Saves and Settings. The game shows rather than tells:

- Picking a tool (the Editor's brush, Prune, Relocate, Propagate) plays a short ghost animation of how it's used in
  the middle of the tank; a press in the tank stops it. While something bought waits to go in, the tank's frame
  glows and, until the pointer comes over the tank, a ghost pointer brings it in from below and taps it down.
- Over the tank, the cursor and a mark show what a press would do: a hand over a bug, fish or ladybug, or over a
  plant, vine or grass you can pull about; a blinking red notch where a tap would cut a stem, stick or vine (a line
  where it would mow grass), with scissors over a stick or with Prune; an arrow over a plant or stick Relocate would lift.
- Prices turn red when you can't afford them, the coin count hops when it changes, a save flashes when it's just
  been saved, loaded or imported, and the reroll button fills up until rerolling is free again. Only errors are
  written out.

- Editor: pick stone, basalt (a dark stone), sandstone, brownstone (a dark sandstone), wood, ice, dirt, sand, snow or
  water (or erase), each shown as it looks in the tank, and a brush size, and draw in the tank; hold still to keep
  pouring. Stone, basalt, sandstone and brownstone (in soft layers), wood (with its grain running along it) and ice stay
  where they're drawn, sand slides into slopes, dirt falls straight down and stacks up, snow drifts down slowly and
  piles up, and water runs, fills hollows and spills out of the sides of the tank (wall them with stone to keep it in).
  Snow that touches water melts into it, and ice freezes the top of any water touching it, so a pond slowly ices over
  (bugs can walk across) while the water under the ice stays water. Bugs walk over the terrain and climb its walls,
  along ledges and through caves (never through it, or on air), and wade through shallow water; in deeper water they
  float, paddling for the nearest bank, and climb out. Anything you plant can stand on the terrain.
- The button in the tank's top corner shows it full screen, alone and as big as it'll go; the button again (or Esc)
  brings it back.
- Drag a bug to pick it up; tap it to inspect it (its picture, name, and bars for hunger, speed, size, laziness
  and groove). From the card you can release the bug.
- Bugs climb anything that touches the ground or each other: the starting stick and whatever you buy.
- Bugs come in patterns: plain, bands or spots mostly, speckled or tipped less often, and now and then (dearer in the
  shop) a rare one: tiger stripes or piebald patches, or rarer still, a rainbow running head to tail or a starry
  night sky.
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
- Fliers: three kinds of small flying bug sharing one way of life, each with its own genome: a nature (speed, appetite,
  boldness, sociability, wanderlust, activity) and its kind's looks. Ladybugs are mostly red or orange with black spots
  (two, seven, ten or more), some yellow with lots of spots, pink, or black with red ones, a harlequin's white collar
  now and then, a few spotless, and rarest of all a metallic steel blue or gold. Shield bugs are flat, green or brown
  with a banded edge, now and then a pale tip, rarer a red one striped across, and rarest a metallic blue. Soldier
  beetles are long and narrow, mostly orange with dark wing tips, some slate grey with an orange collar, yellow or red.
  Let one go and it flies to the nearest plant or stick. They clamber about the plants and sticks, climb to the top of
  whatever they're on before they take off, and fly from one to another, finding their way through the air round the
  terrain (out of nooks and caves too). Now and then aphids settle on a plant and breed (a plant crawling with them
  drops its leaves sooner): a hungry ladybug hunts them down, and with none about eats pollen at the open flowers; a
  soldier beetle goes for the pollen first, and the aphids when there's none; a shield bug sips sap from the stems. They
  bask at the tips, groom, stretch their wings, huddle up with their own kind to rest, and stop to touch antennae when
  they meet on a stem, then one turns back and the other goes round. Tap the glass near one and it flies off if it's
  bold, or if it's not drops and plays dead on its back (a shield bug stays put and lets off a stink); dropping toward
  water, it gets its wings out and flies off. Tap one to inspect it (hunger, speed, size, boldness and wanderlust), drag
  one to pick it up.
- Drag a plant, vine or grass to pull it about, a bit like Aqua Box: it bends toward the pointer and springs back
  when you let go.
- Tap a branch, stick or plant to prune it there; whatever stood on a cut-off piece comes down with it. The Prune
  tool (Gardening) cuts along a dragged line instead. Plant clippings sell for coins.
- Relocate (Gardening): drag a plant, grass patch, vine or stick somewhere else. Plants, grass and sticks land on
  whatever is below where you let go (grass withers off dirt and sand); vines hang from the nearest stick or ledge, or
  the top of the tank. A stick takes along everything on it (plants, vines, sticks leaning on it, the bugs walking on
  it), keeps clear of the glass at the sides, and any of it that would poke out of the top is cut off there.
- Propagate (Gardening): fully grown flowering plants get a blinking green plus. Tap one, then tap where a seedling
  of the same species should go; the parent is cut back to a seedling too, so both grow again. Tap the plant again
  or press Esc to cancel.
- Shop: four bugs (stick insects, or now and then a ladybug, shield bug or soldier beetle), four fish, four plants, four
  sticks and four wallpapers on show, each with a picture and a price (rarer ones cost more), plus fountains. Pick one
  and tap the tank to put it in; Reroll shop fills the shop with new ones. Plants and sticks stand on whatever is below
  where you tap, terrain included. Sticks come in eight styles: a crooked branch, a fork, an arch to walk over, a low
  driftwood log, twisty red manzanita, bamboo canes ringed at their nodes, a fan of spiderwood roots and a holey cholla
  skeleton, in a dozen woods. A stick keeps its shape as you carry it about; one that would poke out of the tank is cut
  off where it meets the glass, like a stick leaning against it. Wallpaper goes up on the back of the tank as soon as
  you buy it, and is kept: every one you've bought shows in a row under the wallpapers on offer, with plain black, to
  put back up for free. Wallpapers come as patterns (stripes, dots, diagonals, gingham, waves, scales, brick, plaid,
  argyle, herringbone) or scenes (dusk, hills, a snowy night, a pine forest, mountains, desert dunes, under the sea, an
  aurora, city lights, a ringed planet, a jungle, a fungal forest of giant glowing mushrooms), kept dim so the tank
  stands out, except now and then a rare vivid one in intense colours (and dearer). Under the snowy night it snows in
  the tank too. The scenes are alive: stars twinkle and now and then one shoots, clouds and mist drift by and come and
  go, snow falls on the far hills, birds or bats cross the sky, a gust blows sand off the dunes, the aurora ripples, the
  city's windows go dark and light up again (a television flickers, a plane goes over, a red light blinks on the tallest
  roof), a little moon circles the ringed planet and a comet passes, a shoal or, once in a long while, a whale swims by
  under the sea, a leaf falls in the jungle, and in the fungal forest glowing spores drift up, the glow swells and fades
  across the caps and now and then a mushroom puffs out a cloud of spores. Like the breeze, it's all a function of the
  time, so none of it is saved. A fountain is a little block that goes exactly where you tap, even in mid-air, and pours
  out water forever, like Powder Game's clone; erase it in the Editor. The only way to earn coins is to grow plants and
  sell the clippings.
- Plants come in four types, each with its own genome: flowering plants that grow node by node; clump plants, a
  crown of leaves straight from the ground that grows a few leaves at a time until it's full, then its flower stalks
  or runners (a bird of paradise with big paddle leaves and orange-crested flowers; a tall tussock of grass that
  arches over like a fountain, with feathery plumes, and doesn't spread; a spider plant whose striped leaves arch
  over and whose runners reach out and hang down, flowering, with a baby plant at the end, best put on a ledge; or a
  snake plant of stiff banded swords; and common house plants: peace lily (white hooded flowers), anthurium (glossy
  red hearts), monstera (big split leaves full of holes), alocasia (arrow leaves with pale veins), calathea
  (feathered bars), Chinese evergreen (silver splashes), Chinese money plant (round coin leaves), ZZ plant, ferns
  and palms (fronds of leaflets), aloe (fleshy, toothed and spotted, with a spike of orange tubes), echeveria (a low
  rosette blushing at the tips, with coral bells), moth orchid (an arching spray of flowers), bromeliad (a bright
  cone of bracts) and cacti (spiny ribbed columns)); grass that you sow on dirt or sand (painted, or the tank floor)
  and that spreads tuft by tuft, withering if buried (under water it grows on, swaying in the current, but doesn't
  blossom); and hanging vines that hang from the nearest branch, stick, or underside or face of the terrain (a stone
  ledge, say), or else from a hook at the top of the tank; they sway and drape onto the floor. Plants and vines sway
  more under water, rocked by the current, and only flower out of it. Tap grass to mow it or a vine to cut it back;
  both grow back, and the clippings sell. Trim a clump plant's leaf and the stump stays until a new leaf comes up to
  replace it. Now and then a plant comes with leaves of an unusual colour (purple, black, golden, silver, copper or
  pink); more rarely, and for a lot more coins, a mutant missing chlorophyll from all or part of its leaves: marbled
  white (albo), half white (half-moon), splashed pink (pink princess), speckled (constellation), pale-rimmed
  (marginata), all golden (aurea) or nearly white all over (ghost).
- The tank lives on its own. A breeze sways the plants, grass and vines in the air, and now and then a gust rolls across
  the tank, leaning everything over as it passes. Old plant leaves yellow, droop and drop, one at a time, and the node
  grows a new one: fallen leaves flutter down and lie browning on the ground until they're gone, or float on the water a
  while and sink, and the fish nibble them. Flowers come and go, each on its own clock: a bud swells and opens, and a
  few minutes later the flower wilts, browning and drooping as its petals drop one by one, and the bare tip rests a
  while before it buds again. Fireflies hang about over the plants, blinking, and over a minute or two fall into step
  until they flash together. Whatever grows under water gives off bubbles that pop at the surface, light glints along
  the water, rings spread where something lands on it, and dust drifts in the air. Visitors come and go on their own
  when the tank has what they're after: now and then a dragonfly comes to still water and stays a few minutes, darting
  from spot to spot over it and hovering, now and then dipping to touch the surface or resting on a stem nearby, before
  it flies off again; now and then a bee comes to work the open flowers, landing on one after another, and leaves with
  lumps of pollen on its legs; and gnats dance in little clouds over the plants. How much flying life comes (fireflies
  and visitors) goes with how green the tank is (the starting tank's one plant gets one firefly; eight or more plants,
  grass patches and vines get them all) and how much of it is air rather than water: a tank full of water gets none.
  Tapped near, visitors make off.
- Biomes: the tank takes its character from what it's made of (debug mode's tank stats, in Settings, say which biome it
  is and what that's like). Mostly water is a sea; basalt volcanic; snow and ice a tundra; sand, sandstone and
  brownstone a desert; a tank thick with plants (12 in a small tank, 20 in a large one: plant counts go up with the
  tank's size, and count plants and vines but not grass) and with water a rainforest; rock, dirt and water, wood, or
  dirt and plants (or sticks among them) the wilds; anything else a garden. Each has its own goings-on, coming at random
  wherever the tank has somewhere for them: jellyfish drift in the sea, embers rise off basalt and steam where water
  meets it, a flurry blows in and it snows in the tundra, tumbleweeds roll by and dust devils whirl in the desert, and
  in the rainforest and the wilds water drips from overhangs, will-o'-the-wisps hang over the water, rain showers ripple
  the ponds, mushrooms come up (now and then in a ring) and seed fluff drifts by. And very rarely one of the biome's
  wild flowers seeds itself, at random, one of each kind at most: in the desert a white lotus on the sand, a blue lotus
  in a pond's shallows or a paintbrush; in the tundra a snow lotus; on basalt a fire lily; in the rainforest a corpse
  lily; in the wilds edelweiss on rock, a pink lotus in the shallows, a ghost orchid or a golden poppy. One coming up is
  told over the tank. Its name stays ??? until one has turned up, which is kept with the save, and its clippings sell
  for four times as much. The Biome events and Wild flowers sliders (under Life) set how often.
- Saves: save the tank (terrain, plants, sticks, bugs, coins and the shop) into a new slot, each shown with a little
  photo of the tank; load one (its Load button, or tap its photo), or save over, export or delete it (delete asks
  twice). Autosave, on unless you switch it off, saves into its own slot every 10 seconds and when you leave (its
  photo is retaken once a minute, as that's most of a save's cost), and the tank comes back as it was next visit.
  Loading another save first puts the tank you had into the autosave. Saves live in the browser's localStorage;
  Export downloads one as a `.stickbug.json` file (name, photo and tank) and Import adds such a file back as a new
  save, to keep a tank safe or move it to another browser.
- Settings: Reset tank (asks twice) starts over with a fresh tank; saves are kept. Tank size: small, medium or large
  (256 by 341 or 320 by 427 pixels, standing up; or 512 by 384, on its side), shown as big as fits (a bigger one
  never narrower than a smaller one would be; medium and large grow to fill the room they have and, on a wide
  screen, go beside the panel, as tall as the window, the panel scrolling alongside); the tank moves into the new
  size with everything kept to the middle and the floor, and a size narrower or shorter than this one asks first, as
  whatever doesn't fit is lost. A save comes back at the size it was saved at. Debug mode (off to start, remembered)
  shows Load sample tank (asks twice; swaps in the tank in `src/samples/`), buttons that make every bug idle, walk,
  eat, dance, wave its front legs, pose as a twig or groom at once, and all the tuning sliders.

## Code

- `src/tuning.js` – every slider: `[key, label, default, spread, step]`, so each default sits mid-range. Gene groups
  are carried per bug.
- `src/genome.js` – random genes (Variety sets how far they stray from the sliders; now and then a rare pattern),
  traits, colours, names.
- `src/anatomy.js` – body and leg geometry shared by the simulation and the renderer.
- `src/sim.js` – world, surfaces and junctions, bugs (kicked tripod steps with feet planted in the world, crawling
  round corners at junctions, quirks), decorations, plants growing node by node (their leaves ageing and dropping,
  their flowers wilting and budding again), fallen leaves and petals, spreading grass, vines as swaying ropes, pruning, the shop and coins. Pure logic, no DOM.
- `src/life.js` – the tank's ambient life: the breeze (a function of time alone, read by the sim and the drawing),
  fireflies, bubbles, dust (snow, under a snowy sky) and ripples, and how much flying life the tank has room for. It
  draws from its own random numbers, so it never changes what else happens. Pure logic, no DOM.
- `src/visitors.js` – the visitors that come and go on their own: dragonflies to still ponds, bees to the open flowers,
  gnats over the plants. Pure logic, no DOM.
- `src/biomes.js` – the biomes: what the tank is made of (looked over every couple of seconds) and so which biome it
  is, each biome's goings-on and its wild flower. Pure logic, no DOM. `src/biomeDraw.js` draws the goings-on.
- `src/fish.js` – guppies: their genome, price and names, and how they live: cruising and shoaling, food and
  grazing, resting, begging, fleeing, courting, and flopping when stranded. Pure logic, no DOM.
- `src/fliers.js` – the fliers (ladybugs, shield bugs and soldier beetles): their genomes, prices and names, and how
  they live: clambering about the plants and sticks, flying between them (a breadth-first search of the air for the way
  round the terrain), hunting aphids, eating pollen or sipping sap, resting, huddling, meeting, playing dead or
  stinking, and keeping out of the water; and the aphids. Pure logic, no DOM.
- `src/terrain.js` – the falling-sand grid (stone, basalt, sandstone, brownstone, wood, ice, dirt, sand, snow, water,
  fountains): painting and stepping. `sim.js` traces its outline (and the open floor's) into the surfaces bugs walk on.
- `src/decor.js` – random sticks (eight styles, with their own foliage), wallpapers (patterns and themed scenes, now
  and then vivid), and the plant genomes: flowering species with a flower genome (form, petals, colours, size), clump
  plants (four forms and fifteen house plants), grasses and hanging vines, the plants now and then with rare leaves.
- `src/geom.js` – maths, segment and colour helpers.
- `src/render.js` – canvas drawing (scenery, flowers, ageing and fallen leaves, light on the water, fireflies and
  dust, genome colours and patterns, quirk poses, previews, coin popups, the marks under the pointer and the tools'
  how-to animations).
- `src/wallpaper.js` – the back of the tank: the wallpapers drawn once into images, each scene in layers by depth,
  and the life in the scenes drawn over them between the layers, so it passes behind hills and trees (stars, clouds,
  mist, far snow, birds and bats, blown sand, the aurora, city lights, a moon, comets, shoals, a whale, falling leaves,
  glowing spores).
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
