/**
 * New-game modal: pick Earth or Mars, a cargo template, payload mass, and a
 * scenario seed string. Same seed + same inputs => same history.
 */

'use client';

import { useState } from 'react';
import { useSimStore, SITE_OPTIONS, TEMPLATE_OPTIONS } from '@/store/useSimStore';
import { SITES } from '@/data/sites';
import { TEMPLATES } from '@/data/templates';
import { CONSTANTS } from '@/sim/constants';
import type { SiteId, TemplateId } from '@/sim/ids';

/** The scenario setup dialog. */
export function NewGameModal(): React.ReactElement | null {
  const show = useSimStore((s) => s.showNewGame);
  const setShow = useSimStore((s) => s.setShowNewGame);
  const newGame = useSimStore((s) => s.newGame);

  const [siteId, setSiteId] = useState<SiteId>('mars');
  const [templateId, setTemplateId] = useState<TemplateId>('balanced');
  const [payloadMassT, setPayloadMassT] = useState<number>(CONSTANTS.payloadMassT.value);
  const [seedText, setSeedText] = useState<string>('demo-arcadia-01');

  if (!show) {
    return null;
  }
  const payloadMin = CONSTANTS.payloadMassT.min ?? 40;
  const payloadMax = CONSTANTS.payloadMassT.max ?? 200;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70' role='dialog' aria-label='New seed'>
      <div className='w-[520px] max-w-full border border-panel-edge bg-panel p-5'>
        <h2 className='text-sm uppercase tracking-[0.25em] text-phos mb-4'>New seed</h2>

        <div className='mb-4'>
          <div className='text-[10px] uppercase tracking-widest text-dim mb-1.5'>Site</div>
          <div className='flex gap-2'>
            {SITE_OPTIONS.map((s) => (
              <button
                key={s}
                type='button'
                className={`flex-1 border p-2.5 text-left transition-colors ${siteId === s ? 'border-phos' : 'border-panel-edge hover:border-dim'}`}
                onClick={() => setSiteId(s)}
              >
                <div className='text-[12px] text-foreground'>{SITES[s].name}</div>
                <div className='text-[10px] text-dim mt-1 leading-relaxed'>{SITES[s].blurb}</div>
              </button>
            ))}
          </div>
        </div>

        <div className='mb-4'>
          <div className='text-[10px] uppercase tracking-widest text-dim mb-1.5'>Cargo template</div>
          <div className='grid grid-cols-2 gap-2'>
            {TEMPLATE_OPTIONS.map((t) => (
              <button
                key={t}
                type='button'
                className={`border p-2.5 text-left transition-colors ${templateId === t ? 'border-phos' : 'border-panel-edge hover:border-dim'}`}
                onClick={() => setTemplateId(t)}
              >
                <div className='text-[12px] text-foreground'>{TEMPLATES[t].name}</div>
                <div className='text-[10px] text-dim mt-1 leading-relaxed'>{TEMPLATES[t].blurb}</div>
              </button>
            ))}
          </div>
        </div>

        <div className='mb-4'>
          <label className='flex items-center gap-2 text-[11px]'>
            <span className='w-36 text-dim uppercase tracking-wider'>Payload mass: {payloadMassT} t</span>
            <input
              type='range'
              min={payloadMin}
              max={payloadMax}
              step={CONSTANTS.payloadMassT.step ?? 5}
              value={payloadMassT}
              onChange={(e) => setPayloadMassT(Number(e.target.value))}
              className='flex-1'
              aria-label='Payload mass in tonnes'
            />
          </label>
          <p className='text-[10px] text-dim mt-1'>{CONSTANTS.payloadMassT.source}</p>
        </div>

        <div className='mb-5'>
          <label className='flex items-center gap-2 text-[11px]'>
            <span className='w-36 text-dim uppercase tracking-wider'>Scenario seed</span>
            <input
              type='text'
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              className='flex-1 border border-panel-edge bg-background px-2 py-1.5 text-foreground outline-none focus:border-dim'
              aria-label='Deterministic scenario seed string'
            />
          </label>
          <p className='text-[10px] text-dim mt-1'>Deterministic: same seed + same inputs =&gt; same history.</p>
        </div>

        <div className='flex justify-end gap-2'>
          <button
            type='button'
            className='border border-panel-edge px-4 py-2 text-[11px] uppercase tracking-widest text-dim hover:text-foreground'
            onClick={() => setShow(false)}
          >
            Cancel
          </button>
          <button
            type='button'
            className='border border-phos px-4 py-2 text-[11px] uppercase tracking-widest text-phos hover:bg-phos/10'
            onClick={() =>
              newGame({
                siteId,
                templateId,
                payloadMassT,
                scenarioSeed: seedText.trim().length > 0 ? seedText.trim() : 'seed',
              })
            }
          >
            Land it
          </button>
        </div>
      </div>
    </div>
  );
}
