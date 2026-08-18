/**
 * Left panel: site context, the factory field seen from above (one pad per
 * active seed), robot-hour allocation sliders, and the event feed.
 */

'use client';

import { useSimStore } from '@/store/useSimStore';
import { selectView } from '@/components/view';
import { SITES } from '@/data/sites';
import { TASK_IDS, TASK_LABELS } from '@/sim/ids';
import type { TaskId } from '@/sim/ids';

/** Top-down factory field: pads appear as generations wake. Mars stays red. */
function FieldMap(): React.ReactElement {
  const state = useSimStore((s) => s.state);
  const scrubSol = useSimStore((s) => s.scrubSol);
  const view = selectView(state, scrubSol);
  const ground = view.siteId === 'mars' ? '#3d1f12' : '#22261f';
  const padCount = view.activeSeedCount;
  const gestating = view.childCompletion > 0.02;

  // Pads spiral out from the origin pad.
  const pads: { x: number; y: number; kind: 'active' | 'gestating' }[] = [];
  for (let i = 0; i < padCount; i += 1) {
    const angle = i * 2.4; // golden-angle-ish spiral
    const radius = i === 0 ? 0 : 18 + i * 14;
    pads.push({ x: 100 + Math.cos(angle) * radius, y: 70 + Math.sin(angle) * radius * 0.7, kind: 'active' });
  }
  if (gestating) {
    const i = padCount;
    const angle = i * 2.4;
    const radius = 18 + i * 14;
    pads.push({ x: 100 + Math.cos(angle) * radius, y: 70 + Math.sin(angle) * radius * 0.7, kind: 'gestating' });
  }

  return (
    <svg viewBox='0 0 200 140' className='w-full border border-panel-edge' role='img' aria-label='Factory field from above'>
      <rect width='200' height='140' fill={ground} />
      {/* haul roads */}
      {pads.slice(1).map((pad, i) => (
        <line key={`road-${i}`} x1='100' y1='70' x2={pad.x} y2={pad.y} stroke='#00000055' strokeWidth='2' />
      ))}
      {pads.map((pad, i) => (
        <g key={`pad-${i}`}>
          <rect x={pad.x - 7} y={pad.y - 7} width='14' height='14' fill={pad.kind === 'active' ? '#c9ced4' : '#6b7480'} opacity={pad.kind === 'active' ? 0.9 : 0.5} />
          {pad.kind === 'active' ? <rect x={pad.x - 10} y={pad.y - 10} width='20' height='3' fill='#1f2937' /> : null}
          {pad.kind === 'gestating' ? (
            <rect x={pad.x - 7} y={pad.y - 7} width={14 * view.childCompletion} height='14' fill='#ff7a1a' opacity='0.8' />
          ) : null}
        </g>
      ))}
      {view.stormIntensity > 0.15 ? (
        <rect width='200' height='140' fill={view.siteId === 'mars' ? '#8a4a2f' : '#4a5568'} opacity={view.stormIntensity * 0.55} />
      ) : null}
      {view.isNight ? <rect width='200' height='140' fill='#000010' opacity='0.5' /> : null}
    </svg>
  );
}

/** Robot-hour / power allocation sliders. */
function AllocationPanel(): React.ReactElement {
  const allocations = useSimStore((s) => s.state.allocations);
  const setAllocation = useSimStore((s) => s.setAllocation);
  const total = TASK_IDS.reduce((sum, t) => sum + Math.max(0, allocations[t]), 0);

  return (
    <div className='flex flex-col gap-1.5'>
      {TASK_IDS.map((task: TaskId) => {
        const share = total > 0 ? (allocations[task] / total) * 100 : 0;
        return (
          <label key={task} className='flex items-center gap-2 text-[11px]'>
            <span className='w-24 text-dim uppercase tracking-wider shrink-0'>{TASK_LABELS[task]}</span>
            <input
              type='range'
              min={0}
              max={100}
              step={1}
              value={allocations[task]}
              onChange={(e) => setAllocation(task, Number(e.target.value))}
              className='flex-1'
              aria-label={`Allocation for ${TASK_LABELS[task]}`}
            />
            <span className='w-9 text-right tabular-nums text-foreground'>{share.toFixed(0)}%</span>
          </label>
        );
      })}
    </div>
  );
}

/** Recent event feed, newest first. */
function EventFeed(): React.ReactElement {
  const events = useSimStore((s) => s.state.events);
  const recent = events.slice(-14).reverse();
  return (
    <div className='flex flex-col gap-1 overflow-y-auto min-h-0'>
      {recent.map((event, i) => {
        const color =
          event.kind === 'child-wake' || event.kind === 'doubling' || event.kind === 'localized'
            ? 'text-kiln'
            : event.kind === 'storm-start' || event.kind === 'energy-crisis' || event.kind === 'vitamin-stall' || event.kind === 'robot-failure'
              ? 'text-alarm'
              : event.kind === 'resupply'
                ? 'text-ice'
                : 'text-dim';
        return (
          <div key={`${event.sol}-${event.kind}-${i}`} className='text-[11px] leading-snug'>
            <span className='text-dim tabular-nums'>[{event.sol.toFixed(0)}]</span>{' '}
            <span className={color}>{event.message}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The assembled left column. */
export function LeftPanel(): React.ReactElement {
  const state = useSimStore((s) => s.state);
  const site = SITES[state.siteId];

  return (
    <aside className='panel-surface flex w-72 shrink-0 flex-col gap-3 border-r border-panel-edge p-3 overflow-y-auto'>
      <div>
        <h2 className='text-[10px] uppercase tracking-widest text-dim mb-1'>Site</h2>
        <p className='text-xs leading-relaxed text-foreground'>{site.blurb}</p>
      </div>
      <div>
        <h2 className='text-[10px] uppercase tracking-widest text-dim mb-1'>Factory field</h2>
        <FieldMap />
      </div>
      <div>
        <h2 className='text-[10px] uppercase tracking-widest text-dim mb-1'>Robot-hour allocation</h2>
        <AllocationPanel />
      </div>
      <div className='flex-1 min-h-0 flex flex-col'>
        <h2 className='text-[10px] uppercase tracking-widest text-dim mb-1'>Event feed</h2>
        <EventFeed />
      </div>
    </aside>
  );
}
