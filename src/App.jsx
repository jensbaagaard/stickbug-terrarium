// @refresh reset -- remount on hot reload so the panel never shows values from before an edit.
import { useEffect, useRef, useState } from 'react';
import Terrarium from './Terrarium.jsx';
import { GROUPS, SLIDERS, params } from './tuning.js';
import { bodyHex, patternHex, patternOf } from './genome.js';
import {
  PRICES,
  buyReroll,
  buyWallpaper,
  cancelPlacing,
  command,
  createWorld,
  importWorld,
  releaseBug,
  rerollGenes,
  setBrush,
  setTool,
  snapshot,
  startPlacing,
} from './sim.js';
import { drawThumb } from './thumbs.js';
import { MATERIALS } from './terrain.js';
import { MATERIAL_COLORS } from './render.js';
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

const TABS = [
  ['editor', 'Editor'],
  ['shop', 'Shop'],
  ['garden', 'Gardening'],
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
// Gardening tools: [tool, label].
const GARDEN_TOOLS = [
  ['prune', 'Prune'],
  ['move', 'Relocate'],
  ['propagate', 'Propagate'],
];

// Shop rows: four of each, rerolled on demand.
const SHOWCASE = [
  ['bug', 'Bugs'],
  ['plant', 'Plants'],
  ['stick', 'Sticks'],
  ['wallpaper', 'Wallpapers'],
];

const round = (v, digits = 2) => Number(v.toFixed(digits));

// A showcased offer: its picture (drawn once), name and price.
function Offer({ offer, active, blocked, onPick }) {
  const canvas = useRef(null);
  useEffect(() => {
    drawThumb(canvas.current, offer);
  }, [offer]);
  return (
    <button type="button" className="offer" aria-pressed={active} disabled={!active && blocked} onClick={onPick}>
      <canvas ref={canvas} aria-hidden="true" />
      <span className="name">{offer.name}</span>
      <span className="price">{offer.sold ? 'Sold' : `${offer.price}c`}</span>
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

// A button for something that can't be undone: the first tap asks "Sure?", a second within a few seconds does it.
function ConfirmButton({ onConfirm, children }) {
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const id = setTimeout(() => setSure(false), 3000);
    return () => clearTimeout(id);
  }, [sure]);
  const confirm = () => {
    setSure(false);
    onConfirm();
  };
  return (
    <button type="button" className={sure ? 'danger' : ''} onClick={sure ? confirm : () => setSure(true)}>
      {sure ? 'Sure?' : children}
    </button>
  );
}

// A save in the list: its photo, name and when, and what you can do with it.
function Save({ save, onLoad, onOverwrite, onExport, onDelete }) {
  return (
    <li className="save">
      {save.photo ? <img src={save.photo} alt="" /> : <span className="photo" aria-hidden="true" />}
      <div className="about">
        <span className="name">{save.name}</span>
        <span className="when">
          {ago(save.savedAt)} · {save.bugs} {save.bugs === 1 ? 'bug' : 'bugs'} · {save.coins}c
        </span>
        <div className="actions">
          <button type="button" onClick={onLoad}>
            Load
          </button>
          {save.id !== AUTO && (
            <button type="button" onClick={onOverwrite}>
              Overwrite
            </button>
          )}
          <button type="button" onClick={onExport}>
            Export
          </button>
          <ConfirmButton onConfirm={onDelete}>Delete</ConfirmButton>
        </div>
      </div>
    </li>
  );
}

// The selected bug: its colours and a few of its traits, plus what you can do with it.
function Inspector({ bug, onRelease, onClose }) {
  const { t } = bug;
  const speed = ((2 * t.stride * t.size) / t.stepTicks) * 60;
  const stats = [
    ['Doing', bug.doing],
    ['Pattern', patternOf(t)],
    ['Size', round(t.size)],
    ['Speed', `${round(speed, 1)} px/s`],
    ['Laziness', `${Math.round(t.restChance * 100)}%`],
    ['Hunger', `${Math.round(bug.hunger * 100)}%`],
    ['Groove', `${round(t.danceTempo)} / ${round(t.danceBops, 1)} bops`],
  ];
  return (
    <section className="card" aria-label="Selected bug">
      <header>
        <h2>{bug.name}</h2>
        <div className="swatches" aria-hidden="true">
          {[bodyHex(t, 0), bodyHex(t, 1), patternHex(t, 0.5)].map((c, i) => (
            <span key={i} className="swatch" style={{ background: c }} />
          ))}
        </div>
      </header>
      <dl className="stats">
        {stats.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="actions">
        <button type="button" onClick={onRelease}>
          Release
        </button>
        <button type="button" onClick={onClose} aria-label="Deselect">
          ×
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
  const [saveNote, setSaveNote] = useState('');
  const [debug, setDebugState] = useState(() => getSetting('debug', false));
  const world = useRef(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  // Swap in another tank, the same size as the one on screen, with the current tab's tool: a saved one, or
  // a fresh one.
  const swap = (make) => {
    const w = world.current;
    world.current = make(w.W, w.H);
    setTool(world.current, TOOL_FOR_TAB[tabRef.current] ?? 'hand');
    setSnap(snapshot(world.current));
  };
  const load = (data) => swap((W, H) => importWorld(data, W, H));
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

  // Same, for the selected bug (which may have gone since the panel last looked).
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
    setSaveNote(on ? 'Autosave is on: the tank saves itself every 10 seconds and when you leave.' : 'Autosave is off.');
  };
  const saveNew = () => {
    const entry = save();
    if (entry) setSaveNote(`Saved as ${entry.name}.`);
  };
  const overwrite = (s) => () => save(s.id) && setSaveNote(`Saved over ${s.name}.`);
  const loadSave = (s) => () => {
    const data = loadTank(s.id);
    if (!data) {
      setSaveNote(`${s.name} is missing or damaged.`);
      return;
    }
    // Loading another save keeps the tank you had in the autosave, so nothing is lost by accident.
    const kept = autosave && s.id !== AUTO && save(AUTO);
    try {
      load(data);
      setSaveNote(`Loaded ${s.name}.${kept ? ' The tank you had is in the autosave.' : ''}`);
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
    setSaveNote(`Exported ${s.name} as ${file.filename}.`);
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
      setSaveNote(`Imported ${entry.name}. Load it to play.`);
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
    setSaveNote(`Deleted ${s.name}.`);
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
  const placing = snap?.placing;
  const pruning = snap?.tool === 'prune';
  const brush = snap?.brush ?? { material: 'sand', size: 3 };
  const cursor =
    snap?.tool === 'paint' || pruning
      ? 'crosshair'
      : snap?.tool === 'move'
        ? 'move'
        : placing || snap?.tool === 'propagate'
          ? 'copy'
          : 'grab';
  const offers = Object.values(snap?.shop ?? {}).flat();
  const buying = offers.find((o) => o.id === snap?.placingOffer);
  const status = buying?.kind === 'bug'
    ? `Tap the tank to let ${buying.name} in. Esc or tap the card again to cancel.`
    : placing === 'vine'
      ? `Tap something to hang the ${buying.name.toLowerCase()} from, or empty space to hang it from the top.`
      : placing === 'grass'
        ? `Tap some dirt to sow the ${buying.name.toLowerCase()}; it spreads across dirt and the tank floor.`
        : placing
      ? `Tap the tank to put the ${buying ? buying.name.toLowerCase() + ' ' : ''}${placing} down. Esc to cancel.`
      : `${snap?.bugs ?? 0} bugs${snap?.full ? ' (the tank is full)' : ''}. Tap a bug to inspect it.`;
  const fixed = (kind, label) => (
    <button
      type="button"
      aria-pressed={placing === kind && !buying}
      disabled={!(placing === kind && !buying) && coins < PRICES[kind]}
      onClick={act((w) => startPlacing(w, kind))}
    >
      {label} {PRICES[kind]}
    </button>
  );

  return (
    <>
      <div className="tank">
        <Terrarium worldRef={world} style={{ cursor }} />
      </div>

      {snap?.selected && (
        <Inspector
          bug={snap.selected}
          onRelease={withSelected(releaseBug)}
          onClose={act((w) => (w.selected = null))}
        />
      )}

      <nav className="tabs" role="tablist" aria-label="Panels">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => switchTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'editor' && (
        <section className="editor" aria-label="Terrain editor">
          <div className="palette" role="group" aria-label="Material">
            {MATERIALS.map(([key, label, value]) => (
              <button
                key={key}
                type="button"
                aria-pressed={brush.material === key}
                onClick={act((w) => setBrush(w, { material: key }))}
              >
                <span className="chip" style={{ background: MATERIAL_COLORS[value]?.[0] }} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <label className="row">
            <span>Brush size</span>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={brush.size}
              onChange={(e) => act((w) => setBrush(w, { size: Number(e.target.value) }))()}
            />
            <output>{brush.size}</output>
          </label>
        </section>
      )}

      {tab === 'shop' && (
        <section className="shop" aria-label="Shop">
          <div className="bar">
            <span className="coins" aria-label="Coins">
              {coins}c
            </span>
            {fixed('fountain', 'Fountain')}
          </div>
          <p className="status">{status}</p>
          {SHOWCASE.map(([kind, label]) => (
            <div key={kind} className="showcase">
              <h3>{label}</h3>
              <div className="offers">
                {snap?.shop?.[kind].map((offer) => (
                  <Offer
                    key={offer.id}
                    offer={offer}
                    active={snap.placingOffer === offer.id}
                    blocked={offer.sold || coins < offer.price || (kind === 'bug' && snap.full)}
                    onPick={act((w) => (kind === 'wallpaper' ? buyWallpaper(w, offer) : startPlacing(w, kind, offer)))}
                  />
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            className="reroll"
            disabled={coins < (snap?.rerollCost ?? 0)}
            onClick={act(buyReroll)}
          >
            Reroll the shop {snap?.rerollCost ? `${snap.rerollCost}c` : '(free)'}
          </button>
          {snap?.freeRerollIn > 0 && (
            <p className="status">Free again in {Math.ceil(snap.freeRerollIn / 60)}s</p>
          )}
        </section>
      )}

      {tab === 'garden' && (
        <section className="garden" aria-label="Gardening">
          <div className="bar">
            <span className="coins" aria-label="Coins">
              {coins}c
            </span>
            {GARDEN_TOOLS.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={snap?.tool === key} onClick={act((w) => setTool(w, key))}>
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {tab === 'saves' && (
        <section className="saves" aria-label="Saves">
          <div className="bar">
            <button type="button" onClick={saveNew}>
              Save tank
            </button>
            <button type="button" onClick={() => importInput.current.click()}>
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
