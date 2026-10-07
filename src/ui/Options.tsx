import { useId, useState, type FormEvent } from 'react';
import { GAME_CONFIG } from '../game/config.ts';
import { saveSettings, settingsStore, validateSettings, type SettingsErrors } from '../settings.ts';
import { useStore } from '../store.ts';
import { Button, Panel, RoundButton, focusOnMount } from './kit.tsx';
import { navigate } from './router.ts';

interface FieldProps {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  step: number;
  min: number;
  max: number;
  error?: string;
}

function NumberField({ label, hint, value, onChange, onBlur, step, min, max, error }: FieldProps) {
  const id = useId();
  const nudge = (dir: 1 | -1) => {
    const current = Number(value);
    const next = Number.isFinite(current) ? current + dir * step : min;
    onChange(String(Math.min(max, Math.max(min, Math.round(next * 10) / 10))));
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="stepper">
        <RoundButton icon="icon_minus" label={`Decrease ${label.toLowerCase()}`} onClick={() => nudge(-1)} />
        <span className="number-input">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step="any"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            aria-invalid={!!error}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          />
          <span aria-hidden="true">s</span>
        </span>
        <RoundButton icon="icon_plus" label={`Increase ${label.toLowerCase()}`} onClick={() => nudge(1)} />
      </div>
      <p id={`${id}-hint`} className="hint">
        {hint}
      </p>
      {error && (
        <p id={`${id}-error`} className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Shared by the Options screen and the pause dialog. Saved values apply to the next match. */
export function OptionsForm({ onDone, doneLabel }: { onDone: () => void; doneLabel: string }) {
  const saved = useStore(settingsStore);
  const [session, setSession] = useState(String(saved.sessionSeconds));
  const [spawn, setSpawn] = useState(String(saved.spawnIntervalSeconds));
  const [sound, setSound] = useState(saved.soundEnabled);
  const [touched, setTouched] = useState({ session: false, spawn: false });
  const [status, setStatus] = useState('');
  const soundId = useId();

  const values = { sessionSeconds: session.trim() === '' ? NaN : Number(session), spawnIntervalSeconds: spawn.trim() === '' ? NaN : Number(spawn) };
  const errors: SettingsErrors = validateSettings(values);
  const { session: s, spawn: sp } = GAME_CONFIG;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched({ session: true, spawn: true });
    if (Object.keys(errors).length) {
      setStatus('');
      (e.currentTarget as HTMLFormElement).querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    saveSettings({ ...values, soundEnabled: sound });
    setStatus('Options saved. They apply to your next battle.');
  };

  const edit = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setStatus('');
  };

  return (
    <form className="options" onSubmit={submit} noValidate>
      <NumberField
        label="Game session time"
        hint={`${s.minSeconds}–${s.maxSeconds} seconds, whole numbers.`}
        value={session}
        onChange={edit(setSession)}
        onBlur={() => setTouched((t) => ({ ...t, session: true }))}
        step={s.step}
        min={s.minSeconds}
        max={s.maxSeconds}
        error={touched.session ? errors.sessionSeconds : undefined}
      />
      <NumberField
        label="Enemy spawn time"
        hint={`One enemy every ${sp.minIntervalSeconds}–${sp.maxIntervalSeconds} seconds (one decimal allowed).`}
        value={spawn}
        onChange={edit(setSpawn)}
        onBlur={() => setTouched((t) => ({ ...t, spawn: true }))}
        step={sp.step}
        min={sp.minIntervalSeconds}
        max={sp.maxIntervalSeconds}
        error={touched.spawn ? errors.spawnIntervalSeconds : undefined}
      />
      <div className="field checkbox">
        <input
          id={soundId}
          type="checkbox"
          checked={sound}
          onChange={(e) => {
            setSound(e.target.checked);
            setStatus('');
          }}
        />
        <label htmlFor={soundId}>Sound effects</label>
      </div>
      <p className="status" role="status">
        {status}
      </p>
      <div className="stack">
        <Button type="submit">Save</Button>
        <Button variant="secondary" onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
    </form>
  );
}

export function OptionsScreen() {
  return (
    <main className="screen">
      <Panel className="options-panel" labelledBy="options-title">
        <h1 id="options-title" ref={focusOnMount} tabIndex={-1}>
          Options
        </h1>
        <OptionsForm onDone={() => navigate('menu')} doneLabel="Main Menu" />
      </Panel>
    </main>
  );
}
