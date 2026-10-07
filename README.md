# Stickbug Terrarium

A tiny pixel-art terrarium of stick insects that walk, climb branches, eat leaves and dance, plus a tuning panel for their body shape.

## Run

```sh
npm install
npm run dev     # local dev server
npm run build   # static build in dist/
```

## Interact

- Drag a bug to pick it up.
- Drag empty space to grow a branch; bugs climb branches that touch the ground or each other.
- Tap a branch to remove it.
- Double-tap to add a bug (max 8).

## Code

- `src/sim.js` – world, branches, junction graph, bug physics and behaviour (idle / walk / eat / dance / turn / fall / held). Pure logic, no DOM.
- `src/render.js` – canvas drawing (branches, leaves, legs with gait, antennae, dance notes).
- `src/Terrarium.jsx` – canvas component: sizing, pointer input, fixed 60 Hz step loop.
- `src/App.jsx` – tank plus the shape tuning sliders (they mutate `params` in `sim.js` live).
