// @refresh reset -- remount on hot reload so the panel never shows values from before an edit.
import { useEffect, useRef, useState } from 'react';
import Terrarium from './Terrarium.jsx';
import { GROUPS, SLIDERS, params } from './tuning.js';
import { clamp } from './geom.js';
import {
  PRICES,
  TANK_SIZES,
  buyReroll,
  buyWallpaper,
  cancelPlacing,
  command,
  createWorld,
  exportWorld,
  hangWallpaper,
  feedFish,
  importWorld,
  release,
  rerollGenes,
  setBrush,
  setTool,
  snapshot,
  startPlacing,
  tankSize,
} from './sim.js';
import { drawThumb } from './thumbs.js';
import { MATERIALS } from './terrain.js';
import { MATERIAL_COLORS } from './render.js';
import { ICONS, pixelPath } from './icons.js';
import {
  AUTO,
  autosaveOn,
  deleteTank,
  exportTank,
  getSetting,
  importTank,
  listSaves,
  loadTank,
  saveTank,
  setSetting,
} from './saves.js';

// Tabs: [key, label], each shown by the icon of the same name over its label.
const TABS = [
  ['editor', 'Editor'],
  ['shop', 'Shop'],
  ['garden', 'Garden'],
  ['saves', 'Saves'],
  ['settings', 'Settings'],
];

const AUTOSAVE_MS = 10_000;
const AUTOSAVE_PHOTO_MS = 60_000; // retaking the photo is most of a save's cost, so the autosave's is kept a minute
const TOOL_FOR_TAB = { editor: 'paint' }; // Gardening waits for you to pick a tool

const DEFAULTS = { ...params };
const SLIDER = Object.fromEntries(SLIDERS.map((s) => [s.key, s]));

// Buttons under the tank that make every bug do something right now.
const COMMANDS = [
  ['idle', 'Idle'],
  ['walk', 'Walk'],
  ['eat', 'Eat'],
  ['dance', 'Dance'],
  ['wave', 'Wave'],
  ['twig', 'Twig'],
  ['groom', 'Groom'],
];
// Gardening tools: [tool, label], each shown by its icon.
const GARDEN_TOOLS = [
  ['prune', 'Prune'],
  ['move', 'Relocate'],
  ['propagate', 'Propagate'],
];

// Shop rows: four of each, rerolled on demand.
const SHOWCASE = [
  ['bug', 'Bugs'],
  ['fish', 'Fish'],
  ['plant', 'Plants'],
  ['stick', 'Sticks'],
  ['wallpaper', 'Wallpapers'],
];

const BRUSH_SIZES = [1, 2, 3, 4, 5];

// A pixel-art icon in the text colour, scale screen px per pixel.
function Icon({ name, scale = 2 }) {
  const rows = ICONS[name];
  const [w, h] = [rows[0].length, rows.length];
  return (
    <svg className="icon" viewBox={`0 0 ${w} ${h}`} width={w * scale} height={h * scale} aria-hidden="true">
      <path d={pixelPath(rows)} fill="currentColor" shapeRendering="crispEdges" />
    </svg>
  );
}

// A price in coins, red when there aren't enough.
const Price = ({ n, short }) => (
  <span className={short ? 'price short' : 'price'}>
    <Icon name="coin" />
    {n}
  </span>
);

// A showcased offer: its picture (drawn once), name and price; sold, just the picture, faded.
function Offer({ offer, active, short, blocked, onPick }) {
  const canvas = useRef(null);
  useEffect(() => {
    drawThumb(canvas.current, offer);
  }, [offer]);
  return (
    <button
      type="button"
      className="offer"
      title={offer.name}
      aria-pressed={active}
      disabled={!active && (blocked || short)}
      onClick={onPick}
    >
      <canvas ref={canvas} aria-hidden="true" />
      <span className="name">{offer.name}</span>
      {!offer.sold && <Price n={offer.price} short={short} />}
    </button>
  );
}

// A wallpaper bought before, or plain black (wp null): its picture and name, pressed if it's the one up.
function Wallpaper({ wp, active, onPick }) {
  const canvas = useRef(null);
  useEffect(() => {
    if (wp) drawThumb(canvas.current, { kind: 'wallpaper', seed: wp.seed, wallpaper: wp });
  }, [wp]);
  return (
    <button type="button" className="offer" title={wp?.name ?? 'Plain'} aria-pressed={active} onClick={onPick}>
      <canvas ref={canvas} className={wp ? '' : 'plain'} aria-hidden="true" />
      <span className="name">{wp?.name ?? 'Plain'}</span>
    </button>
  );
}

// How long ago a save was made, roughly.
const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

// A button for something that can't be undone: the first tap turns it red and asks (confirm), a second within a
// few seconds does it.
function ConfirmButton({ onConfirm, confirm = 'Sure?', className = '', children, ...props }) {
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const id = setTimeout(() => setSure(false), 3000);
    return () => clearTimeout(id);
  }, [sure]);
  const go = () => {
    setSure(false);
    onConfirm();
  };
  return (
    <button
      type="button"
      className={`${className}${sure ? ' danger' : ''}`}
      onClick={sure ? go : () => setSure(true)}
      {...props}
    >
      {sure ? confirm : children}
    </button>
  );
}

// A save in the list: its photo (tap it to load the save), name, when, its bugs and coins, and buttons to save
// over it, export it and delete it. It flashes when it's just been saved, loaded or imported.
function Save({ save, flash, onLoad, onOverwrite, onExport, onDelete }) {
  return (
    <li className={flash ? 'save flash' : 'save'}>
      <button type="button" className="photo" onClick={onLoad} title="Load" aria-label={`Load ${save.name}`}>
        {save.photo && <img src={save.photo} alt="" />}
      </button>
      <div className="about">
        <span className="name">{save.name}</span>
        <span className="when">
          {ago(save.savedAt)}
          <span aria-label="Bugs">
            <Icon name="bug" /> {save.bugs}
          </span>
          <span className="coin" aria-label="Coins">
            <Icon name="coin" /> {save.coins}
          </span>
        </span>
        <div className="actions">
          {save.id !== AUTO && (
            <button type="button" className="stack" onClick={onOverwrite}>
              <Icon name="saves" />
              Save over
            </button>
          )}
          <button type="button" className="stack" onClick={onExport}>
            <Icon name="export" />
            Export
          </button>
          <ConfirmButton
            className="stack"
            onConfirm={onDelete}
            confirm={
              <>
                <Icon name="check" />
                Sure?
              </>
            }
          >
            <Icon name="trash" />
            Delete
          </ConfirmButton>
        </div>
      </div>
    </li>
  );
}

// Where a trait sits in its slider's range, 0..1, so the default is half way.
const share = (key, v) => clamp((v - SLIDER[key].min) / (SLIDER[key].max - SLIDER[key].min), 0, 1);
const speedOf = (t) => (t.stride * t.size) / t.stepTicks;

// A few of a bug's or fish's traits as bars. A bug's speed is a step's length over its time, so it's halfway at the
// default and full at four times that; a fish's genes already run 0..1.
const statsOf = (who) => {
  if (who.kind === 'fish') {
    const g = who.genome;
    return [
      ['Hunger', who.hunger],
      ['Speed', g.speed],
      ['Size', g.size],
      ['Boldness', g.boldness],
      ['Shoaling', g.sociability],
    ];
  }
  const { t } = who;
  return [
    ['Hunger', who.hunger],
    ['Speed', clamp(0.5 + Math.log2(speedOf(t) / speedOf(DEFAULTS)) / 4, 0, 1)],
    ['Size', share('size', t.size)],
    ['Laziness', share('restChance', t.restChance)],
    ['Groove', share('danceTempo', t.danceTempo)],
  ];
};

// The selected bug or fish: its picture and a few of its traits as bars, plus what you can do with it.
function Inspector({ who, onRelease, onClose }) {
  const canvas = useRef(null);
  const genes = who.genes ?? who.genome;
  useEffect(() => {
    drawThumb(canvas.current, { kind: who.kind, genes: who.genes, genome: who.genome, seed: 1 });
  }, [genes]);
  const stats = statsOf(who);
  const sex = who.kind === 'fish' ? (who.genome.male ? ' \u2642' : ' \u2640') : '';
  return (
    <section className="card" aria-label={`Selected ${who.kind}`}>
      <canvas ref={canvas} className="portrait" aria-hidden="true" />
      <div className="about">
        <header>
          <h2>
            {who.name}
            {sex}
          </h2>
          <button type="button" onClick={onClose} aria-label="Deselect">
            ×
          </button>
        </header>
        <dl className="stats">
          {stats.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="meter" role="meter" aria-valuenow={Math.round(v * 100)}>
                <span style={{ width: `${v * 100}%` }} />
              </dd>
            </div>
          ))}
        </dl>
        <button type="button" onClick={onRelease}>
          Release
        </button>
      </div>
    </section>
  );
}

export default function App() {
  const [values, setValues] = useState({ ...params });
  const [copied, setCopied] = useState(false);
  const [snap, setSnap] = useState(null);
  const [tab, setTab] = useState('shop');
  const [saves, setSaves] = useState(listSaves);
  const [autosave, setAutosaveState] = useState(autosaveOn);
  const [saveNote, setSaveNote] = useState(''); // only for what went wrong; what went right shows by itself
  const [flash, setFlash] = useState(null); // the save just saved, loaded or imported
  const [debug, setDebugState] = useState(() => getSetting('debug', false));
  const [size, setSizeState] = useState(() => getSetting('tankSize', 'small'));
  const world = useRef(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  // Swap in another tank, with the current tab's tool: a saved one, or a fresh one, the same size as the one on
  // screen unless dims ([W, H]) says otherwise.
  const swap = (make, dims = [world.current.W, world.current.H]) => {
    world.current = make(...dims);
    setTool(world.current, TOOL_FOR_TAB[tabRef.current] ?? 'hand');
    setSnap(snapshot(world.current));
  };
  const chooseSize = (key) => {
    setSetting('tankSize', key);
    setSizeState(key);
  };
  // A save comes back at the size it was saved at, if that's one of the sizes, so nothing's cut off.
  const load = (data) => {
    const key = tankSize(data.W, data.H);
    swap((W, H) => importWorld(data, W, H), key ? TANK_SIZES[key] : undefined);
    if (key) chooseSize(key);
  };
  // Move the tank into another size of tank, everything kept to the middle and the floor.
  const resize = (key) => {
    swap((W, H) => importWorld(exportWorld(world.current), W, H), TANK_SIZES[key]);
    chooseSize(key);
  };
  // Debug: the sample tank that comes with the game, fetched only when it's asked for.
  const loadSample = async () => load((await import('./samples/tank-1.stickbug.json')).default.tank);

  // Save into slot id (a new one if none). Storage can be full or off (private browsing), so say if it fails.
  const save = (id, options) => {
    try {
      const entry = saveTank(world.current, id, options);
      setSaves(listSaves());
      return entry;
    } catch {
      setSaveNote("Couldn't save: the browser's storage is full or turned off. Delete a save to make room.");
      return null;
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  const flashSave = (id) => {
    setSaveNote('');
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1200);
  };

  // Pick up where the last visit left off.
  useEffect(() => {
    if (!autosaveOn()) return;
    const data = loadTank(AUTO);
    if (!data || !world.current) return;
    try {
      load(data);
    } catch (err) {
      console.warn('The autosave could not be loaded', err);
    }
  }, []);

  // Autosave every few seconds, and with a fresh photo when the page is hidden or closed and on the way out.
  useEffect(() => {
    if (!autosave) return;
    const autosaveNow = () => world.current && saveRef.current(AUTO);
    const id = setInterval(() => world.current && saveRef.current(AUTO, { photoAge: AUTOSAVE_PHOTO_MS }), AUTOSAVE_MS);
    const onHide = () => document.visibilityState === 'hidden' && autosaveNow();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', autosaveNow);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', autosaveNow);
      if (autosaveOn()) autosaveNow(); // unmounting, not switching autosave off
    };
  }, [autosave]);

  useEffect(() => {
    const refresh = () => world.current && setSnap(snapshot(world.current));
    refresh();
    const id = setInterval(refresh, 200);
    const onKey = (e) => {
      if (e.key === 'Escape' && world.current) {
        cancelPlacing(world.current);
        refresh();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(id);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Run fn on the world and show the result straight away.
  const act = (fn) => () => {
    const w = world.current;
    if (!w) return;
    fn(w);
    setSnap(snapshot(w));
  };

  // Same, for the selected bug or fish (which may have gone since the panel last looked).
  const withSelected = (fn) => act((w) => w.selected && fn(w, w.selected));

  // The Editor tab paints terrain with the pointer; the others pick up bugs and place things until a Gardening
  // tool is picked.
  const switchTab = (next) => {
    setTab(next);
    act((w) => setTool(w, TOOL_FOR_TAB[next] ?? 'hand'))();
    if (next === 'saves') setSaves(listSaves());
  };

  const toggleDebug = (on) => {
    setSetting('debug', on);
    setDebugState(on);
  };
  const toggleAutosave = (on) => {
    setSetting('autosave', on);
    setAutosaveState(on);
  };
  const saveNew = () => {
    const entry = save();
    if (entry) flashSave(entry.id);
  };
  const overwrite = (s) => () => save(s.id) && flashSave(s.id);
  const loadSave = (s) => () => {
    const data = loadTank(s.id);
    if (!data) {
      setSaveNote(`${s.name} is missing or damaged.`);
      return;
    }
    // Loading another save keeps the tank you had in the autosave, so nothing is lost by accident.
    if (autosave && s.id !== AUTO) save(AUTO);
    try {
      load(data);
      flashSave(s.id);
    } catch (err) {
      console.warn(err);
      setSaveNote(`${s.name} could not be loaded.`);
    }
  };
  // Export a save as a file to download; import one back into a new slot.
  const importInput = useRef(null);
  const exportSave = (s) => () => {
    const file = exportTank(s.id);
    if (!file) {
      setSaveNote(`${s.name} is missing or damaged.`);
      return;
    }
    const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: file.filename }).click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000); // once the download has surely read it
  };
  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so the same file can be picked again
    if (!file) return;
    let text;
    try {
      text = await file.text();
    } catch {
      setSaveNote(`Couldn't read ${file.name}.`);
      return;
    }
    try {
      const entry = importTank(text);
      setSaves(listSaves());
      flashSave(entry.id);
    } catch (err) {
      setSaveNote(
        err instanceof SyntaxError
          ? `${file.name} isn't a Stickbug Terrarium save.`
          : "Couldn't import: the browser's storage is full or turned off. Delete a save to make room.",
      );
    }
  };

  const remove = (s) => () => {
    deleteTank(s.id);
    setSaves(listSaves());
  };

  const update = (next) => {
    Object.assign(params, next);
    setValues(next);
  };

  // Only what differs from the defaults.
  const json = JSON.stringify(Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== DEFAULTS[k])));
  const copy = () =>
    navigator.clipboard.writeText(json).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => document.getElementById('values').select(),
    );

  const coins = snap?.coins ?? 0;
  const brush = snap?.brush ?? { material: 'sand', size: 3 };
  const rerollCost = snap?.rerollCost ?? 0;
  const color = (material) => MATERIAL_COLORS[MATERIALS.find(([key]) => key === material)[2]]?.[0];
  const brushColor = color(brush.material);

  return (
    <>
      <div className={snap?.placing ? 'tank placing' : 'tank'}>
        <Terrarium worldRef={world} size={size} />
      </div>

      {snap?.selected && (
        <Inspector
          who={snap.selected}
          onRelease={withSelected(release)}
          onClose={act((w) => (w.selected = null))}
        />
      )}

      <div className="panelbar">
        <nav className="tabs" role="tablist" aria-label="Panels">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              className="stack"
              aria-selected={tab === key}
              onClick={() => switchTab(key)}
            >
              <Icon name={key} />
              {label}
            </button>
          ))}
        </nav>
        <span className="coins" aria-label="Coins">
          <Icon name="coin" />
          <span key={coins} className="bump">
            {coins}
          </span>
        </span>
      </div>

      {tab === 'editor' && (
        <section className="editor" aria-label="Terrain editor">
          <div className="palette" role="group" aria-label="Material">
            {MATERIALS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="stack"
                aria-pressed={brush.material === key}
                onClick={act((w) => setBrush(w, { material: key }))}
              >
                <span className="chip" style={{ background: color(key) }} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <div className="sizes" role="group" aria-label="Brush size">
            {BRUSH_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                aria-label={`Size ${size}`}
                aria-pressed={brush.size === size}
                onClick={act((w) => setBrush(w, { size }))}
              >
                <span className="dot" style={{ '--size': size, background: brushColor }} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      )}

      {tab === 'shop' && (
        <section className="shop" aria-label="Shop">
          <div className="bar">
            <button
              type="button"
              aria-pressed={snap?.placing === 'fountain'}
              disabled={snap?.placing !== 'fountain' && coins < PRICES.fountain}
              onClick={act((w) => startPlacing(w, 'fountain'))}
            >
              <Icon name="fountain" />
              Fountain
              <Price n={PRICES.fountain} short={coins < PRICES.fountain} />
            </button>
            {/* Fills up over the minute until rerolling is free again. */}
            <button
              type="button"
              className="reroll"
              style={{ '--ready': 1 - (snap?.rerollWait ?? 0) }}
              disabled={coins < rerollCost}
              onClick={act(buyReroll)}
            >
              <Icon name="reroll" />
              Reroll shop
              {rerollCost > 0 && <Price n={rerollCost} short={coins < rerollCost} />}
            </button>
          </div>
          {SHOWCASE.map(([kind, label]) => (
            <div key={kind} className="offers" role="group" aria-label={label}>
              {snap?.shop?.[kind].map((offer) => (
                <Offer
                  key={offer.id}
                  offer={offer}
                  active={snap.placingOffer === offer.id}
                  short={coins < offer.price}
                  blocked={offer.sold || (kind === 'bug' && snap.full)}
                  onPick={act((w) => (kind === 'wallpaper' ? buyWallpaper(w, offer) : startPlacing(w, kind, offer)))}
                />
              ))}
            </div>
          ))}
          {/* The wallpapers bought so far, to put back up for free. */}
          {snap?.wallpapers.length > 0 && (
            <div className="offers library" role="group" aria-label="Your wallpapers">
              <Wallpaper wp={null} active={snap.wallpaper === null} onPick={act((w) => hangWallpaper(w, null))} />
              {snap.wallpapers.map((wp) => (
                <Wallpaper
                  key={wp.seed}
                  wp={wp}
                  active={snap.wallpaper === wp.seed}
                  onPick={act((w) => hangWallpaper(w, wp))}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'garden' && (
        <section className="garden" role="group" aria-label="Gardening">
          {GARDEN_TOOLS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="stack"
              aria-pressed={snap?.tool === key}
              onClick={act((w) => setTool(w, w.tool === key ? 'hand' : key))}
            >
              <Icon name={key} scale={3} />
              {label}
            </button>
          ))}
          <button type="button" className="stack" disabled={!snap?.fish} onClick={act(feedFish)}>
            <Icon name="feed" scale={3} />
            Feed
          </button>
        </section>
      )}

      {tab === 'saves' && (
        <section className="saves" aria-label="Saves">
          <div className="bar">
            <button type="button" onClick={saveNew}>
              <Icon name="saves" />
              Save
            </button>
            <button type="button" onClick={() => importInput.current.click()}>
              <Icon name="import" />
              Import
            </button>
            <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={importFile} />
            <label className="toggle">
              <input type="checkbox" checked={autosave} onChange={(e) => toggleAutosave(e.target.checked)} />
              Autosave
            </label>
          </div>
          {saveNote && <p className="status">{saveNote}</p>}
          {saves.length > 0 && (
            <ul className="list">
              {saves.map((s) => (
                <Save
                  key={s.id}
                  save={s}
                  flash={flash === s.id}
                  onLoad={loadSave(s)}
                  onOverwrite={overwrite(s)}
                  onExport={exportSave(s)}
                  onDelete={remove(s)}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'settings' && (
        <section className="settings" aria-label="Settings">
          <div className="bar">
            <ConfirmButton onConfirm={() => swap(createWorld)}>Reset tank</ConfirmButton>
            <label className="toggle">
              <input type="checkbox" checked={debug} onChange={(e) => toggleDebug(e.target.checked)} />
              Debug mode
            </label>
          </div>
          {/* A smaller tank cuts off what doesn't fit, so that asks first. */}
          <div className="bar sizes-bar" role="group" aria-label="Tank size">
            {Object.entries(TANK_SIZES).map(([key, [w]]) => {
              const label = key[0].toUpperCase() + key.slice(1);
              const current = snap?.W ?? TANK_SIZES[size][0];
              if (w < current) {
                return (
                  <ConfirmButton key={key} onConfirm={() => resize(key)} confirm="Shrink?">
                    {label}
                  </ConfirmButton>
                );
              }
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={w === current}
                  onClick={() => w !== current && resize(key)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {tab === 'settings' && debug && (
        <>
          <div className="bar" role="group" aria-label="Sample">
            <ConfirmButton onConfirm={loadSample}>Load sample tank</ConfirmButton>
          </div>
          <div className="commands" role="group" aria-label="Make every bug">
            {COMMANDS.map(([action, label]) => (
              <button key={action} type="button" onClick={act((w) => command(w, action))}>
                {label}
              </button>
            ))}
          </div>
          <div className="bar" role="group" aria-label="Bugs">
            <button type="button" onClick={act((w) => w.bugs.forEach((b) => rerollGenes(w, b)))}>
              Re-roll all bugs
            </button>
          </div>

          <section className="tuner" aria-label="Stickbug tuning">
            {GROUPS.map(({ title, sliders }, i) => (
              <details key={title} className="group" open={i === 0}>
                <summary>{title}</summary>
                {sliders.map(([key]) => {
                  const { label, min, max, step, names } = SLIDER[key];
                  return (
                    <label key={key} className="row">
                      <span>{label}</span>
                      <input
                        id={`s-${key}`}
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={values[key]}
                        onChange={(e) => update({ ...values, [key]: Number(e.target.value) })}
                      />
                      <output>{names ? names[values[key]] : values[key]}</output>
                    </label>
                  );
                })}
              </details>
            ))}
            <textarea id="values" readOnly rows={3} value={json} onFocus={(e) => e.target.select()} />
            <div className="actions">
              <button type="button" onClick={copy}>
                {copied ? 'Copied' : 'Copy values'}
              </button>
              <button type="button" onClick={() => update({ ...DEFAULTS })}>
                Reset all
              </button>
            </div>
          </section>
        </>
      )}
    </>
  );
}
