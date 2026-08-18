/**
 * HistoryStrip: the run's whole story as three linked charts that double as
 * a scrub surface.
 *
 *   capacity — log scale, so exponential growth is a straight climbing line;
 *              storm sols shaded magenta, ×2 doublings as phosphor ticks,
 *              wakes and resupply touchdowns marked along the baseline.
 *   power    — solar kWe as a filled area (storms visibly collapse it) with
 *              battery state-of-charge as an ice line on its own 0–1 axis.
 *   doubling — the headline number over time, log scale; the line breaks
 *              where growth diverged (∞). Falling line = takeoff.
 *
 * All three share one time axis. Hovering shows a crosshair plus a readout
 * of that sol; clicking or dragging scrubs the entire app — 3D scene, HUD,
 * ledgers — to that moment. Dragging to the right edge returns to live.
 */

'use client';

import { useMemo, useRef, useState } from 'react';
import { useSimStore } from '@/store/useSimStore';
import { formatDoubling, formatKg } from '@/components/view';
import type { SolSnapshot } from '@/sim/state';

/** Chart pixel geometry (viewBox units; the SVGs stretch to panel width). */
const W = 296;
const H_CAPACITY = 56;
const H_POWER = 38;
const H_DOUBLING = 38;
/** Doubling-time plot range: clamped to keep one blown-out sol from flattening the rest. */
const DBL_MIN = 10;
const DBL_MAX = 5000;

/** Everything derivable from the history array alone (memoized on its reference). */
interface StripGeometry {
  readonly firstSol: number;
  readonly lastSol: number;
  readonly capacityPoints: string;
  readonly powerPoints: string;
  readonly powerArea: string;
  readonly batteryPoints: string;
  /** Doubling-time line segments; the line breaks across ∞ stretches. */
  readonly doublingSegments: readonly string[];
  readonly stormBands: readonly { readonly x: number; readonly width: number }[];
  readonly toX: (sol: number) => number;
}

/** Map a sol onto chart x for the given span. */
function makeToX(firstSol: number, lastSol: number): (sol: number) => number {
  const span = Math.max(1, lastSol - firstSol);
  return (sol: number) => ((sol - firstSol) / span) * W;
}

/** Build every polyline and band from the snapshot history. */
function buildGeometry(history: readonly SolSnapshot[]): StripGeometry {
  const firstSol = history[0].sol;
  const lastSol = history[history.length - 1].sol;
  const toX = makeToX(firstSol, lastSol);

  // Capacity: log scale normalized to the run's own min/max.
  const logs = history.map((s) => Math.log(Math.max(1, s.capacityKg)));
  const minLog = Math.min(...logs);
  const logSpan = Math.max(0.0001, Math.max(...logs) - minLog);
  const capY = (v: number): number => H_CAPACITY - 4 - ((v - minLog) / logSpan) * (H_CAPACITY - 8);
  const capacityPoints = history.map((s, i) => `${toX(s.sol).toFixed(1)},${capY(logs[i]).toFixed(1)}`).join(' ');

  // Power: linear kWe area, plus battery fraction on its own 0–1 axis.
  const maxKwe = Math.max(1, ...history.map((s) => s.solarKwe));
  const powY = (kwe: number): number => H_POWER - 3 - (kwe / maxKwe) * (H_POWER - 7);
  const powerPoints = history.map((s) => `${toX(s.sol).toFixed(1)},${powY(s.solarKwe).toFixed(1)}`).join(' ');
  const powerArea = `${toX(firstSol).toFixed(1)},${H_POWER - 3} ${powerPoints} ${toX(lastSol).toFixed(1)},${H_POWER - 3}`;
  const batY = (fraction: number): number => H_POWER - 3 - fraction * (H_POWER - 7);
  const batteryPoints = history.map((s) => `${toX(s.sol).toFixed(1)},${batY(s.batteryFraction).toFixed(1)}`).join(' ');

  // Doubling time: log scale, segments broken across ∞ (null / diverging).
  const dblY = (value: number): number => {
    const clamped = Math.min(DBL_MAX, Math.max(DBL_MIN, value));
    const frac = (Math.log(clamped) - Math.log(DBL_MIN)) / (Math.log(DBL_MAX) - Math.log(DBL_MIN));
    return H_DOUBLING - 3 - frac * (H_DOUBLING - 7);
  };
  const doublingSegments: string[] = [];
  let segment: string[] = [];
  for (const s of history) {
    const finite = s.doublingTimeSols !== null && s.doublingTimeSols < 10000;
    if (finite && s.doublingTimeSols !== null) {
      segment.push(`${toX(s.sol).toFixed(1)},${dblY(s.doublingTimeSols).toFixed(1)}`);
    } else if (segment.length > 0) {
      doublingSegments.push(segment.join(' '));
      segment = [];
    }
  }
  if (segment.length > 0) {
    doublingSegments.push(segment.join(' '));
  }

  // Contiguous storm bands (optical depth well above quiet baseline).
  const stormBands: { x: number; width: number }[] = [];
  let bandStart: number | null = null;
  for (let i = 0; i < history.length; i += 1) {
    const stormy = history[i].opticalDepth > 2;
    if (stormy && bandStart === null) {
      bandStart = history[i].sol;
    }
    if ((!stormy || i === history.length - 1) && bandStart !== null) {
      stormBands.push({ x: toX(bandStart), width: Math.max(1, toX(history[i].sol) - toX(bandStart)) });
      bandStart = null;
    }
  }

  return { firstSol, lastSol, capacityPoints, powerPoints, powerArea, batteryPoints, doublingSegments, stormBands, toX };
}

/** The crosshair line rendered into each chart at the inspected sol. */
function Crosshair({ x, height, live }: { readonly x: number; readonly height: number; readonly live: boolean }): React.ReactElement {
  return <line x1={x} y1={0} x2={x} y2={height} stroke='#3fd2ff' strokeWidth={1} strokeDasharray={live ? undefined : '2 2'} opacity={live ? 1 : 0.7} />;
}

/** The interactive three-chart history strip. Renders nothing until the run has a story. */
export function HistoryStrip(): React.ReactElement | null {
  const history = useSimStore((s) => s.state.history);
  const doublings = useSimStore((s) => s.state.doublings);
  const events = useSimStore((s) => s.state.events);
  const siteId = useSimStore((s) => s.state.siteId);
  const scrubSol = useSimStore((s) => s.scrubSol);
  const setScrubSol = useSimStore((s) => s.setScrubSol);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [hoverSol, setHoverSol] = useState<number | null>(null);

  // Polylines and bands rebuild only when a new snapshot lands (the history
  // array reference is stable between sols), not on every sim tick.
  const geometry = useMemo(() => (history.length >= 3 ? buildGeometry(history) : null), [history]);

  // Event markers along the capacity baseline: wakes phosphor, resupplies ice.
  const markers = useMemo(() => {
    if (geometry === null) {
      return [];
    }
    return events
      .filter((e) => e.kind === 'child-wake' || e.kind === 'resupply')
      .map((e) => ({ x: geometry.toX(e.sol), wake: e.kind === 'child-wake' }));
  }, [events, geometry]);

  if (geometry === null) {
    return null;
  }

  /** Convert a pointer position to a sol on the strip's time axis. */
  const solAtClientX = (clientX: number): number => {
    const el = containerRef.current;
    if (el === null) {
      return geometry.lastSol;
    }
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    return geometry.firstSol + frac * (geometry.lastSol - geometry.firstSol);
  };

  /** Scrub the app to a sol; the far right edge means "return to live". */
  const scrubTo = (sol: number): void => {
    setScrubSol(sol >= geometry.lastSol - 0.5 ? null : Math.floor(sol));
  };

  // The sol under inspection: hover wins, then the active scrub, then live.
  const inspectSol = hoverSol ?? scrubSol;
  const crosshairX = inspectSol !== null ? geometry.toX(inspectSol) : null;
  const readoutSnapshot =
    inspectSol !== null
      ? (history.find((s) => s.sol === Math.floor(inspectSol)) ?? history[history.length - 1])
      : history[history.length - 1];
  const unit = siteId === 'mars' ? 'sol' : 'day';

  return (
    <div
      ref={containerRef}
      className='flex flex-col gap-1 cursor-ew-resize touch-none select-none'
      onPointerDown={(e) => {
        draggingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        scrubTo(solAtClientX(e.clientX));
      }}
      onPointerMove={(e) => {
        setHoverSol(solAtClientX(e.clientX));
        if (draggingRef.current) {
          scrubTo(solAtClientX(e.clientX));
        }
      }}
      onPointerUp={(e) => {
        draggingRef.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerLeave={() => setHoverSol(null)}
      role='slider'
      aria-label='Run history — hover to inspect, drag to scrub time'
      aria-valuemin={geometry.firstSol}
      aria-valuemax={geometry.lastSol}
      aria-valuenow={Math.floor(inspectSol ?? geometry.lastSol)}
      tabIndex={-1}
    >
      {/* Capacity, log scale. */}
      <svg viewBox={`0 0 ${W} ${H_CAPACITY}`} className='w-full border border-panel-edge bg-black/30' role='img' aria-label='Capacity growth, log scale'>
        {geometry.stormBands.map((band, i) => (
          <rect key={`storm-${i}`} x={band.x} y={0} width={band.width} height={H_CAPACITY} fill='#ff3d8a' opacity={0.14} />
        ))}
        {doublings.map((d) => (
          <line key={`dbl-${d.multiple}`} x1={geometry.toX(d.sol)} y1={0} x2={geometry.toX(d.sol)} y2={H_CAPACITY} stroke='#2bff9e' strokeWidth={1} opacity={0.8} />
        ))}
        {markers.map((m, i) => (
          <line
            key={`mark-${i}`}
            x1={m.x}
            y1={m.wake ? H_CAPACITY - 5 : H_CAPACITY - 7}
            x2={m.x}
            y2={H_CAPACITY - 1}
            stroke={m.wake ? '#2bff9e' : '#3fd2ff'}
            strokeWidth={m.wake ? 1 : 1.4}
            opacity={0.9}
          />
        ))}
        <polyline points={geometry.capacityPoints} fill='none' stroke='#b6e9d6' strokeWidth={1.4} />
        {crosshairX !== null ? <Crosshair x={crosshairX} height={H_CAPACITY} live={hoverSol === null} /> : null}
        <text x={3} y={10} fontSize={7} fill='#45705f' fontFamily='inherit'>
          log capacity · ×2 ticks · wakes + drops on baseline
        </text>
      </svg>

      {/* Solar power + battery state of charge. */}
      <svg viewBox={`0 0 ${W} ${H_POWER}`} className='w-full border border-panel-edge bg-black/30' role='img' aria-label='Solar power and battery charge'>
        <polygon points={geometry.powerArea} fill='#2bff9e' opacity={0.14} />
        <polyline points={geometry.powerPoints} fill='none' stroke='#2bff9e' strokeWidth={1} opacity={0.85} />
        <polyline points={geometry.batteryPoints} fill='none' stroke='#3fd2ff' strokeWidth={1} opacity={0.8} />
        {crosshairX !== null ? <Crosshair x={crosshairX} height={H_POWER} live={hoverSol === null} /> : null}
        <text x={3} y={9} fontSize={7} fill='#45705f' fontFamily='inherit'>
          solar kWe · battery SoC
        </text>
      </svg>

      {/* Doubling time, log scale; the line breaks where growth diverged. */}
      <svg viewBox={`0 0 ${W} ${H_DOUBLING}`} className='w-full border border-panel-edge bg-black/30' role='img' aria-label='Doubling time over the run'>
        {geometry.doublingSegments.map((points, i) => (
          <polyline key={`dblseg-${i}`} points={points} fill='none' stroke='#ffc857' strokeWidth={1.1} opacity={0.9} />
        ))}
        {crosshairX !== null ? <Crosshair x={crosshairX} height={H_DOUBLING} live={hoverSol === null} /> : null}
        <text x={3} y={9} fontSize={7} fill='#45705f' fontFamily='inherit'>
          doubling time (log) · gaps = ∞ · falling = takeoff
        </text>
      </svg>

      {/* Readout for the inspected sol (or the latest when live). */}
      <div className='flex justify-between text-[10px] tabular-nums text-dim'>
        <span className={inspectSol !== null ? 'text-ice' : ''}>
          {unit} {readoutSnapshot.sol}
        </span>
        <span>cap {formatKg(readoutSnapshot.capacityKg)}</span>
        <span>dbl {formatDoubling(readoutSnapshot.doublingTimeSols)}</span>
        <span>{readoutSnapshot.solarKwe.toFixed(0)} kWe</span>
        <span>batt {(readoutSnapshot.batteryFraction * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}
