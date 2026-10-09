// Falling-sand terrain, a little like Powder Game: a grid of cells of stone, basalt, sandstone, brownstone, wood, ice,
// dirt, sand, snow or water sitting on the tank floor. Stone, basalt (a dark stone), sandstone, brownstone (a dark
// sandstone), wood and ice stay where they're drawn, sand pours and slides into slopes, dirt falls straight down and
// stacks up, snow drifts down slowly and piles up softly, and water runs, levels out and spills out of the sides of the
// tank. Sand and dirt sink through water; snow melts into it, and ice freezes the top of any water touching it, so a
// pond ices over from the surface. Fountains (bought, not drawn) sit still like stone and keep pouring out water, like
// Powder Game's clone. Pure data + functions.

export const CELL = 2; // world px per cell
export const EMPTY = 0;
export const STONE = 1;
export const DIRT = 2;
export const SAND = 3;
export const WATER = 4;
export const FOUNTAIN = 5;
export const WOOD = 6;
export const SANDSTONE = 7;
export const SNOW = 8;
export const ICE = 9;
export const BASALT = 10;
export const BROWNSTONE = 11;

// [key, label, cell value] for the editor palette.
export const MATERIALS = [
  ['stone', 'Stone', STONE],
  ['basalt', 'Basalt', BASALT],
  ['sandstone', 'Sandstone', SANDSTONE],
  ['brownstone', 'Brownstone', BROWNSTONE],
  ['wood', 'Wood', WOOD],
  ['ice', 'Ice', ICE],
  ['dirt', 'Dirt', DIRT],
  ['sand', 'Sand', SAND],
  ['snow', 'Snow', SNOW],
  ['water', 'Water', WATER],
  ['erase', 'Erase', EMPTY],
];
const VALUE = Object.fromEntries(MATERIALS.map(([key, , v]) => [key, v]));

const WATER_FLOW = 3; // cells water can run sideways in a move
const FOUNTAIN_SIZE = 3; // cells across a fountain
const FOUNTAIN_RATE = 0.0225; // chance a fountain fills each empty cell beside it in a tick: a trickle, at water's pace
const SNOW_DRIFT = 0.25; // chance a falling snowflake drifts sideways as it falls
const SNOW_SLIDE = 0.3; // chance it slips sideways off a pile (sand always does, dirt never)
const SNOW_MELT = 0.02; // chance a tick that snow touching water melts into it
// Chance a loose grain moves at all in a tick: so sand, dirt and water fall, slide and run at a steady pace rather
// than all at once, and snow drifts down slowly.
const PACE = { [SAND]: 0.75, [DIRT]: 0.75, [WATER]: 0.75, [SNOW]: 0.35 };
const FREEZE = 0.004; // chance a tick that the top of water touching ice freezes
const ICE_DEPTH = 2; // cells: how thick a pond's ice gets; the water under it stays water
// Never moves.
const SOLID = (m) =>
  m === STONE || m === BASALT || m === SANDSTONE || m === BROWNSTONE || m === WOOD || m === ICE || m === FOUNTAIN;
// Can a grain of m go into a cell holding n? Into empty space, and sand and dirt sink through water (snow floats).
const into = (m, n) => n === EMPTY || (m !== WATER && m !== SNOW && n === WATER);

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
    solidVersion: 0, // bumps when anything but water changes, for redrawing the solids
    woodVersion: 0, // bumps when wood is drawn, erased or covered (wood never moves), for its grain
  };
};

// A new grid for a resized tank, keeping what fits, aligned to the floor and shifted dc columns to the right.
export const resizeTerrain = (old, W, floor, dc = 0) => {
  const ter = makeTerrain(W, floor);
  for (let r = 0; r < Math.min(old.rows, ter.rows); r++) {
    for (let c = Math.max(0, -dc); c < Math.min(old.cols, ter.cols - dc); c++) {
      const i = (old.rows - 1 - r) * old.cols + c;
      const j = (ter.rows - 1 - r) * ter.cols + c + dc;
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

// Paint a round brush of size cells at (x, y). Solids and erasing fill solidly; powders and water are
// sprinkled into empty cells (powders into water too), so holding still keeps pouring.
export const paintTerrain = (ter, x, y, material, size, rand) => {
  const m = VALUE[material];
  const cx = x / CELL;
  const cy = (y - ter.top) / CELL;
  let wood = false; // wood drawn or erased
  for (let dy = -size; dy <= size; dy++) {
    for (let dx = -size; dx <= size; dx++) {
      if (dx * dx + dy * dy > size * size + size * 0.5) continue;
      const c = Math.floor(cx + dx);
      const r = Math.floor(cy + dy);
      if (c < 0 || c >= ter.cols || r < 0 || r >= ter.rows) continue;
      const i = r * ter.cols + c;
      const here = ter.cells[i];
      if (m === EMPTY || SOLID(m)) {
        if (here === m) continue;
      } else if (!(here === EMPTY || (here === WATER && m !== WATER)) || rand() > (m === WATER ? 0.35 : 0.45)) {
        continue;
      }
      if (here === WOOD || m === WOOD) wood = true;
      ter.cells[i] = m;
      ter.tint[i] = Math.floor(rand() * 3);
    }
  }
  Object.assign(ter, { active: true, skyDirty: true });
  ter.version++;
  if (m !== WATER) ter.solidVersion++;
  if (wood) ter.woodVersion++;
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
  ter.solidVersion++;
  ter.woodVersion++;
};

// One tick of falling sand, bottom row first so a grain only moves once. Rows alternate their sweep
// direction so piles don't lean one way.
export const stepTerrain = (ter, rand, tick) => {
  if (!ter.active) return;
  const { cols, rows, cells, tint, done } = ter;
  done.fill(0);
  let moved = false;
  let solidMoved = false; // something other than water moved
  let pouring = false; // something may yet change (a fountain pours, ice freezes, snow melts or falls): keep going
  const move = (i, j) => {
    const m = cells[i];
    cells[i] = cells[j];
    cells[j] = m;
    const t = tint[i];
    tint[i] = tint[j];
    tint[j] = t;
    done[j] = 1;
    moved = true;
    if (m !== WATER || cells[i] !== EMPTY) solidMoved = ter.skyDirty = true;
  };
  for (let r = rows - 1; r >= 0; r--) {
    const flip = (r + tick) & 1;
    for (let k = 0; k < cols; k++) {
      const c = flip ? k : cols - 1 - k;
      const i = r * cols + c;
      const m = cells[i];
      if (m === EMPTY) continue;
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
      if (m === ICE) {
        const near = [r > 0 ? i - cols : -1, r + 1 < rows ? i + cols : -1, c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1];
        // Freeze the top of the water it touches: water with open air over it, or at most ICE_DEPTH - 1 cells of
        // ice and then air.
        const surface = (j) => {
          let k = j - cols;
          for (let d = 1; d < ICE_DEPTH && k >= 0 && cells[k] === ICE; d++) k -= cols;
          return k < 0 || cells[k] === EMPTY;
        };
        for (const j of near) {
          if (j < 0 || cells[j] !== WATER || !surface(j)) continue;
          pouring = true;
          if (rand() >= FREEZE) continue;
          cells[j] = ICE;
          tint[j] = Math.floor(rand() * 3);
          done[j] = 1;
          moved = solidMoved = ter.skyDirty = true;
        }
        continue;
      }
      if (SOLID(m) || done[i]) continue;
      if (m === SNOW) {
        const wet =
          (r > 0 && cells[i - cols] === WATER) ||
          (r + 1 < rows && cells[i + cols] === WATER) ||
          (c > 0 && cells[i - 1] === WATER) ||
          (c < cols - 1 && cells[i + 1] === WATER);
        if (wet) {
          pouring = true; // keep going till it's melted
          if (rand() < SNOW_MELT) {
            cells[i] = WATER;
            moved = solidMoved = ter.skyDirty = true;
            continue;
          }
        }
      }
      if (rand() >= PACE[m]) {
        // Waiting its turn to move: keep going if it has somewhere to go, down or (water) sideways.
        const below = i + cols;
        const fall =
          r + 1 < rows &&
          (into(m, cells[below]) || (c > 0 && into(m, cells[below - 1])) || (c < cols - 1 && into(m, cells[below + 1])));
        const run = m === WATER && (c === 0 || c === cols - 1 || cells[i - 1] === EMPTY || cells[i + 1] === EMPTY);
        if (fall || run) pouring = true;
        continue;
      }
      if (r + 1 < rows) {
        const below = i + cols;
        if (into(m, cells[below])) {
          // Snow drifts a little to one side as it falls, where there's room.
          const dx = m === SNOW && rand() < SNOW_DRIFT ? (rand() < 0.5 ? -1 : 1) : 0;
          const ok = dx && c + dx >= 0 && c + dx < cols && into(m, cells[below + dx]) && !SOLID(cells[i + dx]);
          move(i, ok ? below + dx : below);
          continue;
        }
        // Sand and water slide off piles, snow sometimes; dirt only ever falls straight down.
        if (m !== DIRT && (m !== SNOW || rand() < SNOW_SLIDE)) {
          const side = rand() < 0.5 ? -1 : 1;
          let slid = false;
          for (let k = 0; k < 2 && !slid; k++) {
            const dx = k ? -side : side;
            const cc = c + dx;
            if (cc < 0 || cc >= cols || !into(m, cells[below + dx]) || SOLID(cells[i + dx])) continue;
            move(i, below + dx);
            slid = true;
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
  if (solidMoved) ter.solidVersion++;
};
