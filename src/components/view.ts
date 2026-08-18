/**
 * View-model helpers: turn SimState (live) or a SolSnapshot (scrubbed
 * history) into the small set of numbers the HUD and 3D scene render.
 */

'use client';

import type { SimState, SolSnapshot } from '@/sim/state';
import { SITES } from '@/data/sites';
import { ELEMENT_IDS, PART_IDS, VITAMIN_IDS } from '@/sim/ids';
import { capacityMassKg } from '@/sim/step';
import { constantValue } from '@/sim/constants';

/** Everything the 3D scene and top bar need for one rendered frame. */
export interface SceneView {
  readonly siteId: SimState['siteId'];
  readonly sol: number;
  readonly hourOfSol: number;
  readonly solLengthHours: number;
  readonly isNight: boolean;
  /** 0 quiet — 1 full global storm (scaled from optical depth). */
  readonly stormIntensity: number;
  /** Solar deployment animation 0–1 over the first sols. */
  readonly solarDeployFraction: number;
  /** True when the print yard is drawing power (kiln glow on). */
  readonly kilnActive: boolean;
  readonly childCompletion: number;
  readonly childWalking: boolean;
  /** Woken descendant seeds shown out on the plain (excludes gen 0 + walker). */
  readonly colonyCount: number;
  /** Resupply landers that have already touched down (persist as cargo pods). */
  readonly resupplyCount: number;
  /** Descent animation progress 0–1 while a shipment is on final approach, else null. */
  readonly resupplyDescent: number | null;
  readonly generation: number;
  readonly activeSeedCount: number;
  readonly workingRobots: number;
  readonly brokenRobots: number;
  readonly scrapKg: number;
  readonly junkCount: number;
  readonly capacityKg: number;
  readonly doublingTimeSols: number | null;
  readonly solarKwe: number;
  readonly batteryFraction: number;
  readonly vitaminsKg: number;
  readonly isHistorical: boolean;
}

/** Sun factor duplicated from the sim (display only). */
function sunUp(hourOfSol: number, solLengthHours: number): boolean {
  const dayLength = solLengthHours * 0.5;
  const dawn = (solLengthHours - dayLength) / 2;
  return hourOfSol >= dawn && hourOfSol <= dawn + dayLength;
}

/** Build the scene view from the live sim state. */
export function liveView(state: SimState): SceneView {
  const site = SITES[state.siteId];
  const tauIdx = Math.floor(state.sol) % site.opticalDepthBySol.length;
  const tau = site.opticalDepthBySol[tauIdx];
  const peak = constantValue('dustStormOpticalDepthPeak');
  let scrapKg = 0;
  for (const el of ELEMENT_IDS) {
    scrapKg += state.atoms.scrapKg[el];
  }
  let junkCount = 0;
  for (const p of PART_IDS) {
    junkCount += state.parts.junk[p];
  }
  const latest = state.history.length > 0 ? state.history[state.history.length - 1] : null;
  const recentWake = state.events.some((e) => e.kind === 'child-wake' && state.sol - e.sol < 3);
  // Resupply: count landed shipments, and drive a descent animation while one
  // is on final approach (the last stretch of sols before arrival).
  const resupplyCount = state.events.filter((e) => e.kind === 'resupply').length;
  const descentSols = 1.5;
  let resupplyDescent: number | null = null;
  for (const shipment of state.shipments) {
    const remaining = shipment.arrivalSol - state.sol;
    if (remaining >= 0 && remaining < descentSols) {
      resupplyDescent = 1 - remaining / descentSols;
    }
  }
  return {
    siteId: state.siteId,
    sol: state.sol,
    hourOfSol: state.hourOfSol,
    solLengthHours: site.solLengthHours,
    isNight: !sunUp(state.hourOfSol, site.solLengthHours),
    stormIntensity: Math.min(1, Math.max(0, (tau - 1) / (peak - 1))),
    solarDeployFraction: Math.min(1, state.sol / 2),
    kilnActive: state.energy.currentLoadKwe > state.energy.currentSolarKwe * 0.05 && state.energy.batteryKwh > 1,
    childCompletion: state.child.completionFraction,
    childWalking: recentWake,
    colonyCount: Math.max(0, state.activeSeedCount - 1 - (recentWake ? 1 : 0)),
    resupplyCount,
    resupplyDescent,
    generation: state.generation,
    activeSeedCount: state.activeSeedCount,
    workingRobots: state.robots.filter((r) => r.status === 'working').length,
    brokenRobots: state.robots.filter((r) => r.status === 'broken').length,
    scrapKg,
    junkCount,
    capacityKg: capacityMassKg(state),
    doublingTimeSols: latest !== null ? latest.doublingTimeSols : null,
    solarKwe: state.energy.currentSolarKwe,
    batteryFraction: state.energy.batteryCapacityKwh > 0 ? state.energy.batteryKwh / state.energy.batteryCapacityKwh : 0,
    vitaminsKg: VITAMIN_IDS.reduce((sum, v) => sum + state.vitaminsKg[v], 0),
    isHistorical: false,
  };
}

/** Build the scene view from a historical snapshot (time scrubbing). */
export function snapshotView(state: SimState, snapshot: SolSnapshot): SceneView {
  const site = SITES[state.siteId];
  const peak = constantValue('dustStormOpticalDepthPeak');
  return {
    siteId: state.siteId,
    sol: snapshot.sol,
    hourOfSol: site.solLengthHours / 2, // render history at local noon
    solLengthHours: site.solLengthHours,
    isNight: false,
    stormIntensity: Math.min(1, Math.max(0, (snapshot.opticalDepth - 1) / (peak - 1))),
    solarDeployFraction: Math.min(1, snapshot.sol / 2),
    kilnActive: snapshot.solarKwe > 1,
    childCompletion: snapshot.childCompletion,
    childWalking: false,
    colonyCount: Math.max(0, snapshot.generation),
    resupplyCount: state.events.filter((e) => e.kind === 'resupply' && e.sol <= snapshot.sol).length,
    resupplyDescent: null,
    generation: snapshot.generation,
    activeSeedCount: snapshot.generation + 1,
    workingRobots: snapshot.workingRobots,
    brokenRobots: snapshot.brokenRobots,
    scrapKg: snapshot.scrapKg,
    junkCount: snapshot.junkCount,
    capacityKg: snapshot.capacityKg,
    doublingTimeSols: snapshot.doublingTimeSols,
    solarKwe: snapshot.solarKwe,
    batteryFraction: snapshot.batteryFraction,
    vitaminsKg: snapshot.vitaminsKg,
    isHistorical: true,
  };
}

/** Pick live or scrubbed view. */
export function selectView(state: SimState, scrubSol: number | null): SceneView {
  if (scrubSol !== null) {
    const snap = state.history.find((s) => s.sol === Math.floor(scrubSol));
    if (snap) {
      return snapshotView(state, snap);
    }
  }
  return liveView(state);
}

/** Format a doubling time for display. The unit is rendered by the caller's label. */
export function formatDoubling(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '∞';
  }
  if (value >= 10000) {
    return '∞';
  }
  return `${value.toFixed(0)}`;
}

/** Format kilograms compactly. */
export function formatKg(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return `${(value / 1000000).toFixed(1)} kt`;
  }
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)} t`;
  }
  return `${value.toFixed(0)} kg`;
}
