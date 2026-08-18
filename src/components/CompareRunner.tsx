/**
 * CompareRunner: executes comparison runs headlessly in the background.
 *
 * Phase 1 — catch-up: when the store enters the 'running' compare state,
 * the variant scenario is stepped with the same pure step() the live sim
 * uses, sliced across setTimeout turns (a handful of sols per slice) so
 * the UI never stutters, until it reaches the baseline's sol.
 *
 * Phase 2 — ghost race: after catch-up the variant SimState is kept alive
 * in a ref, and every time the live run gains a sol the variant is stepped
 * to match, streaming updated results into the store. The amber curve on
 * the history strip grows in lockstep with yours and the verdict card
 * re-calls the race every sol. Renders nothing.
 */

'use client';

import { useEffect, useRef } from 'react';
import { useSimStore } from '@/store/useSimStore';
import type { CompareResult } from '@/store/useSimStore';
import type { SimState } from '@/sim/state';
import { createInitialState } from '@/sim/state';
import { step } from '@/sim/step';

/** Sols simulated per catch-up slice — small enough to keep frames fluid. */
const SOLS_PER_SLICE = 10;
/** Internal tick, hours — matches the live sim's tick for a fair comparison. */
const TICK_HOURS = 1;

/** Distill a variant SimState into the store-facing result shape. */
function distill(sim: SimState, label: string): CompareResult {
  const firstWake = sim.events.find((e) => e.kind === 'child-wake');
  return {
    label,
    options: { siteId: sim.siteId, templateId: sim.templateId, payloadMassT: sim.payloadMassT, scenarioSeed: sim.scenarioSeed },
    targetSol: Math.floor(sim.sol),
    history: sim.history,
    doublings: sim.doublings,
    generation: sim.generation,
    firstWakeSol: firstWake !== undefined ? firstWake.sol : null,
    endState: sim.endState,
    importedKgCum: sim.importedKgCum,
  };
}

/** Mount once inside the app shell. */
export function CompareRunner(): null {
  const runId = useSimStore((s) => s.compareRunId);
  const compareKind = useSimStore((s) => s.compare.kind);
  // One render per whole live sol: enough to keep the ghost pacing.
  const liveSol = useSimStore((s) => Math.floor(s.state.sol));
  // The variant's living state across effect runs; null until catch-up ends.
  const ghostRef = useRef<SimState | null>(null);
  const ghostLabelRef = useRef('');

  // Phase 1: catch-up after startCompare.
  useEffect(() => {
    if (compareKind !== 'running') {
      return;
    }
    const startStatus = useSimStore.getState().compare;
    if (startStatus.kind !== 'running') {
      return;
    }
    const { options, label, targetSol } = startStatus;
    ghostRef.current = null; // a new race replaces any previous ghost
    let sim = createInitialState(options);
    let cancelled = false;
    let timer = 0;

    const slice = (): void => {
      if (cancelled) {
        return;
      }
      const store = useSimStore.getState();
      if (store.compare.kind !== 'running') {
        return; // dismissed mid-run
      }
      const sliceTarget = Math.min(targetSol, sim.sol + SOLS_PER_SLICE);
      while (sim.sol < sliceTarget) {
        sim = step(sim, TICK_HOURS);
      }
      if (sim.sol >= targetSol) {
        ghostRef.current = sim;
        ghostLabelRef.current = label;
        store.finishCompare(distill(sim, label));
        return;
      }
      store.setCompareProgress(sim.sol);
      timer = window.setTimeout(slice, 0);
    };
    timer = window.setTimeout(slice, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // runId (not the compare object) keys the effect: progress updates must
    // not restart the loop, but a fresh startCompare must.
  }, [runId, compareKind]);

  // Phase 2: ghost race — keep the finished variant level with the live sol.
  useEffect(() => {
    if (compareKind === 'idle') {
      ghostRef.current = null; // dismissed: let the ghost state be collected
      return;
    }
    if (compareKind !== 'done') {
      return;
    }
    let ghost = ghostRef.current;
    if (ghost === null || ghost.sol >= liveSol) {
      return;
    }
    // Usually one sol of catch-up per live sol: cheap enough to run inline.
    while (ghost.sol < liveSol) {
      ghost = step(ghost, TICK_HOURS);
    }
    ghostRef.current = ghost;
    useSimStore.getState().extendCompare(distill(ghost, ghostLabelRef.current));
  }, [compareKind, liveSol]);

  return null;
}
