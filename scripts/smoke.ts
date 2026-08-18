/**
 * Headless smoke test: run the default demo scenario for several hundred
 * sols and print the beats. Checks determinism and mass-ledger closure.
 *
 * Run: npx tsx scripts/smoke.ts
 */

import { createInitialState } from '@/sim/state';
import { advanceSols, capacityMassKg } from '@/sim/step';
import { defaultNewGameOptions } from '@/store/useSimStore';
import { renderSeedBrief } from '@/sim/brief';

function run(): void {
  const options = defaultNewGameOptions();
  let state = createInitialState(options);
  const checkpoints = [1, 5, 20, 60, 120, 200, 240, 320, 400, 500, 600];
  let previous = 0;
  for (const target of checkpoints) {
    state = advanceSols(state, target - previous, 1);
    previous = target;
    const latest = state.history[state.history.length - 1];
    console.log(
      `sol ${String(target).padStart(3)} | cap ${(capacityMassKg(state) / 1000).toFixed(1)} t | dbl ${
        latest?.doublingTimeSols === null || latest === undefined ? '∞' : latest.doublingTimeSols.toFixed(0)
      } | gen ${state.generation} | child ${(state.child.completionFraction * 100).toFixed(0)}% | vits ${(latest?.vitaminsKg ?? 0).toFixed(0)} kg | closure ${(state.massClosureError * 100).toFixed(3)}% | robots w/b ${
        latest?.workingRobots ?? 0
      }/${latest?.brokenRobots ?? 0} | end ${state.endState ?? '-'}`,
    );
  }
  console.log('\n--- events ---');
  for (const event of state.events) {
    if (['landing', 'solar-deployed', 'first-print', 'chassis-started', 'storm-start', 'storm-end', 'resupply', 'child-wake', 'doubling', 'localized', 'vitamin-stall', 'energy-crisis'].includes(event.kind)) {
      console.log(`[sol ${event.sol.toFixed(0)}] ${event.kind}: ${event.message}`);
    }
  }

  // Determinism check: replay and compare.
  let replay = createInitialState(options);
  replay = advanceSols(replay, 200, 1);
  let reference = createInitialState(options);
  reference = advanceSols(reference, 200, 1);
  const same = JSON.stringify(replay.history[replay.history.length - 1]) === JSON.stringify(reference.history[reference.history.length - 1]);
  console.log(`\nDeterminism (200 sols, two runs identical): ${same ? 'PASS' : 'FAIL'}`);
  console.log(`Mass closure error at sol 600: ${(state.massClosureError * 100).toFixed(4)}% ${state.massClosureError < 0.005 ? 'PASS' : 'FAIL'}`);
  console.log(`\n${renderSeedBrief(state).slice(0, 400)}...`);
}

run();
