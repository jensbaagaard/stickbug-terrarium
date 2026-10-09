// Small pieces of the panel: pixel-art icons, material swatches, prices, the shop's offers and wallpapers, and a button
// that asks before doing what can't be undone.
import { useEffect, useRef, useState } from 'react';
import { ICONS, pixelPath } from '../icons.js';
import { MATERIALS } from '../terrain.js';
import { drawSwatch } from '../render.js';
import { drawThumb } from '../thumbs.js';

// A pixel-art icon in the text colour, scale screen px per pixel.
export function Icon({ name, scale = 2 }) {
  const rows = ICONS[name];
  const [w, h] = [rows[0].length, rows.length];
  return (
    <svg className="icon" viewBox={`0 0 ${w} ${h}`} width={w * scale} height={h * scale} aria-hidden="true">
      <path d={pixelPath(rows)} fill="currentColor" shapeRendering="crispEdges" />
    </svg>
  );
}

// A patch of a material as the tank shows it, drawn once; erase has none, and shows the chip's hatching.
export function Swatch({ material }) {
  const canvas = useRef(null);
  const value = MATERIALS.find(([key]) => key === material)[2];
  useEffect(() => {
    if (value) drawSwatch(canvas.current, value);
  }, [value]);
  return <canvas ref={canvas} className="chip" aria-hidden="true" />;
}

// A price in coins, red when there aren't enough.
export const Price = ({ n, short }) => (
  <span className={short ? 'price short' : 'price'}>
    <Icon name="coin" />
    {n}
  </span>
);

// A showcased offer: its picture (drawn once), name and price; sold, just the picture, faded.
export function Offer({ offer, active, short, blocked, onPick }) {
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
export function Wallpaper({ wp, active, onPick }) {
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

// A button for something that can't be undone: the first tap turns it red and asks (confirm), a second within a
// few seconds does it.
export function ConfirmButton({ onConfirm, confirm = 'Sure?', className = '', children, ...props }) {
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
