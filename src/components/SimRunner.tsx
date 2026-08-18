/**
 * SimRunner: the wall-clock heartbeat. A requestAnimationFrame loop that
 * feeds real elapsed seconds into the store's tick action. Renders nothing.
 */

'use client';

import { useEffect } from 'react';
import { useSimStore } from '@/store/useSimStore';

/** Mount once; drives the simulation clock while the tab is visible. */
export function SimRunner(): null {
  const tick = useSimStore((s) => s.tick);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number): void => {
      const dtSeconds = Math.min(0.25, (now - last) / 1000); // clamp tab-switch gaps
      last = now;
      if (dtSeconds > 0) {
        tick(dtSeconds);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tick]);
  return null;
}
