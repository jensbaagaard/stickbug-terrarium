import { useState } from 'react';
import Terrarium from './Terrarium.jsx';
import { params } from './sim.js';

// [key, label, min, max, step]
const SLIDERS = [
  ['seg', 'Body segment', 3, 9, 1],
  ['thigh', 'Thigh reach', 0, 16, 1],
  ['kneeDrop', 'Knee drop', 0, 10, 1],
  ['shin', 'Shin reach', 0, 14, 1],
  ['leg', 'Shin drop', 1, 20, 1],
  ['antenna', 'Antennae', 0, 24, 1],
  ['front', 'Front legs', -1.5, 2.5, 0.1],
  ['mid', 'Middle legs', -1.5, 1.5, 0.1],
  ['hind', 'Hind legs', -2.5, 1, 0.1],
  ['spacing', 'Leg spacing', 0, 3, 0.1],
  ['size', 'Size', 0.5, 3, 0.1],
  ['legLength', 'Leg length', 0.5, 2.5, 0.05],
  ['thickness', 'Thickness', 1, 4, 0.1],
];

const DEFAULTS = { ...params };

export default function App() {
  const [values, setValues] = useState({ ...params });
  const [copied, setCopied] = useState(false);

  const update = (next) => {
    Object.assign(params, next);
    setValues(next);
  };

  const json = JSON.stringify(values);
  const copy = () =>
    navigator.clipboard.writeText(json).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => document.getElementById('values').select(),
    );

  return (
    <>
      <div className="tank">
        <Terrarium />
      </div>
      <p className="hint">
        Drag a bug to pick it up. Drag empty space to grow a branch; bugs climb branches that touch the ground or
        each other. Tap a branch to remove it. Double-tap to add a bug.
      </p>
      <section className="tuner" aria-label="Stickbug shape">
        {SLIDERS.map(([key, label, min, max, step]) => (
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
            <output>{values[key]}</output>
          </label>
        ))}
        <textarea id="values" readOnly rows={3} value={json} onFocus={(e) => e.target.select()} />
        <div className="actions">
          <button type="button" onClick={copy}>
            {copied ? 'Copied' : 'Copy values'}
          </button>
          <button type="button" onClick={() => update({ ...DEFAULTS })}>
            Reset
          </button>
        </div>
      </section>
    </>
  );
}
