// Save slots in the browser's localStorage. An index lists the saves (name, when, a little photo of the tank) and
// each save's data sits under its own key. The autosave is the slot with id AUTO.
import { drawWorld } from './render.js';
import { exportWorld } from './sim.js';

const PREFIX = 'stickbug-terrarium';
const INDEX = `${PREFIX}:saves`;
const dataKey = (id) => `${PREFIX}:save:${id}`;
export const AUTO = 'auto';

const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};
// Numbers are kept to 2 decimals: plenty for a pixel tank, and much smaller. Throws if storage is full.
const write = (key, value) =>
  localStorage.setItem(key, JSON.stringify(value, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));

// The autosave first, then the newest.
export const listSaves = () =>
  (read(INDEX) ?? []).sort((a, b) => (b.id === AUTO) - (a.id === AUTO) || b.savedAt - a.savedAt);

// A small photo of the tank, without the brush, previews or selection marker.
const photoOf = (world) => {
  const full = Object.assign(document.createElement('canvas'), { width: world.W, height: world.H });
  const posed = { ...world, tool: 'hand', placing: null, selected: null, cut: null, moving: null, pruneDemo: null };
  drawWorld(full.getContext('2d'), posed);
  const w = Math.round(world.W / 2);
  const h = Math.round(world.H / 2);
  const small = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = small.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, w, h);
  return small.toDataURL('image/jpeg', 0.85);
};

const nextName = (saves) => {
  const taken = saves.map((s) => Number(/^Tank (\d+)$/.exec(s.name)?.[1] ?? 0));
  return `Tank ${Math.max(0, ...taken) + 1}`;
};

// Save the tank into slot id (a new slot if none), keeping a slot's name when overwriting it. The photo is most
// of the cost (a full redraw), so a slot's photo younger than photoAge ms is kept rather than retaken.
export const saveTank = (world, id = String(Date.now()), { photoAge = 0 } = {}) => {
  const saves = read(INDEX) ?? [];
  const old = saves.find((s) => s.id === id);
  const name = id === AUTO ? 'Autosave' : (old?.name ?? nextName(saves));
  const now = Date.now();
  const keep = old?.photo && now - (old.photoAt ?? 0) < photoAge;
  const entry = {
    id,
    name,
    savedAt: now,
    photo: keep ? old.photo : photoOf(world),
    photoAt: keep ? old.photoAt : now,
    coins: world.coins,
    bugs: world.bugs.length,
  };
  write(dataKey(id), exportWorld(world));
  write(INDEX, [entry, ...saves.filter((s) => s.id !== id)]);
  return entry;
};

export const loadTank = (id) => read(dataKey(id));

// Save files, for keeping a tank outside the browser or passing it on: its name, photo and the tank itself.
const FILE_KIND = 'stickbug-terrarium-save';

export const exportTank = (id) => {
  const entry = (read(INDEX) ?? []).find((s) => s.id === id);
  const tank = loadTank(id);
  if (!entry || !tank) return null;
  const { name, savedAt, photo } = entry;
  const filename = `${name.replace(/[^\w ()-]+/g, '').trim() || 'Tank'}.stickbug.json`;
  return { filename, text: JSON.stringify({ kind: FILE_KIND, name, savedAt, photo, tank }) };
};

// A save file back into a new slot, under its own name (numbered if that's taken). Throws a SyntaxError if the
// text isn't a save, or the storage error if there's no room.
export const importTank = (text) => {
  const file = JSON.parse(text);
  if (file?.kind !== FILE_KIND || !file.tank?.terrain || !Array.isArray(file.tank.bugs)) {
    throw new SyntaxError('not a Stickbug Terrarium save');
  }
  const saves = read(INDEX) ?? [];
  const base = String(file.name || 'Imported tank').slice(0, 40);
  let name = base;
  for (let n = 2; saves.some((s) => s.name === name); n++) name = `${base} (${n})`;
  const now = Date.now();
  const photo = typeof file.photo === 'string' && file.photo.startsWith('data:image/') ? file.photo : '';
  const { coins, bugs } = file.tank;
  const entry = { id: String(now), name, savedAt: now, photo, photoAt: now, coins, bugs: bugs.length };
  write(dataKey(entry.id), file.tank);
  try {
    write(INDEX, [entry, ...saves]);
  } catch (err) {
    localStorage.removeItem(dataKey(entry.id));
    throw err;
  }
  return entry;
};

export const deleteTank = (id) => {
  localStorage.removeItem(dataKey(id));
  write(INDEX, (read(INDEX) ?? []).filter((s) => s.id !== id));
};

// Little settings remembered between visits (autosave, debug mode). Not remembering them is no great loss.
export const getSetting = (name, fallback) => read(`${PREFIX}:${name}`) ?? fallback;
export const setSetting = (name, value) => {
  try {
    write(`${PREFIX}:${name}`, value);
  } catch {
    // storage is full or off
  }
};
export const autosaveOn = () => getSetting('autosave', true);
