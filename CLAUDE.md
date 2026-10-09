# Stickbug Terrarium

Read `ARCHITECTURE.md` first: it maps every module, so you open only the ones a change needs. Every module opens with
a comment saying what's in it.

- `npm run dev`, `npm run build`, `npm run check` (node checks, a few minutes), `npm run stress`.
- The simulation is pure and deterministic: no DOM, no `Math.random` (use the world's seeded streams).
- Draw in whole pixels and `#rrggbb` colours; opaque passes go through `pixelLayer` (`src/draw/pixels.js`).
- Sliders live in `src/tuning.js` as `[key, label, default, spread, step]`; a default always sits mid-range.
- Comments are plain prose saying what and why, wrapped at 120 columns like the code.
- Pushing to main deploys the site.
