/**
 * Right panel: the hero doubling-time counter and live ledgers for the four
 * conserved flows — Atoms, Joules, Hands, Information.
 */

'use client';

import { useSimStore } from '@/store/useSimStore';
import { selectView, formatDoubling, formatKg } from '@/components/view';
import { HudValue } from '@/components/HudValue';
import { ELEMENT_IDS, ELEMENT_LABELS, VITAMIN_IDS, VITAMIN_LABELS, PART_IDS } from '@/sim/ids';
import { PART_RECIPES } from '@/data/parts';

/** Section wrapper with an uppercase industrial header. */
function Ledger({ title, children }: { readonly title: string; readonly children: React.ReactNode }): React.ReactElement {
  return (
    <section className='border-t border-panel-edge pt-2'>
      <h2 className='text-[10px] uppercase tracking-widest text-dim mb-1.5'>{title}</h2>
      {children}
    </section>
  );
}

/** Small two-column data row. */
function Row({ label, value, alarm = false }: { readonly label: string; readonly value: string; readonly alarm?: boolean }): React.ReactElement {
  return (
    <div className='flex justify-between text-[11px] leading-5'>
      <span className='text-dim'>{label}</span>
      <span className={`tabular-nums ${alarm ? 'text-alarm' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}

/**
 * Capacity growth sparkline: log-scale capacity over every recorded sol,
 * with storm sols shaded rust and doubling moments marked as kiln ticks.
 * Exponential growth renders as a straight climbing line — takeoff at a glance.
 */
function CapacitySparkline(): React.ReactElement | null {
  const history = useSimStore((s) => s.state.history);
  const doublings = useSimStore((s) => s.state.doublings);
  const scrubSol = useSimStore((s) => s.scrubSol);
  if (history.length < 3) {
    return null;
  }
  const w = 296;
  const h = 56;
  const firstSol = history[0].sol;
  const lastSol = history[history.length - 1].sol;
  const solSpan = Math.max(1, lastSol - firstSol);
  const logs = history.map((s) => Math.log(Math.max(1, s.capacityKg)));
  const minLog = Math.min(...logs);
  const maxLog = Math.max(...logs);
  const logSpan = Math.max(0.0001, maxLog - minLog);
  const toX = (sol: number): number => ((sol - firstSol) / solSpan) * w;
  const toY = (logValue: number): number => h - 4 - ((logValue - minLog) / logSpan) * (h - 8);
  const points = history.map((s, i) => `${toX(s.sol).toFixed(1)},${toY(logs[i]).toFixed(1)}`).join(' ');

  // Contiguous storm bands (optical depth well above quiet baseline).
  const bands: { x: number; width: number }[] = [];
  let bandStart: number | null = null;
  for (let i = 0; i < history.length; i += 1) {
    const stormy = history[i].opticalDepth > 2;
    if (stormy && bandStart === null) {
      bandStart = history[i].sol;
    }
    if ((!stormy || i === history.length - 1) && bandStart !== null) {
      bands.push({ x: toX(bandStart), width: Math.max(1, toX(history[i].sol) - toX(bandStart)) });
      bandStart = null;
    }
  }

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className='w-full border border-panel-edge bg-black/30' role='img' aria-label='Capacity growth, log scale'>
      {bands.map((band, i) => (
        <rect key={`storm-${i}`} x={band.x} y={0} width={band.width} height={h} fill='#a04f2c' opacity={0.22} />
      ))}
      {doublings.map((d) => (
        <line key={`dbl-${d.multiple}`} x1={toX(d.sol)} y1={0} x2={toX(d.sol)} y2={h} stroke='#ff7a1a' strokeWidth={1} opacity={0.8} />
      ))}
      {scrubSol !== null ? <line x1={toX(scrubSol)} y1={0} x2={toX(scrubSol)} y2={h} stroke='#9fd4f5' strokeWidth={1} /> : null}
      <polyline points={points} fill='none' stroke='#c9ced4' strokeWidth={1.4} />
      <text x={3} y={10} fontSize={7} fill='#6b7480' fontFamily='inherit'>
        log capacity · storms shaded · ×2 ticks
      </text>
    </svg>
  );
}

/** Thin horizontal meter bar (fraction 0–1) used for battery and child progress. */
function MeterBar({ fraction, color, alarm = false }: { readonly fraction: number; readonly color: string; readonly alarm?: boolean }): React.ReactElement {
  const pct = Math.min(100, Math.max(0, fraction * 100));
  return (
    <div className='h-1 w-full bg-black/40 border border-panel-edge/60 my-0.5'>
      <div
        className='h-full transition-[width] duration-500'
        style={{ width: `${pct}%`, background: alarm ? 'var(--alarm)' : color, boxShadow: `0 0 6px ${alarm ? 'var(--alarm)' : color}` }}
      />
    </div>
  );
}

/** The hero: doubling time, huge. Drops feel like a launch; spikes like a scrub. */
function DoublingHero(): React.ReactElement {
  const state = useSimStore((s) => s.state);
  const scrubSol = useSimStore((s) => s.scrubSol);
  const view = selectView(state, scrubSol);
  const unit = state.siteId === 'mars' ? 'sols' : 'days';

  // Trend over the last 5 snapshots decides launch vs scrub styling.
  const hist = state.history;
  let trend: 'dropping' | 'spiking' | 'flat' = 'flat';
  if (hist.length > 6) {
    const now = hist[hist.length - 1].doublingTimeSols;
    const before = hist[hist.length - 6].doublingTimeSols;
    if (now !== null && before !== null) {
      if (now < before * 0.9) {
        trend = 'dropping';
      } else if (now > before * 1.15) {
        trend = 'spiking';
      }
    } else if (now === null && before !== null) {
      trend = 'spiking';
    }
  }

  return (
    <div className='py-2'>
      <div className='text-[10px] uppercase tracking-widest text-dim'>Industrial doubling time</div>
      <div className={`hero-number text-7xl font-bold ${trend === 'dropping' ? 'dropping' : ''} ${trend === 'spiking' ? 'spiking' : ''}`}>
        {formatDoubling(view.doublingTimeSols)}
      </div>
      <div className='text-[11px] text-dim mt-1'>
        {unit} to 2× capacity {trend === 'dropping' ? '— TAKEOFF' : trend === 'spiking' ? '— SCRUB' : ''}
      </div>
    </div>
  );
}

/** The assembled right column. */
export function RightPanel(): React.ReactElement {
  const state = useSimStore((s) => s.state);
  const scrubSol = useSimStore((s) => s.scrubSol);
  const view = selectView(state, scrubSol);
  const unit = state.siteId === 'mars' ? 'sols' : 'days';

  // Atoms totals.
  let refinedTotal = 0;
  let scrapTotal = 0;
  for (const el of ELEMENT_IDS) {
    refinedTotal += state.atoms.refinedKg[el];
    scrapTotal += state.atoms.scrapKg[el];
  }
  let wipTotal = 0;
  for (const w of Object.values(state.atoms.wipKg)) {
    wipTotal += w;
  }
  let junkCount = 0;
  let unverifiedCount = 0;
  for (const p of PART_IDS) {
    junkCount += state.parts.junk[p];
    unverifiedCount += state.parts.unverified[p];
  }

  // Hands totals.
  const working = state.robots.filter((r) => r.status === 'working').length;
  const idle = state.robots.filter((r) => r.status === 'idle').length;
  const sheltering = state.robots.filter((r) => r.status === 'sheltering').length;
  const broken = state.robots.filter((r) => r.status === 'broken').length;

  // Information totals.
  const localizable = PART_IDS.filter((p) => PART_RECIPES[p].localization !== undefined);
  const localized = localizable.filter((p) => state.library[p].localized);

  return (
    <aside className='panel-surface flex w-80 shrink-0 flex-col gap-2 border-l border-panel-edge p-3 overflow-y-auto'>
      <DoublingHero />
      <CapacitySparkline />
      <div className='flex gap-2'>
        <HudValue
          label='Capacity'
          value={formatKg(view.capacityKg)}
          accent='kiln'
          formula={'Factory mass + working capacity: solar + batteries + machines + able robots + staged child + shipped children.\nDoublings measured against the sol-0 baseline.'}
        />
        <HudValue
          label='Doublings'
          value={`×${Math.pow(2, state.doublings.length)}`}
          formula={'Completed capacity doublings: 2×, 4×, 8×...\nThree clean doublings is a win state.'}
        />
        <HudValue
          label='Mass closure'
          value={`${(state.massClosureError * 100).toFixed(2)}%`}
          accent={state.massClosureError > 0.005 ? 'alarm' : 'ok'}
          formula={'Conservation audit: |tracked mass − mass in| / mass in.\nAtoms must close within rounding. If this is red, the model has a bug.'}
        />
      </div>

      <Ledger title='Atoms (kg)'>
        <Row label='Raw feed (at pad)' value={formatKg(state.atoms.rawFeedKg)} />
        {ELEMENT_IDS.map((el) => (
          <Row key={el} label={ELEMENT_LABELS[el]} value={formatKg(state.atoms.refinedKg[el])} />
        ))}
        <Row label='WIP (in fab)' value={formatKg(wipTotal)} />
        <Row label='Scrap (remelt queue)' value={formatKg(scrapTotal)} alarm={scrapTotal > refinedTotal} />
        <Row label='Tailings' value={formatKg(state.atoms.tailingsKg)} />
        <Row label='Junk parts on floor' value={`${junkCount.toFixed(0)}`} alarm={junkCount > 20} />
      </Ledger>

      <Ledger title='Joules'>
        <Row label='Solar output' value={`${view.solarKwe.toFixed(1)} kWe`} alarm={view.solarKwe < 1 && !view.isNight} />
        <Row label='Load' value={`${state.energy.currentLoadKwe.toFixed(1)} kWe`} />
        <Row label='Battery' value={`${state.energy.batteryKwh.toFixed(0)} / ${state.energy.batteryCapacityKwh.toFixed(0)} kWh`} alarm={view.batteryFraction < 0.15} />
        <MeterBar fraction={view.batteryFraction} color='var(--ice)' alarm={view.batteryFraction < 0.15} />
        <Row label='Generated (cum)' value={`${(state.energy.generatedCumKwh / 1000).toFixed(1)} MWh`} />
        <Row label='Curtailed (cum)' value={`${(state.energy.curtailedCumKwh / 1000).toFixed(1)} MWh`} />
      </Ledger>

      <Ledger title='Hands (robots)'>
        <Row label='Working' value={`${working}`} />
        <Row label='Idle' value={`${idle}`} />
        <Row label='Sheltering' value={`${sheltering}`} alarm={sheltering > 0} />
        <Row label='Broken' value={`${broken}`} alarm={broken > working} />
        <Row label='Unverified parts (QA queue)' value={`${unverifiedCount.toFixed(0)}`} alarm={unverifiedCount > 60} />
      </Ledger>

      <Ledger title='Information (library)'>
        <Row label='Vitamin processes localized' value={`${localized.length} / ${localizable.length}`} />
        {state.procdevTarget !== null ? (
          <Row
            label={`Dev: ${PART_RECIPES[state.procdevTarget].name}`}
            value={`${Math.min(
              100,
              (state.library[state.procdevTarget].devHoursInvested / (PART_RECIPES[state.procdevTarget].localization?.devRobotHours ?? 1)) * 100,
            ).toFixed(0)}%`}
          />
        ) : (
          <Row label='Dev target' value='awaiting data drop' />
        )}
        <Row label='Data drops received' value={`${state.dataDropsReceived}`} />
      </Ledger>

      <Ledger title='Vitamins (imported kg)'>
        {VITAMIN_IDS.map((v) => (
          <Row key={v} label={VITAMIN_LABELS[v]} value={formatKg(state.vitaminsKg[v])} alarm={state.vitaminsKg[v] < 50} />
        ))}
        <Row label='Imported (cumulative)' value={formatKg(state.importedKgCum)} />
      </Ledger>

      <Ledger title={`Child seed — generation ${state.generation + 1}`}>
        <Row label='Completion' value={`${(state.child.completionFraction * 100).toFixed(1)}%`} />
        <MeterBar fraction={state.child.completionFraction} color='var(--kiln)' />
        <Row label='Chassis' value={state.child.chassisStarted ? 'on the pad' : 'not started'} />
        <Row label='Ration staged' value={formatKg(VITAMIN_IDS.reduce((s, v) => s + state.child.rationKg[v], 0))} />
        <Row label='Feedstock staged' value={formatKg(state.child.feedstockKg)} />
      </Ledger>

      {state.endState !== null ? (
        <div className={`border px-2 py-1.5 text-[11px] uppercase tracking-widest ${state.endState === 'child-awoke' || state.endState === 'three-doublings' ? 'border-ok text-ok' : 'border-alarm text-alarm'}`}>
          {state.endState === 'child-awoke' ? 'Child awoke' : state.endState === 'three-doublings' ? 'Three clean doublings' : state.endState.replace('-', ' ')}
        </div>
      ) : null}
      {scrubSol !== null ? (
        <div className='border border-ice px-2 py-1.5 text-[11px] uppercase tracking-widest text-ice'>
          Viewing history — {unit === 'sols' ? 'sol' : 'day'} {Math.floor(scrubSol)}
        </div>
      ) : null}
    </aside>
  );
}
