// App shell — ported from gg-app.jsx App frame. `.app` grid = Sidebar + `.col`
// [Topbar + `.scroll` <Outlet/>]. Holds the single useTweaks() instance and
// wires the floating TweaksPanel (mirrors the original App render), applying
// `.glowoff` from the glow tweak.
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import {
  TweaksPanel,
  TweakSection,
  TweakRadio,
  TweakSelect,
  TweakToggle,
  useTweaks,
  type Tweaks,
} from './TweaksPanel';

export function AppLayout() {
  const [t, setTweak] = useTweaks();

  return (
    <div className={'app' + (t.glow ? '' : ' glowoff')}>
      <Sidebar />
      <div className="col">
        <Topbar />
        <div className="scroll">
          <Outlet />
        </div>
      </div>

      <TweaksPanel>
        <TweakSection label="Direction" />
        <TweakRadio
          label="Theme"
          value={t.theme}
          options={['maroon', 'carbon', 'crimson']}
          onChange={(v) => setTweak('theme', v as Tweaks['theme'])}
        />
        <TweakRadio
          label="Corners"
          value={t.corners}
          options={['chamfer', 'square']}
          onChange={(v) => setTweak('corners', v as Tweaks['corners'])}
        />
        <TweakSection label="Display typeface" />
        <TweakSelect
          label="Face"
          value={t.typeface}
          options={['venite', 'chakra', 'rajdhani', 'saira', 'teko', 'oxanium']}
          onChange={(v) => setTweak('typeface', v as Tweaks['typeface'])}
        />
        <TweakSection label="Layout" />
        <TweakRadio
          label="Density"
          value={t.density}
          options={['comfortable', 'compact']}
          onChange={(v) => setTweak('density', v as Tweaks['density'])}
        />
        <TweakToggle label="Ambient glow" value={t.glow} onChange={(v) => setTweak('glow', v)} />
      </TweaksPanel>
    </div>
  );
}
