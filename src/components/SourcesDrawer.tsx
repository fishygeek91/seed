/**
 * Sources & assumptions drawer: renders the audited constants table from
 * constants.ts verbatim. If a number is assumed, it says ASSUMED and why.
 */

'use client';

import { CONSTANTS } from '@/sim/constants';
import type { ConstantKey } from '@/sim/constants';
import { useSimStore } from '@/store/useSimStore';

/** The slide-over drawer listing every audited constant and its provenance. */
export function SourcesDrawer(): React.ReactElement | null {
  const show = useSimStore((s) => s.showSources);
  const setShow = useSimStore((s) => s.setShowSources);
  if (!show) {
    return null;
  }
  const keys = Object.keys(CONSTANTS) as ConstantKey[];
  return (
    <div className='fixed inset-0 z-50 flex' role='dialog' aria-label='Sources and assumptions'>
      <button type='button' className='flex-1 bg-black/60' onClick={() => setShow(false)} aria-label='Close sources drawer' />
      <div className='w-[560px] max-w-full overflow-y-auto border-l border-panel-edge bg-panel p-5'>
        <div className='flex items-center justify-between mb-4'>
          <h2 className='text-sm uppercase tracking-[0.25em] text-kiln'>Sources &amp; assumptions</h2>
          <button type='button' className='text-dim hover:text-foreground text-lg leading-none' onClick={() => setShow(false)}>
            ×
          </button>
        </div>
        <p className='text-[11px] text-dim leading-relaxed mb-4'>
          Every default lives in <span className='text-foreground'>src/sim/constants.ts</span>. Cited numbers name their paper or
          handbook; assumed numbers are labeled ASSUMED with a reason. Prefer being numerically conservative and cited over being
          pretty and wrong.
        </p>
        <div className='flex flex-col gap-3'>
          {keys.map((key) => {
            const c = CONSTANTS[key];
            const assumed = c.source.includes('ASSUMED');
            return (
              <div key={key} className='border border-panel-edge p-2.5'>
                <div className='flex justify-between items-baseline gap-2'>
                  <span className='text-[12px] text-foreground'>{c.label}</span>
                  <span className='text-[12px] tabular-nums text-kiln shrink-0'>
                    {c.value} {c.unit}
                  </span>
                </div>
                <p className={`text-[10px] leading-relaxed mt-1 ${assumed ? 'text-rust' : 'text-dim'}`}>{c.source}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
