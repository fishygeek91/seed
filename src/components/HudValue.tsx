/**
 * HudValue: a number with a hover tooltip showing its formula and its
 * source or assumption. Every headline number in SEED routes through this
 * so nothing on screen is unexplained.
 */

'use client';

import { useState, useRef } from 'react';

interface HudValueProps {
  readonly label: string;
  readonly value: string;
  /** Multi-line explanation: formula on one line, source/assumption after. */
  readonly formula: string;
  readonly accent?: 'kiln' | 'ice' | 'alarm' | 'ok' | 'none';
  readonly big?: boolean;
}

/** Inline HUD stat with a formula/source tooltip on hover. */
export function HudValue({ label, value, formula, accent = 'none', big = false }: HudValueProps): React.ReactElement {
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const accentClass =
    accent === 'kiln'
      ? 'text-kiln'
      : accent === 'ice'
        ? 'text-ice'
        : accent === 'alarm'
          ? 'text-alarm'
          : accent === 'ok'
            ? 'text-ok'
            : 'text-foreground';

  return (
    <div
      ref={ref}
      className='relative flex flex-col items-start px-2 cursor-help select-none'
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className='text-[10px] uppercase tracking-widest text-dim'>{label}</span>
      <span className={`${accentClass} ${big ? 'text-lg' : 'text-sm'} font-semibold tabular-nums`}>{value}</span>
      {hover ? <div className='hud-tip top-full left-0 mt-1'>{formula}</div> : null}
    </div>
  );
}
