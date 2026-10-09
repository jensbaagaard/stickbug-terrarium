// The bug, fish or flier picked out in the tank, over the panel: its picture and name, and a few of its traits as bars.
import { useEffect, useRef } from 'react';
import { clamp } from '../geom.js';
import { params, SLIDERS } from '../tuning.js';
import { drawThumb } from '../thumbs.js';

const DEFAULTS = { ...params };
const SLIDER = Object.fromEntries(SLIDERS.map((s) => [s.key, s]));
const FLIER_KINDS = { ladybug: 'Ladybug', shieldbug: 'Shield bug', soldier: 'Soldier beetle' };

// Where a trait sits in its slider's range, 0..1, so the default is half way.
const share = (key, v) => clamp((v - SLIDER[key].min) / (SLIDER[key].max - SLIDER[key].min), 0, 1);
const speedOf = (t) => (t.stride * t.size) / t.stepTicks;

// A few of a bug's, fish's or flier's traits as bars. A bug's speed is a step's length over its time, so it's halfway
// at the default and full at four times that; a fish's or flier's genes already run 0..1.
const statsOf = (who) => {
  if (who.kind === 'flier') {
    const g = who.genome;
    return [
      ['Hunger', who.hunger],
      ['Speed', g.speed],
      ['Size', g.size],
      ['Boldness', g.boldness],
      ['Wanderlust', g.wanderlust],
    ];
  }
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

// The selected bug, fish or flier, and what you can do with it.
export function Inspector({ who, onRelease, onClose }) {
  const canvas = useRef(null);
  const genes = who.genes ?? who.genome;
  useEffect(() => {
    drawThumb(canvas.current, { kind: who.kind, genes: who.genes, genome: who.genome, seed: 1 });
  }, [genes]);
  const stats = statsOf(who);
  const sex = who.kind === 'fish' ? (who.genome.male ? ' \u2642' : ' \u2640') : '';
  const kind = who.kind === 'flier' ? ` \u00b7 ${FLIER_KINDS[who.genome.kind]}` : '';
  return (
    <section className="card" aria-label={`Selected ${who.kind}`}>
      <canvas ref={canvas} className="portrait" aria-hidden="true" />
      <div className="about">
        <header>
          <h2>
            {who.name}
            {sex}
            {kind}
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
