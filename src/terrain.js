// Falling-sand terrain, a little like Powder Game: a grid of cells of stone, dirt, sand or water sitting on
// the tank floor. Stone stays where it's drawn, sand pours and slides into slopes, dirt piles up steeply, and
// water runs, levels out and spills out of the sides of the tank. Sand and dirt sink through water. Fountains
// (bought, not drawn) sit still like stone and keep pouring out water, like Powder Game's clone. Pure data +
// functions.

export const CELL = 2; // world px per cell
export const EMPTY = 0;
export const STONE = 1;
export const DIRT = 2;
export const SAND = 3;
export const WATER = 4;
export const FOUNTAIN = 5;

// [key, label, cell value] for the editor palette.
export const MATERIALS = [
  ['stone', 'Stone', STONE],
  ['dirt', 'Dirt', DIRT],
  ['sand', 'Sand', SAND],
  ['water', 'Water', WATER],
  ['erase', 'Erase', EMPTY],
];
const VALUE = Object.fromEntries(MATERIALS.map(([key, , v]) => [key, v]));

const DIRT_SLIDE = 0.12; // chance a dirt grain slips sideways off a pile; sand always does
const WATER_FLOW = 4; // cells water can run sideways in a tick
const FOUNTAIN_SIZE = 3; // cells across a fountain
const FOUNTAIN_RATE = 0.03; // chance a fountain fills each empty cell beside it in a tick: a trickle
const SOLID = (m) => m === STONE || m === FOUNTAIN; // never moves

// The grid is bottom-aligned to the floor: row r's top edge is at top + r * CELL.
export const makeTerrain = (W, floor) => {
  const cols = Math.ceil(W / CELL);
  const rows = Math.floor(floor / CELL);
  const n = cols * rows;
  return {
    cols,
    rows,
    top: floor - rows * CELL,
    cells: new Uint8Array(n),
    tint: new Uint8Array(n), // per-grain shade, carried along as grains move
    done: new Uint8Array(n),
    active: false, // something may still move
    skyDirty: false, // the solid outline changed
    version: 0, // bumps whenever any cell changes, for redrawing
  };
};

// A new grid for a resized tank, keeping what fits, aligned to the floor.
export const resizeTerrain = (old, W, floor) => {
  const ter = makeTerrain(W, floor);
  for (let r = 0; r < Math.min(old.rows, ter.rows); r++) {
    for (let c = 0; c < Math.min(old.cols, ter.cols); c++) {
      const i = (old.rows - 1 - r) * old.cols + c;
      const j = (ter.rows - 1 - r) * ter.cols + c;
      ter.cells[j] = old.cells[i];
      ter.tint[j] = old.tint[i];
    }
  }
  return Object.assign(ter, { active: true, skyDirty: true });
};

export const cellAt = (ter, x, y) => {
  const c = Math.floor(x / CELL);
  const r = Math.floor((y - ter.top) / CELL);
  return c < 0 || c >= ter.cols || r < 0 || r >= ter.rows ? -1 : r * ter.cols + c;
};

// Paint a round brush of size cells at (x, y). Stone and erasing fill solidly; powders and water are
// sprinkled into empty cells (powders into water too), so holding still keeps pouring.
export const paintTerrain = (ter, x, y, material, size, rand) => {
  const m = VALUE[material];
  const cx = x / CELL;
  const cy = (y - ter.top) / CELL;
  for (let dy = -size; dy <= size; dy++) {
    for (let dx = -size; dx <= size; dx++) {
      if (dx * dx + dy * dy > size * size + size * 0.5) continue;
      const c = Math.floor(cx + dx);
      const r = Math.floor(cy + dy);
      if (c < 0 || c >= ter.cols || r < 0 || r >= ter.rows) continue;
      const i = r * ter.cols + c;
      const here = ter.cells[i];
      if (m === EMPTY || m === STONE) {
        if (here === m) continue;
      } else if (!(here === EMPTY || (here === WATER && m !== WATER)) || rand() > (m === WATER ? 0.35 : 0.45)) {
        continue;
      }
      ter.cells[i] = m;
      ter.tint[i] = Math.floor(rand() * 3);
    }
  }
  Object.assign(ter, { active: true, skyDirty: true });
  ter.version++;
};

// Where a fountain put down at (x, y) goes: the cells of a block centred there, kept inside the grid, and the
// same block in world px.
export const fountainAt = (ter, x, y) => {
  const half = Math.floor(FOUNTAIN_SIZE / 2);
  const c0 = Math.min(Math.max(Math.floor(x / CELL) - half, 0), ter.cols - FOUNTAIN_SIZE);
  const r0 = Math.min(Math.max(Math.floor((y - ter.top) / CELL) - half, 0), ter.rows - FOUNTAIN_SIZE);
  return { c0, r0, x: c0 * CELL, y: ter.top + r0 * CELL, size: FOUNTAIN_SIZE * CELL };
};

// Put a fountain at (x, y), over whatever is there.
export const placeFountain = (ter, x, y, rand) => {
  const { c0, r0 } = fountainAt(ter, x, y);
  for (let r = r0; r < r0 + FOUNTAIN_SIZE; r++) {
    for (let c = c0; c < c0 + FOUNTAIN_SIZE; c++) {
      ter.cells[r * ter.cols + c] = FOUNTAIN;
      ter.tint[r * ter.cols + c] = Math.floor(rand() * 3);
    }
  }
  Object.assign(ter, { active: true, skyDirty: true });
  ter.version++;
};

export const clearTerrain = (ter) => {
  ter.cells.fill(EMPTY);
  Object.assign(ter, { active: false, skyDirty: true });
  ter.version++;
};

// One tick of falling sand, bottom row first so a grain only moves once. Rows alternate their sweep
// direction so piles don't lean one way.
export const stepTerrain = (ter, rand, tick) => {
  if (!ter.active) return;
  const { cols, rows, cells, tint, done } = ter;
  done.fill(0);
  let moved = false;
  let pouring = false; // a fountain has room to pour, so keep going even if this tick it didn't
  const move = (i, j) => {
    const m = cells[i];
    cells[i] = cells[j];
    cells[j] = m;
    const t = tint[i];
    tint[i] = tint[j];
    tint[j] = t;
    done[j] = 1;
    moved = true;
    if (m !== WATER || cells[i] !== EMPTY) ter.skyDirty = true;
  };
  for (let r = rows - 1; r >= 0; r--) {
    const flip = (r + tick) & 1;
    for (let k = 0; k < cols; k++) {
      const c = flip ? k : cols - 1 - k;
      const i = r * cols + c;
      const m = cells[i];
      if (m === FOUNTAIN) {
        for (const j of [i - cols, i + cols, c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1]) {
          if (j < 0 || j >= cells.length || cells[j] !== EMPTY) continue;
          pouring = true;
          if (rand() >= FOUNTAIN_RATE) continue;
          cells[j] = WATER;
          tint[j] = Math.floor(rand() * 3);
          done[j] = 1;
          moved = true;
        }
        continue;
      }
      if (m === EMPTY || m === STONE || done[i]) continue;
      // Can m go into cell j? Into empty space, and powders sink through water.
      const into = (j) => cells[j] === EMPTY || (m !== WATER && cells[j] === WATER);
      if (r + 1 < rows) {
        const below = i + cols;
        if (into(below)) {
          move(i, below);
          continue;
        }
        if (m !== DIRT || rand() < DIRT_SLIDE) {
          const side = rand() < 0.5 ? -1 : 1;
          let slid = false;
          for (const dx of [side, -side]) {
            const cc = c + dx;
            if (cc < 0 || cc >= cols || !into(below + dx) || SOLID(cells[i + dx])) continue;
            move(i, below + dx);
            slid = true;
            break;
          }
          if (slid) continue;
        }
      }
      if (m === WATER) {
        // Run sideways through open space, stopping early over a drop to fall into. Running off the edge of
        // the grid spills it out of the tank.
        const side = rand() < 0.5 ? -1 : 1;
        for (const dx of [side, -side]) {
          let to = -1;
          for (let k = 1; k <= WATER_FLOW; k++) {
            const cc = c + dx * k;
            if (cc < 0 || cc >= cols) {
              to = cells.length;
              break;
            }
            if (cells[i + dx * k] !== EMPTY) break;
            to = i + dx * k;
            if (r + 1 < rows && cells[to + cols] === EMPTY) break;
          }
          if (to < 0) continue;
          if (to === cells.length) {
            cells[i] = EMPTY;
            moved = true;
          } else {
            move(i, to);
          }
          break;
        }
      }
    }
  }
  if (moved) ter.version++;
  else if (!pouring) ter.active = false;
};

// Height of the top solid cell in each column, in world px (water doesn't hold anything up); the floor where
// there's none.
export const skyline = (ter, floor) =>
  Array.from({ length: ter.cols }, (_, c) => {
    for (let r = 0; r < ter.rows; r++) {
      const m = ter.cells[r * ter.cols + c];
      if (m !== EMPTY && m !== WATER) return ter.top + r * CELL;
    }
    return floor;
  });
