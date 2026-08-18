/**
 * Bottom bar: time scrubber (sols/days), play/pause, speed presets, and
 * camera focus (seed / child / field).
 */

'use client';

import { useSimStore, SPEED_PRESETS } from '@/store/useSimStore';
import type { FocusTarget } from '@/store/useSimStore';

/** Playback + scrubbing controls. */
export function BottomBar(): React.ReactElement {
  const state = useSimStore((s) => s.state);
  const playing = useSimStore((s) => s.playing);
  const speedIndex = useSimStore((s) => s.speedIndex);
  const scrubSol = useSimStore((s) => s.scrubSol);
  const focus = useSimStore((s) => s.focus);
  const play = useSimStore((s) => s.play);
  const pause = useSimStore((s) => s.pause);
  const setSpeedIndex = useSimStore((s) => s.setSpeedIndex);
  const setScrubSol = useSimStore((s) => s.setScrubSol);
  const setFocus = useSimStore((s) => s.setFocus);

  const unit = state.siteId === 'mars' ? 'sol' : 'day';
  const maxSol = Math.max(1, Math.floor(state.sol));
  const scrubValue = scrubSol === null ? maxSol : Math.floor(scrubSol);

  const focusOptions: { id: FocusTarget; label: string }[] = [
    { id: 'seed', label: 'Seed' },
    { id: 'child', label: 'Child' },
    { id: 'field', label: 'Field' },
  ];

  return (
    <footer className='panel-surface flex items-center gap-3 border-t border-panel-edge px-3 py-2 shrink-0'>
      <button
        type='button'
        className='w-20 border border-panel-edge px-2 py-1.5 text-[11px] uppercase tracking-widest text-foreground hover:border-kiln hover:text-kiln transition-colors'
        onClick={() => (playing && scrubSol === null ? pause() : play())}
      >
        {playing && scrubSol === null ? 'Pause' : 'Play'}
      </button>

      <div className='flex items-center gap-1'>
        {SPEED_PRESETS.map((preset, i) => (
          <button
            key={preset}
            type='button'
            className={`border px-2 py-1.5 text-[10px] tabular-nums transition-colors ${i === speedIndex ? 'border-kiln text-kiln' : 'border-panel-edge text-dim hover:text-foreground'}`}
            onClick={() => setSpeedIndex(i)}
            aria-label={`Speed: ${preset} sim-hours per second`}
          >
            {preset}h/s
          </button>
        ))}
      </div>

      <div className='flex flex-1 items-center gap-2'>
        <span className='text-[10px] uppercase tracking-widest text-dim shrink-0'>{unit} 0</span>
        <input
          type='range'
          min={0}
          max={maxSol}
          step={1}
          value={scrubValue}
          onChange={(e) => {
            const v = Number(e.target.value);
            setScrubSol(v >= maxSol ? null : v);
          }}
          className='flex-1'
          aria-label='Time scrubber'
        />
        <span className='text-[11px] tabular-nums text-foreground shrink-0 w-28'>
          {scrubSol === null ? `${unit} ${state.sol.toFixed(1)} · LIVE` : `${unit} ${scrubValue} · PAST`}
        </span>
      </div>

      <div className='flex items-center gap-1'>
        <span className='text-[10px] uppercase tracking-widest text-dim mr-1'>Focus</span>
        {focusOptions.map((opt) => (
          <button
            key={opt.id}
            type='button'
            className={`border px-2 py-1.5 text-[10px] uppercase tracking-widest transition-colors ${focus === opt.id ? 'border-ice text-ice' : 'border-panel-edge text-dim hover:text-foreground'}`}
            onClick={() => setFocus(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </footer>
  );
}
