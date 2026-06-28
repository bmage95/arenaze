// Dev tweaks panel — reconstructed from gg-app.jsx usage. `useTweaks(defaults)`
// holds the {theme,typeface,density,corners,glow} state, persists it to
// localStorage and reflects theme/density/corners/typeface onto <html>. The
// `.glowoff` class is applied by <AppLayout> from `glow`. The panel itself is a
// floating shell; the Tweak* controls are passed as children (as in the design).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { I } from './icons';

export interface Tweaks {
  theme: 'maroon' | 'carbon' | 'crimson';
  typeface: 'venite' | 'chakra' | 'rajdhani' | 'saira' | 'teko' | 'oxanium';
  density: 'comfortable' | 'compact';
  corners: 'chamfer' | 'square';
  glow: boolean;
}

export const TWEAK_DEFAULTS: Tweaks = {
  theme: 'carbon',
  typeface: 'chakra',
  density: 'compact',
  corners: 'chamfer',
  glow: true,
};

// Bumped to .v2 so older saved prefs (which defaulted to the maroon theme) are
// dropped and the confirmed carbon theme is live for everyone on next load.
const STORE_KEY = 'arenaze.tweaks.v2';

export function useTweaks(defaults: Tweaks = TWEAK_DEFAULTS) {
  const [tweaks, setTweaks] = useState<Tweaks>(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Tweaks>) } : defaults;
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', tweaks.theme);
    root.setAttribute('data-density', tweaks.density);
    root.setAttribute('data-corners', tweaks.corners);
    root.setAttribute('data-type', tweaks.typeface);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(tweaks));
    } catch {
      // ignore quota / private-mode errors
    }
  }, [tweaks]);

  const setTweak = useCallback(<K extends keyof Tweaks>(key: K, value: Tweaks[K]) => {
    setTweaks((t) => ({ ...t, [key]: value }));
  }, []);

  return [tweaks, setTweak] as const;
}

export function TweaksPanel({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tweaks">
      {open && (
        <div className="body">
          <div className="head">
            <span className="t">Tweaks</span>
            <button className="x" onClick={() => setOpen(false)} aria-label="Close tweaks">
              <I.x />
            </button>
          </div>
          {children}
        </div>
      )}
      <button
        className="fab"
        onClick={() => setOpen((o) => !o)}
        aria-label="Theme tweaks"
        title="Theme tweaks"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="16" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="8" cy="17" r="2.2" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </button>
    </div>
  );
}

export function TweakSection({ label }: { label: string }) {
  return <div className="sec">{label}</div>;
}

export function TweakRadio({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="rowt">
      <span className="lab">{label}</span>
      <div className="opts">
        {options.map((o) => (
          <button key={o} className={'opt' + (o === value ? ' on' : '')} onClick={() => onChange(o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TweakSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="rowt">
      <span className="lab">{label}</span>
      <select className="opt" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TweakToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="rowt">
      <span className="lab">{label}</span>
      <button
        className={'tg' + (value ? ' on' : '')}
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
        aria-label={label}
      >
        <span className="kn" />
      </button>
    </div>
  );
}
