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

const TABS = [
  ['editor', 'Editor'],
  ['shop', 'Shop'],
  ['garden', 'Gardening'],
  ['settings', 'Settings'],
];

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
// Gardening tools: [tool, label, what to do with it].
const GARDEN_TOOLS = [
  ['prune', 'Prune', 'Drag a line to cut through sticks and plants, or tap one to snip it. Clippings sell for coins.'],
  ['move', 'Relocate', 'Drag a plant, grass or vine somewhere else. Vines hang from the nearest stick or ledge.'],
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
  const world = useRef(null);

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

  // The Editor tab paints terrain with the pointer and Gardening starts out pruning; the others pick up bugs and
  // place things.
  const switchTab = (next) => {
    setTab(next);
    act((w) => setTool(w, next === 'editor' ? 'paint' : next === 'garden' ? 'prune' : 'hand'))();
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
    snap?.tool === 'paint' || pruning ? 'crosshair' : snap?.tool === 'move' ? 'move' : placing ? 'copy' : 'grab';
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
          <p className="hint">
            Draw in the tank; hold still to keep pouring. Stone stays put, sand slides into slopes, dirt piles up
            steeply, and water runs, fills the hollows and spills out of the sides. Bugs walk over it all and wade
            through water.
          </p>
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
          <p className="hint">
            Drag a bug to pick it up; tap it to inspect it. Bugs climb anything that touches the ground or each
            other. Tap a branch, stick or plant to prune it. Plants and sticks stand on whatever is below where you
            tap, terrain included. Wallpaper goes up as soon as you buy it.
          </p>
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
          <p className="status">{GARDEN_TOOLS.find(([key]) => key === snap?.tool)?.[2]}</p>
        </section>
      )}

      {tab === 'settings' && (
        <>
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
