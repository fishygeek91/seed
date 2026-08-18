/**
 * SoundController: bridges the sim to the procedural audio engine.
 *
 * While sound is on, a requestAnimationFrame loop samples the current scene
 * view (live or scrubbed), steers the engine's continuous layers (wind, hum,
 * rumble, resupply jet), and fires one stinger per newly appended sim event.
 * Renders nothing.
 */

'use client';

import { useEffect, useRef } from 'react';
import { useSimStore } from '@/store/useSimStore';
import { selectView } from '@/components/view';
import { soundEngine } from '@/sound/engine';

/** Mount once inside the app shell. */
export function SoundController(): null {
  const soundOn = useSimStore((s) => s.soundOn);
  // Index of the first sim event not yet voiced. Initialized to the current
  // event count so enabling sound mid-run never replays the whole history.
  const eventCursorRef = useRef<number>(useSimStore.getState().state.events.length);

  useEffect(() => {
    soundEngine.setEnabled(soundOn);
    if (!soundOn) {
      return;
    }
    eventCursorRef.current = useSimStore.getState().state.events.length;
    let raf = 0;
    const loop = (): void => {
      const { state, scrubSol } = useSimStore.getState();
      const view = selectView(state, scrubSol);
      soundEngine.update({
        stormIntensity: view.stormIntensity,
        // Load proxy: a couple dozen working robots is "full song".
        machineLoad: Math.min(1, view.workingRobots / 24),
        kilnActive: view.kilnActive,
        isNight: view.isNight,
        resupplyDescent: view.resupplyDescent,
      });
      // Voice any events appended since the last frame. A new game shrinks
      // the log, so clamp the cursor before reading.
      const events = state.events;
      if (eventCursorRef.current > events.length) {
        eventCursorRef.current = events.length;
      }
      while (eventCursorRef.current < events.length) {
        soundEngine.playEvent(events[eventCursorRef.current].kind);
        eventCursorRef.current += 1;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      soundEngine.setEnabled(false);
    };
  }, [soundOn]);

  return null;
}
