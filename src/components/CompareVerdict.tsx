/**
 * CompareVerdict: the experiment's result card, shown under the history
 * strip. While the variant simulates it shows progress; when finished it
 * lines the two runs up at the same sol — capacity, doublings, first wake,
 * generation, imports — and calls the race.
 */

'use client';

import { useSimStore } from '@/store/useSimStore';
import { formatKg } from '@/components/view';

/** One baseline-vs-variant row. */
function VsRow({ label, base, variant }: { readonly label: string; readonly base: string; readonly variant: string }): React.ReactElement {
  return (
    <div className='flex text-[11px] leading-5'>
      <span className='flex-1 text-dim'>{label}</span>
      <span className='w-20 text-right tabular-nums text-foreground'>{base}</span>
      <span className='w-20 text-right tabular-nums text-amber'>{variant}</span>
    </div>
  );
}

/** The comparison card. Renders nothing while no comparison exists. */
export function CompareVerdict(): React.ReactElement | null {
  const compare = useSimStore((s) => s.compare);
  const state = useSimStore((s) => s.state);
  const clearCompare = useSimStore((s) => s.clearCompare);
  const unit = state.siteId === 'mars' ? 'sol' : 'day';

  if (compare.kind === 'idle') {
    return null;
  }

  if (compare.kind === 'running') {
    const pct = Math.min(100, (compare.progressSol / Math.max(1, compare.targetSol)) * 100);
    return (
      <section className='border border-amber/40 p-2'>
        <div className='text-[10px] uppercase tracking-widest text-amber mb-1'>Simulating variant — {compare.label}</div>
        <div className='h-1 w-full bg-black/40 border border-panel-edge/60'>
          <div className='h-full' style={{ width: `${pct}%`, background: 'var(--amber)', boxShadow: '0 0 6px var(--amber)' }} />
        </div>
        <div className='text-[10px] text-dim mt-1 tabular-nums'>
          {unit} {compare.progressSol.toFixed(0)} / {compare.targetSol}
        </div>
      </section>
    );
  }

  const result = compare.result;
  // Baseline read at the same sol the variant stopped at, so the race is fair
  // even though the live run has kept going since.
  const baseSnapshot =
    state.history.find((s) => s.sol === result.targetSol) ?? state.history[state.history.length - 1];
  const variantSnapshot = result.history.length > 0 ? result.history[result.history.length - 1] : null;
  const baseWake = state.events.find((e) => e.kind === 'child-wake');
  const baseCap = baseSnapshot.capacityKg;
  const variantCap = variantSnapshot !== null ? variantSnapshot.capacityKg : 0;
  const deltaPct = baseCap > 0 ? ((variantCap - baseCap) / baseCap) * 100 : 0;
  const verdict =
    Math.abs(deltaPct) < 2
      ? `Dead heat at ${unit} ${result.targetSol}`
      : deltaPct > 0
        ? `Variant ahead: +${deltaPct.toFixed(0)}% capacity at ${unit} ${result.targetSol}`
        : `Baseline ahead: variant −${Math.abs(deltaPct).toFixed(0)}% capacity at ${unit} ${result.targetSol}`;

  return (
    <section className='border border-amber/40 p-2'>
      <div className='flex items-start justify-between gap-2 mb-1'>
        <div className='flex items-center gap-2 text-[10px] uppercase tracking-widest text-amber'>
          <span className='inline-block h-1.5 w-1.5 rounded-full bg-amber animate-pulse' aria-hidden='true' />
          Ghost race — {result.label}
        </div>
        <button
          type='button'
          className='text-[10px] uppercase tracking-widest text-dim hover:text-foreground shrink-0'
          onClick={clearCompare}
          aria-label='Dismiss comparison'
        >
          ✕
        </button>
      </div>
      <div className={`text-[11px] mb-1.5 ${Math.abs(deltaPct) < 2 ? 'text-dim' : deltaPct > 0 ? 'text-amber' : 'text-phos'}`}>{verdict}</div>
      <div className='flex text-[10px] uppercase tracking-widest text-dim'>
        <span className='flex-1' />
        <span className='w-20 text-right'>This run</span>
        <span className='w-20 text-right'>Variant</span>
      </div>
      <VsRow label={`Capacity @ ${unit} ${result.targetSol}`} base={formatKg(baseCap)} variant={formatKg(variantCap)} />
      <VsRow
        label='Doublings'
        base={`×${Math.pow(2, state.doublings.filter((d) => d.sol <= result.targetSol).length)}`}
        variant={`×${Math.pow(2, result.doublings.length)}`}
      />
      <VsRow
        label={`First wake (${unit})`}
        base={baseWake !== undefined && baseWake.sol <= result.targetSol ? `${Math.floor(baseWake.sol)}` : '—'}
        variant={result.firstWakeSol !== null ? `${Math.floor(result.firstWakeSol)}` : '—'}
      />
      <VsRow
        label='Generation'
        base={`${baseSnapshot.generation}`}
        variant={variantSnapshot !== null ? `${variantSnapshot.generation}` : '0'}
      />
      <VsRow label='Imported (cum)' base={formatKg(baseSnapshot.importKgCum)} variant={formatKg(result.importedKgCum)} />
      {result.endState !== null && result.endState !== 'child-awoke' && result.endState !== 'three-doublings' ? (
        <div className='text-[10px] uppercase tracking-widest text-alarm mt-1'>Variant died: {result.endState.replace('-', ' ')}</div>
      ) : null}
    </section>
  );
}
