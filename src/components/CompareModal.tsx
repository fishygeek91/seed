/**
 * Compare modal: design a variant scenario to race against the current run.
 *
 * Prefilled with the live run's configuration so a single click (say, a
 * different cargo template) sets up a clean controlled experiment: same sol
 * horizon, same deterministic physics, one variable changed. The variant is
 * simulated headlessly and overlaid on the history strip in amber.
 */

'use client';

import { useState } from 'react';
import { useSimStore, SITE_OPTIONS, TEMPLATE_OPTIONS } from '@/store/useSimStore';
import { SITES } from '@/data/sites';
import { TEMPLATES } from '@/data/templates';
import { CONSTANTS } from '@/sim/constants';
import type { SiteId, TemplateId } from '@/sim/ids';

/** Baseline configuration snapshot handed to the form when it opens. */
interface BaselineConfig {
  readonly siteId: SiteId;
  readonly templateId: TemplateId;
  readonly payloadMassT: number;
  readonly scenarioSeed: string;
  readonly sol: number;
}

/** The comparison setup dialog. Mounts the form fresh on every open so the prefill tracks the live run. */
export function CompareModal(): React.ReactElement | null {
  const show = useSimStore((s) => s.showCompare);
  const state = useSimStore((s) => s.state);
  if (!show) {
    return null;
  }
  return (
    <CompareForm
      baseline={{
        siteId: state.siteId,
        templateId: state.templateId,
        payloadMassT: state.payloadMassT,
        scenarioSeed: state.scenarioSeed,
        sol: state.sol,
      }}
    />
  );
}

/** The form body; state initializes from the baseline at mount (i.e. at open). */
function CompareForm({ baseline }: { readonly baseline: BaselineConfig }): React.ReactElement {
  const setShow = useSimStore((s) => s.setShowCompare);
  const startCompare = useSimStore((s) => s.startCompare);

  // Prefill from the baseline run; the user changes the variable(s) to test.
  const [siteId, setSiteId] = useState<SiteId>(baseline.siteId);
  const [templateId, setTemplateId] = useState<TemplateId>(baseline.templateId);
  const [payloadMassT, setPayloadMassT] = useState<number>(baseline.payloadMassT);
  const [seedText, setSeedText] = useState<string>(baseline.scenarioSeed);

  const payloadMin = CONSTANTS.payloadMassT.min ?? 40;
  const payloadMax = CONSTANTS.payloadMassT.max ?? 200;
  const isIdentical =
    siteId === baseline.siteId &&
    templateId === baseline.templateId &&
    payloadMassT === baseline.payloadMassT &&
    seedText.trim() === baseline.scenarioSeed;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70' role='dialog' aria-label='Compare scenario'>
      <div className='w-[520px] max-w-full border border-panel-edge bg-panel p-5'>
        <h2 className='text-sm uppercase tracking-[0.25em] text-amber mb-1'>Compare</h2>
        <p className='text-[11px] text-dim mb-4 leading-relaxed'>
          Race a variant seed against this run. It is simulated headlessly to {'sol '}
          {Math.max(20, Math.floor(baseline.sol))} — same physics, same clock — then keeps pace with your run as a ghost,
          overlaid in amber on the history strip.
        </p>

        <div className='mb-4'>
          <div className='text-[10px] uppercase tracking-widest text-dim mb-1.5'>Site</div>
          <div className='flex gap-2'>
            {SITE_OPTIONS.map((s) => (
              <button
                key={s}
                type='button'
                className={`flex-1 border p-2.5 text-left transition-colors ${siteId === s ? 'border-amber' : 'border-panel-edge hover:border-dim'}`}
                onClick={() => setSiteId(s)}
              >
                <div className='text-[12px] text-foreground'>
                  {SITES[s].name}
                  {s === baseline.siteId ? <span className='text-dim'> · baseline</span> : null}
                </div>
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
                className={`border p-2.5 text-left transition-colors ${templateId === t ? 'border-amber' : 'border-panel-edge hover:border-dim'}`}
                onClick={() => setTemplateId(t)}
              >
                <div className='text-[12px] text-foreground'>
                  {TEMPLATES[t].name}
                  {t === baseline.templateId ? <span className='text-dim'> · baseline</span> : null}
                </div>
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
              aria-label='Variant payload mass in tonnes'
            />
          </label>
        </div>

        <div className='mb-5'>
          <label className='flex items-center gap-2 text-[11px]'>
            <span className='w-36 text-dim uppercase tracking-wider'>Scenario seed</span>
            <input
              type='text'
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              className='flex-1 border border-panel-edge bg-background px-2 py-1.5 text-foreground outline-none focus:border-dim'
              aria-label='Variant deterministic scenario seed string'
            />
          </label>
          <p className='text-[10px] text-dim mt-1'>Change only the seed to measure luck; change one bin to measure strategy.</p>
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
            className='border border-amber px-4 py-2 text-[11px] uppercase tracking-widest text-amber hover:bg-amber/10 disabled:opacity-40 disabled:cursor-not-allowed'
            disabled={isIdentical}
            title={isIdentical ? 'Change at least one variable — an identical run proves determinism, not strategy' : undefined}
            onClick={() =>
              startCompare({
                siteId,
                templateId,
                payloadMassT,
                scenarioSeed: seedText.trim().length > 0 ? seedText.trim() : 'seed',
              })
            }
          >
            Run variant
          </button>
        </div>
      </div>
    </div>
  );
}
