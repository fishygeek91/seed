/**
 * ReelController: paces the mission reel. While a reel is running, each beat
 * holds on screen for a fixed dwell, fires its sound stinger (the engine
 * no-ops when sound is off), and then advances; after the last beat the
 * store returns the view to live. Renders nothing.
 */

'use client';

import { useEffect } from 'react';
import { useSimStore } from '@/store/useSimStore';
import { soundEngine } from '@/sound/engine';

/** Seconds each reel beat holds before the cut. */
const BEAT_DWELL_MS = 4500;

/** Mount once inside the app shell. */
export function ReelController(): null {
  const reelActive = useSimStore((s) => s.reelBeats !== null);
  const reelIndex = useSimStore((s) => s.reelIndex);

  useEffect(() => {
    if (!reelActive) {
      return;
    }
    // Voice the beat that just came on screen, then schedule the cut.
    const { reelBeats } = useSimStore.getState();
    if (reelBeats !== null && reelIndex < reelBeats.length) {
      soundEngine.playEvent(reelBeats[reelIndex].kind);
    }
    const timer = window.setTimeout(() => useSimStore.getState().advanceReel(), BEAT_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [reelActive, reelIndex]);

  return null;
}
