/**
 * Top bar: the headline instrument row. Doubling time, generation,
 * working robots, uptime, import-kg per doubling, vitamins remaining,
 * power, and (Mars) the next resupply window countdown.
 */

'use client';

import { useSimStore } from '@/store/useSimStore';
import { selectView, formatDoubling, formatKg } from '@/components/view';
import { HudValue } from '@/components/HudValue';
import { importKgThisDoubling, renderSeedBrief } from '@/sim/brief';
import { SITES } from '@/data/sites';

/** Trigger a client-side download of the markdown seed brief. */
function downloadBrief(markdown: string, sol: number): void {
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `seed-brief-sol-${Math.floor(sol)}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** The top instrument bar. */
export function TopBar(): React.ReactElement {
  const state = useSimStore((s) => s.state);
  const scrubSol = useSimStore((s) => s.scrubSol);
  const setShowSources = useSimStore((s) => s.setShowSources);
  const setShowNewGame = useSimStore((s) => s.setShowNewGame);
  const setShowCompare = useSimStore((s) => s.setShowCompare);
  const view = selectView(state, scrubSol);

  const site = SITES[state.siteId];
  const unit = state.siteId === 'mars' ? 'sols' : 'days';
  const able = state.robots.filter((r) => r.status !== 'broken').length;
  const uptimePct = state.robots.length > 0 ? (able / state.robots.length) * 100 : 0;
  const importThisDoubling = importKgThisDoubling(state);

  let nextWindowText = 'n/a';
  if (site.resupply.kind === 'synodic') {
    const { periodSols, firstWindowSol } = site.resupply;
    let next = firstWindowSol;
    while (next <= state.sol) {
      next += periodSols;
    }
    nextWindowText = `T−${Math.ceil(next - state.sol)} sols`;
  } else {
    nextWindowText = state.shipments.length > 0 ? `T−${Math.ceil(state.shipments[0].arrivalSol - state.sol)} d` : 'idle';
  }

  return (
    <header className='panel-surface flex items-center gap-1 border-b border-panel-edge px-3 py-2 shrink-0'>
      <div className='flex items-baseline gap-2 pr-4 border-r border-panel-edge'>
        <span className='text-phos font-bold tracking-[0.3em] text-base'>SEED</span>
        <span className='text-[10px] text-dim uppercase tracking-widest'>{site.name}</span>
      </div>

      <HudValue
        label={`Doubling (${unit})`}
        value={formatDoubling(view.doublingTimeSols)}
        accent={view.doublingTimeSols !== null && view.doublingTimeSols < 300 ? 'phos' : 'none'}
        formula={'t₂ = ln(2) / r, where r = Δln(capacity mass) per sol over a trailing 20-sol window.\nCapacity = deployed solar + batteries + machines + able robots + staged child mass.\n∞ means growth ≤ 0: the seed is dying.'}
      />
      <HudValue
        label='Generation'
        value={`${view.generation}`}
        formula={'Counts children that met the full wake spec (power, hands, printers, library, vitamin ration) and walked to their own pad.\nSpec: data/parts.ts CHILD_SPEC.'}
      />
      <HudValue
        label='Working robots'
        value={`${view.workingRobots}`}
        accent={view.brokenRobots > view.workingRobots ? 'alarm' : 'none'}
        formula={`Robots currently assigned and powered. Broken: ${view.brokenRobots}.\nEach robot follows a Weibull wear-out curve (k=2, λ=4,000 op-h — ASSUMED, see Sources).`}
      />
      <HudValue
        label='Uptime'
        value={`${uptimePct.toFixed(0)}%`}
        accent={uptimePct < 50 ? 'alarm' : 'ok'}
        formula={'able robots / total robots.\nDuty cycle also applies per robot: mean uptime × dust derating × power factor.'}
      />
      <HudValue
        label='Import / doubling'
        value={formatKg(importThisDoubling)}
        accent='ice'
        formula={'Vitamin kilograms imported since the last capacity doubling.\nThe second headline: driving this toward zero is the long game.'}
      />
      <HudValue
        label='Vitamins'
        value={formatKg(view.vitaminsKg)}
        accent={view.vitaminsKg < 500 ? 'alarm' : 'none'}
        formula={'Total imported precision mass on hand: actuators/bearings, chips/power electronics, seals/lubricants, optics/sensors, chemicals.\nA missing seal can freeze an entire subtree.'}
      />
      <HudValue
        label='Power'
        value={`${view.solarKwe.toFixed(0)} kWe`}
        accent={view.solarKwe < 1 ? 'alarm' : 'none'}
        formula={'P = array mass × 0.1 kW/kg (ASSUMED, ROSA-class) × (site solar constant / 1361) × e^(−0.5τ) × sun elevation.\nMars mean solar constant 590 W/m² (Appelbaum & Flood 1990).'}
      />
      <HudValue
        label={state.siteId === 'mars' ? 'Next window' : 'Next delivery'}
        value={nextWindowText}
        formula={state.siteId === 'mars'
          ? 'Earth–Mars synodic period ≈ 780 days ≈ 760 sols.\nMiss the window and a vitamin-starved factory prints bodies it cannot animate.'
          : 'Earth mode: vitamin orders arrive after a lead time (default 14 days, ASSUMED).'}
      />

      <div className='ml-auto flex items-center gap-2'>
        <button
          type='button'
          className='border border-panel-edge px-3 py-1.5 text-[11px] uppercase tracking-widest text-dim hover:text-foreground hover:border-dim transition-colors'
          onClick={() => setShowSources(true)}
        >
          Sources
        </button>
        <button
          type='button'
          className='border border-panel-edge px-3 py-1.5 text-[11px] uppercase tracking-widest text-dim hover:text-amber hover:border-amber/60 transition-colors'
          onClick={() => setShowCompare(true)}
        >
          Compare
        </button>
        <button
          type='button'
          className='border border-panel-edge px-3 py-1.5 text-[11px] uppercase tracking-widest text-dim hover:text-foreground hover:border-dim transition-colors'
          onClick={() => downloadBrief(renderSeedBrief(state), state.sol)}
        >
          Export brief
        </button>
        <button
          type='button'
          className='border border-phos/50 px-3 py-1.5 text-[11px] uppercase tracking-widest text-phos hover:bg-phos/10 transition-colors'
          onClick={() => setShowNewGame(true)}
        >
          New seed
        </button>
      </div>
    </header>
  );
}
