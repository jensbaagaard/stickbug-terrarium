// A save in the Saves list.
import { AUTO } from '../saves.js';
import { ConfirmButton, Icon } from './parts.jsx';

// How long ago a save was made, roughly.
const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

// A save in the list: its photo (tap it to load the save), name, when, its bugs and coins, and buttons to save
// over it, export it and delete it. It flashes when it's just been saved, loaded or imported.
export function Save({ save, flash, onLoad, onOverwrite, onExport, onDelete }) {
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
          <button type="button" className="stack" onClick={onLoad}>
            <Icon name="load" />
            Load
          </button>
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
