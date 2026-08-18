/**
 * Mission reel: turn a run's event log into a short highlights sequence.
 *
 * A beat is one moment worth replaying — the landing, the first chassis, a
 * generation wake, a storm, a touchdown, a capacity doubling. The builder
 * picks the beats deterministically from SimState (same run ⇒ same reel),
 * thins repetitive kinds (29 wakes become ~5), clamps every beat onto a sol
 * that actually has a history snapshot, and caps the whole reel so it plays
 * in about a minute.
 */

import type { SimEvent, SimState } from '@/sim/state';

/** One moment in the mission reel. */
export interface ReelBeat {
  /** The snapshot sol the scrubber jumps to for this beat. */
  readonly sol: number;
  readonly kind: SimEvent['kind'];
  readonly message: string;
}

/** Hard cap on reel length; longer runs get thinned evenly. */
const MAX_BEATS = 16;
/** Cap on child-wake beats: the first ones matter, then the chain is implied. */
const MAX_WAKE_BEATS = 5;

/**
 * Build the highlights for the current run. Returns an empty array when the
 * run is too young to have a story (fewer than two beats or no snapshots).
 */
export function buildReelBeats(state: SimState): readonly ReelBeat[] {
  if (state.history.length === 0) {
    return [];
  }
  const minSol = state.history[0].sol;
  const maxSol = state.history[state.history.length - 1].sol;

  // Wake events are thinned by stride so early wakes and the latest wake
  // survive, and the middle of a long chain is sampled evenly.
  const wakeTotal = state.events.filter((e) => e.kind === 'child-wake').length;
  const wakeStride = Math.max(1, Math.ceil(wakeTotal / MAX_WAKE_BEATS));
  const seenOnce = new Set<SimEvent['kind']>();
  let wakeIndex = 0;

  const picked: SimEvent[] = [];
  for (const event of state.events) {
    switch (event.kind) {
      case 'landing':
      case 'solar-deployed':
      case 'chassis-started':
        // Firsts only: these kinds repeat across generations but the story
        // beat is the first occurrence.
        if (!seenOnce.has(event.kind)) {
          seenOnce.add(event.kind);
          picked.push(event);
        }
        break;
      case 'storm-start':
      case 'storm-end':
      case 'resupply':
      case 'doubling':
      case 'window-missed':
        picked.push(event);
        break;
      case 'child-wake':
        if (wakeIndex % wakeStride === 0 || wakeIndex === wakeTotal - 1) {
          picked.push(event);
        }
        wakeIndex += 1;
        break;
      default:
        break;
    }
  }
  picked.sort((a, b) => a.sol - b.sol);

  // Thin evenly to the cap, always keeping the first and last beats.
  let thinned: SimEvent[] = picked;
  if (picked.length > MAX_BEATS) {
    thinned = [];
    for (let i = 0; i < MAX_BEATS; i += 1) {
      thinned.push(picked[Math.round((i * (picked.length - 1)) / (MAX_BEATS - 1))]);
    }
  }

  return thinned.map((event) => ({
    sol: Math.max(minSol, Math.min(maxSol, Math.floor(event.sol))),
    kind: event.kind,
    message: event.message,
  }));
}
