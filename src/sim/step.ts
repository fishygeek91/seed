/**
 * The SEED simulation core: a pure function step(state, dtHours) => nextState.
 *
 * Phases per tick:
 *   1. clock + environment (sun, dust, night)
 *   2. energy budget (solar in, survival first, lanes after)
 *   3. labor assignment (robots → lanes, duty-cycle physics)
 *   4. logistics + extraction (mine, haul, process, recycle)
 *   5. production planner (demand graph → print/assemble with yield)
 *   6. QA (unverified → verified or junk)
 *   7. deployment (parent expansion vs child allocation)
 *   8. process development (vitamin localization)
 *   9. resupply (Earth lead-time orders / Mars synodic windows)
 *  10. robot wear + Weibull failures + repair
 *  11. child wake check, doubling detection, end states
 *  12. per-sol snapshot + mass-conservation audit
 *
 * The four flows — atoms, joules, hands, information — are conserved:
 * every kilogram entering the boundary is in exactly one bin afterwards,
 * every kWh generated is consumed, stored, or curtailed, every robot-hour
 * is either spent on a lane or lost to downtime, and the library only
 * grows by paid process development.
 */

import type { ElementId, PartId, RobotTypeId, TaskId, VitaminId } from '@/sim/ids';
import { ELEMENT_IDS, PART_IDS, ROBOT_PART_FOR_TYPE, VITAMIN_IDS } from '@/sim/ids';
import type { Allocations, RobotState, SimEvent, SimState, SolSnapshot } from '@/sim/state';
import { zeroParts, zeroVitamins } from '@/sim/state';
import { CHILD_SPEC, PART_RECIPES, childSpecMassKg, partUnitMassKg } from '@/data/parts';
import { SITES, solarTransmission } from '@/data/sites';
import { constantValue } from '@/sim/constants';
import { nextRandom } from '@/sim/rng';

// ---------------------------------------------------------------------------
// Local process-rate constants. Headline physics lives in constants.ts; these
// are secondary rate assumptions, each labeled.
// ---------------------------------------------------------------------------

/** ASSUMED: one miner robot excavates 150 kg/h of regolith or ore. */
const MINE_RATE_KG_PER_ROBOT_HOUR = 150;
/** ASSUMED: mining stops once this much raw feed is stockpiled at the pad — energy is too precious to strip-mine for sport. */
const RAW_FEED_BUFFER_KG = 30000;
/**
 * ASSUMED: refining runs until this much iron is stocked. Iron is the driver
 * element (frames, machines, chassis); refining feed yields all elements in
 * geological ratio, so Si/Al/other simply accumulate alongside. Capping on
 * total stock instead would let by-product bins choke iron production.
 */
const IRON_STOCK_CAP_KG = 15000;
/** ASSUMED: water stockpile cap; ice beyond this stays in the ground/tailings. */
const WATER_STOCK_CAP_KG = 8000;
/** ASSUMED: one hauler moves 500 kg/h over the site's standard haul loop. */
const HAUL_RATE_KG_PER_ROBOT_HOUR = 500;
/** ASSUMED: beneficiation line throughput 80 kg raw feed per process robot-hour. */
const PROCESS_RATE_KG_PER_ROBOT_HOUR = 80;
/** ASSUMED: scrap sorting + remelt feed rate 60 kg per recycle robot-hour. */
const RECYCLE_RATE_KG_PER_ROBOT_HOUR = 60;
/** ASSUMED: remelt dross loss — 5% of remelted mass downgrades to tailings. */
const RECYCLE_DROSS_FRACTION = 0.05;
/** ASSUMED: machining station finished-mass throughput, kg/h per station. */
const MACHINING_THROUGHPUT_KG_PER_HOUR = 5;
/** ASSUMED: latent defects are 40% of a recipe's loss rate; QA exists to catch them. */
const LATENT_DEFECT_SHARE = 0.4;
/** ASSUMED: repairing one broken robot takes 12 technician-hours + 2 kg steel. */
const REPAIR_HOURS_PER_ROBOT = 12;
const REPAIR_MASS_KG = 2;
/** ASSUMED: solar array unfolds over the first 2 sols after landing. */
const SOLAR_DEPLOY_SOLS = 2;
/** ASSUMED: Mars resupply flight delivers 15 t of vitamins per window. */
const MARS_WINDOW_VITAMINS_KG = 15000;
/** ASSUMED: Earth vitamin order size 5 t, reordered when bins run low. */
const EARTH_ORDER_VITAMINS_KG = 5000;
/** Trailing window (sols) for the projected doubling-time estimate. */
const GROWTH_WINDOW_SOLS = 20;

/** Leaf-first build order: every part appears after all of its sub-parts. */
const TOPO_ORDER: readonly PartId[] = [
  'sealKit',
  'powerCable',
  'structuralFrame',
  'sensorComputeModule',
  'actuator',
  'wheelset',
  'minerTool',
  'batteryPack',
  'solarSection',
  'kilnPrinter',
  'machiningStation',
  'robotMiner',
  'robotHauler',
  'robotAssembler',
  'robotTechnician',
  'childSeedChassis',
];

// ---------------------------------------------------------------------------
// Mutable working copy. step() clones the immutable state into this shape,
// mutates freely, then returns it (mutable satisfies the readonly interface).
// ---------------------------------------------------------------------------

interface Draft {
  siteId: SimState['siteId'];
  templateId: SimState['templateId'];
  payloadMassT: number;
  scenarioSeed: string;
  rngState: number;
  sol: number;
  hourOfSol: number;
  atoms: {
    rawFeedKg: number;
    refinedKg: Record<ElementId, number>;
    wipKg: Partial<Record<PartId, number>>;
    scrapKg: Record<ElementId, number>;
    tailingsKg: number;
    massInCumKg: number;
  };
  energy: {
    batteryKwh: number;
    batteryCapacityKwh: number;
    solarMassKg: number;
    generatedCumKwh: number;
    consumedCumKwh: Record<TaskId | 'survival', number>;
    curtailedCumKwh: number;
    landedBatteryKwh: number;
    currentSolarKwe: number;
    currentLoadKwe: number;
  };
  robots: {
    id: number;
    type: RobotTypeId;
    status: RobotState['status'];
    task: TaskId | null;
    operatingHours: number;
    dustFouling: number;
    massKg: number;
    builtByGeneration: number;
    bornSol: number;
    provenance: string;
  }[];
  library: Record<PartId, { localized: boolean; devHoursInvested: number; trialMassConsumedKg: number }>;
  parts: {
    unverified: Record<PartId, number>;
    verified: Record<PartId, number>;
    junk: Record<PartId, number>;
    qaBankedHours: Partial<Record<PartId, number>>;
  };
  machinesDeployed: Record<'kilnPrinter' | 'machiningStation' | 'minerTool', number>;
  vitaminsKg: Record<VitaminId, number>;
  importedKgCum: number;
  importedKgAtLastDoubling: number;
  dataDropsReceived: number;
  generation: number;
  activeSeedCount: number;
  child: {
    allocatedParts: Record<PartId, number>;
    rationKg: Record<VitaminId, number>;
    feedstockKg: number;
    chassisStarted: boolean;
    completionFraction: number;
    wokeSol: number | null;
  };
  doublings: { multiple: number; sol: number; importKgSinceLast: number }[];
  capacityBaselineKg: number;
  shipments: { arrivalSol: number; vitaminsKg: Record<VitaminId, number>; includesDataDrop: boolean }[];
  nextEarthOrderSol: number | null;
  allocations: Allocations;
  events: SimEvent[];
  history: SolSnapshot[];
  lastSnapshotSol: number;
  procdevTarget: PartId | null;
  shippedChildrenMassKg: number;
  stallCounters: { vitamin: number; energy: number; hands: number };
  massClosureError: number;
  endState: SimState['endState'];
}

/** Deep-clone the immutable state into a mutable draft. Explicit so nothing hides. */
function cloneToDraft(state: SimState): Draft {
  return {
    siteId: state.siteId,
    templateId: state.templateId,
    payloadMassT: state.payloadMassT,
    scenarioSeed: state.scenarioSeed,
    rngState: state.rngState,
    sol: state.sol,
    hourOfSol: state.hourOfSol,
    atoms: {
      rawFeedKg: state.atoms.rawFeedKg,
      refinedKg: { ...state.atoms.refinedKg },
      wipKg: { ...state.atoms.wipKg },
      scrapKg: { ...state.atoms.scrapKg },
      tailingsKg: state.atoms.tailingsKg,
      massInCumKg: state.atoms.massInCumKg,
    },
    energy: {
      ...state.energy,
      consumedCumKwh: { ...state.energy.consumedCumKwh },
    },
    robots: state.robots.map((r) => ({ ...r })),
    library: Object.fromEntries(
      (Object.entries(state.library) as [PartId, SimState['library'][PartId]][]).map(([k, v]) => [k, { ...v }]),
    ) as Record<PartId, { localized: boolean; devHoursInvested: number; trialMassConsumedKg: number }>,
    parts: {
      unverified: { ...state.parts.unverified },
      verified: { ...state.parts.verified },
      junk: { ...state.parts.junk },
      qaBankedHours: { ...state.parts.qaBankedHours },
    },
    machinesDeployed: { ...state.machinesDeployed },
    vitaminsKg: { ...state.vitaminsKg },
    importedKgCum: state.importedKgCum,
    importedKgAtLastDoubling: state.importedKgAtLastDoubling,
    dataDropsReceived: state.dataDropsReceived,
    generation: state.generation,
    activeSeedCount: state.activeSeedCount,
    child: {
      allocatedParts: { ...state.child.allocatedParts },
      rationKg: { ...state.child.rationKg },
      feedstockKg: state.child.feedstockKg,
      chassisStarted: state.child.chassisStarted,
      completionFraction: state.child.completionFraction,
      wokeSol: state.child.wokeSol,
    },
    doublings: state.doublings.map((d) => ({ ...d })),
    capacityBaselineKg: state.capacityBaselineKg,
    shipments: state.shipments.map((s) => ({ arrivalSol: s.arrivalSol, vitaminsKg: { ...s.vitaminsKg }, includesDataDrop: s.includesDataDrop })),
    nextEarthOrderSol: state.nextEarthOrderSol,
    allocations: { ...state.allocations },
    events: state.events.slice(),
    history: state.history.slice(),
    lastSnapshotSol: state.lastSnapshotSol,
    procdevTarget: state.procdevTarget,
    shippedChildrenMassKg: state.shippedChildrenMassKg,
    stallCounters: { ...state.stallCounters },
    massClosureError: state.massClosureError,
    endState: state.endState,
  };
}

/** Draw the next deterministic random float from the draft's RNG stream. */
function roll(draft: Draft): number {
  const { nextState, value } = nextRandom(draft.rngState);
  draft.rngState = nextState;
  return value;
}

/** Push an event, capping the feed length so state stays light. */
function logEvent(draft: Draft, kind: SimEvent['kind'], message: string): void {
  draft.events.push({ sol: Math.round(draft.sol * 10) / 10, kind, message });
  if (draft.events.length > 400) {
    draft.events.splice(0, draft.events.length - 400);
  }
}

/** True if an event of this kind was already logged (for one-shot beats). */
function hasEvent(draft: Draft, kind: SimEvent['kind']): boolean {
  return draft.events.some((e) => e.kind === kind);
}

// ---------------------------------------------------------------------------
// Capacity metric: factory mass + working capacity. Used for the doubling score.
// ---------------------------------------------------------------------------

/**
 * Industrial capacity mass, kg: deployed power + machines + working robots +
 * verified parts staged for the child + mass already shipped out with woken
 * children. Raw feed, scrap, junk, and tailings do NOT count — the score is
 * working capacity, not tonnage on the floor.
 */
export function capacityMassKg(state: Pick<SimState, 'energy' | 'machinesDeployed' | 'robots' | 'parts' | 'child' | 'shippedChildrenMassKg'>): number {
  const batterySpecific = constantValue('batterySpecificEnergyKwhPerKg');
  let mass = state.energy.solarMassKg;
  mass += batterySpecific > 0 ? state.energy.batteryCapacityKwh / batterySpecific : 0;
  mass += state.machinesDeployed.kilnPrinter * partUnitMassKg('kilnPrinter');
  mass += state.machinesDeployed.machiningStation * partUnitMassKg('machiningStation');
  mass += state.machinesDeployed.minerTool * partUnitMassKg('minerTool');
  for (const robot of state.robots) {
    if (robot.status !== 'broken') {
      mass += robot.massKg;
    }
  }
  for (const partId of PART_IDS) {
    mass += state.parts.verified[partId] * partUnitMassKg(partId);
    mass += state.child.allocatedParts[partId] * partUnitMassKg(partId);
  }
  mass += state.shippedChildrenMassKg;
  return mass;
}

/** Total tracked mass inside the system boundary, kg — for the conservation audit. */
function totalTrackedMassKg(draft: Draft): number {
  const batterySpecific = constantValue('batterySpecificEnergyKwhPerKg');
  let mass = draft.atoms.rawFeedKg + draft.atoms.tailingsKg;
  for (const el of ELEMENT_IDS) {
    mass += draft.atoms.refinedKg[el] + draft.atoms.scrapKg[el];
  }
  for (const wip of Object.values(draft.atoms.wipKg)) {
    mass += wip;
  }
  for (const partId of PART_IDS) {
    const unit = partUnitMassKg(partId);
    mass += (draft.parts.unverified[partId] + draft.parts.verified[partId] + draft.parts.junk[partId] + draft.child.allocatedParts[partId]) * unit;
  }
  mass += draft.machinesDeployed.kilnPrinter * partUnitMassKg('kilnPrinter');
  mass += draft.machinesDeployed.machiningStation * partUnitMassKg('machiningStation');
  mass += draft.machinesDeployed.minerTool * partUnitMassKg('minerTool');
  for (const robot of draft.robots) {
    mass += robot.massKg;
  }
  mass += draft.energy.solarMassKg;
  mass += batterySpecific > 0 ? draft.energy.batteryCapacityKwh / batterySpecific : 0;
  for (const v of VITAMIN_IDS) {
    mass += draft.vitaminsKg[v] + draft.child.rationKg[v];
  }
  mass += draft.child.feedstockKg;
  mass += draft.shippedChildrenMassKg;
  return mass;
}

// ---------------------------------------------------------------------------
// Phase helpers
// ---------------------------------------------------------------------------

/** Sun output factor 0–1 for the current hour: half-sine day, zero at night. */
function sunFactor(hourOfSol: number, solLengthHours: number, daylightFraction: number): number {
  const dayLength = solLengthHours * daylightFraction;
  const dawn = (solLengthHours - dayLength) / 2;
  const sinceDawn = hourOfSol - dawn;
  if (sinceDawn < 0 || sinceDawn > dayLength || dayLength <= 0) {
    return 0;
  }
  return Math.sin((Math.PI * sinceDawn) / dayLength);
}

/** Split a mass of raw feed into refined element bins per site geology. */
function refineComposition(siteIsRegolith: boolean): Record<ElementId, number> {
  // Mars regolith reduction output split — from oxide abundances (Curiosity APXS), ASSUMED usable split.
  // Earth trucked ore is pre-sorted: richer in Fe/Al.
  return siteIsRegolith
    ? { Fe: 0.35, Al: 0.15, Si: 0.3, C: 0.03, H2O: 0, other: 0.17 }
    : { Fe: 0.5, Al: 0.18, Si: 0.15, C: 0.07, H2O: 0, other: 0.1 };
}

/** Per-lane labor pools in robot-hours for this tick. */
interface LaborPools {
  hours: Record<TaskId, number>;
  workingRobots: number;
}

/**
 * Assign robots to lanes and compute effective robot-hours per lane.
 * Duty cycle = mean uptime × dust derating × power availability. Broken
 * robots contribute nothing; sheltering robots (blackout) contribute nothing.
 */
function assignLabor(draft: Draft, dtHours: number, powerFactor: number): LaborPools {
  const uptime = constantValue('robotMeanUptimeFraction');
  const hoursByLane: Record<TaskId, number> = {
    mine: 0,
    haul: 0,
    process: 0,
    print: 0,
    assemble: 0,
    qa: 0,
    repair: 0,
    recycle: 0,
    procdev: 0,
  };
  let workingRobots = 0;

  // Weight lookups per role. Miners and haulers are single-purpose chassis;
  // assemblers and technicians split across their eligible lanes by the
  // user's allocation weights.
  const a = draft.allocations;
  const assemblerLanes: TaskId[] = ['process', 'print', 'assemble', 'recycle', 'procdev'];
  const technicianLanes: TaskId[] = ['process', 'qa', 'repair', 'procdev'];

  for (const robot of draft.robots) {
    if (robot.status === 'broken') {
      continue;
    }
    if (powerFactor < 0.15) {
      // Blackout: robots shelter to survive the night/storm. Negative hands.
      robot.status = 'sheltering';
      robot.task = null;
      continue;
    }
    const duty = uptime * (1 - 0.5 * robot.dustFouling) * powerFactor;
    const effHours = dtHours * duty;
    let lanes: TaskId[];
    if (robot.type === 'miner') {
      lanes = ['mine'];
    } else if (robot.type === 'hauler') {
      lanes = ['haul', 'recycle'];
    } else if (robot.type === 'assembler') {
      lanes = assemblerLanes;
    } else {
      lanes = technicianLanes;
    }
    let weightSum = 0;
    for (const lane of lanes) {
      weightSum += Math.max(0, a[lane]);
    }
    if (weightSum <= 0) {
      robot.status = 'idle';
      robot.task = null;
      continue;
    }
    // Spread this robot's hours across its lanes proportionally; report the
    // dominant lane as its displayed task.
    let bestLane: TaskId = lanes[0];
    let bestWeight = -1;
    for (const lane of lanes) {
      const w = Math.max(0, a[lane]) / weightSum;
      hoursByLane[lane] += effHours * w;
      if (a[lane] > bestWeight) {
        bestWeight = a[lane];
        bestLane = lane;
      }
    }
    robot.status = 'working';
    robot.task = bestLane;
    robot.operatingHours += effHours;
    workingRobots += 1;
  }

  // Multiple woken seeds work in aggregate: the parent's explicit robots
  // stand in for every active seed's workforce.
  if (draft.activeSeedCount > 1) {
    for (const lane of Object.keys(hoursByLane) as TaskId[]) {
      hoursByLane[lane] *= draft.activeSeedCount;
    }
  }

  return { hours: hoursByLane, workingRobots };
}

/** Energy budget tracker for one tick. Draws battery + generation, logs sinks. */
interface EnergyBudget {
  remainingKwh: number;
  usedByLane: Record<TaskId | 'survival', number>;
}

/** Try to spend energy from the tick budget; returns the fraction actually available. */
function spendEnergy(budget: EnergyBudget, lane: TaskId | 'survival', wantKwh: number): number {
  if (wantKwh <= 0) {
    return 1;
  }
  const granted = Math.min(wantKwh, budget.remainingKwh);
  budget.remainingKwh -= granted;
  budget.usedByLane[lane] += granted;
  return granted / wantKwh;
}

// ---------------------------------------------------------------------------
// Production planner
// ---------------------------------------------------------------------------

/** Expand sub-part demand recursively: walk assemblies from the top of the
 *  topo order down, adding each assembly's outstanding sub-needs. */
function expandSubDemand(draft: Draft, demand: Record<PartId, number>): void {
  for (let i = TOPO_ORDER.length - 1; i >= 0; i -= 1) {
    const partId = TOPO_ORDER[i];
    const recipe = PART_RECIPES[partId];
    const outstanding = Math.max(
      0,
      demand[partId] - draft.parts.verified[partId] - draft.parts.unverified[partId] - (draft.atoms.wipKg[partId] ?? 0) / Math.max(1e-9, partUnitMassKg(partId)),
    );
    if (outstanding <= 0) {
      continue;
    }
    for (const [subId, count] of Object.entries(recipe.subParts) as [PartId, number][]) {
      demand[subId] += Math.max(0, outstanding * count - draft.parts.verified[subId]);
    }
  }
}

/**
 * Priority demand: everything the child copy still needs, plus fleet
 * survival (repair spares, replacement workers). This pass gets first call
 * on labor, machines, materials, and joules.
 */
function computeChildDemand(draft: Draft): Record<PartId, number> {
  const demand = zeroParts();
  for (const [partId, needed] of Object.entries(CHILD_SPEC.parts) as [PartId, number][]) {
    const have = draft.child.allocatedParts[partId] + draft.parts.verified[partId];
    demand[partId] += Math.max(0, needed - have);
  }
  // Fleet survival: bounded spare-actuator stock (stock-aware — a flat
  // "+2 per tick" faucet would print thousands and eat every bearing
  // vitamin), plus replacement workers when the able fleet thins.
  demand.actuator += Math.max(0, 20 - draft.parts.verified.actuator);
  const able = draft.robots.filter((r) => r.status !== 'broken').length;
  const total = draft.robots.length;
  if (total > 0 && able < total * 0.85) {
    demand.robotAssembler += 1;
    demand.robotTechnician += 1;
    demand.robotMiner += 1;
  }
  expandSubDemand(draft, demand);
  return demand;
}

/**
 * Expansion demand: more power, storage, and print capacity for the parent.
 * This is what capacity doublings are made of, but it only gets the labor
 * and joules the child pass left over.
 */
function computeExpansionDemand(draft: Draft): Record<PartId, number> {
  const demand = zeroParts();
  demand.solarSection += 4;
  demand.batteryPack += 2;
  demand.kilnPrinter += 1;
  // Miner toolheads boost extraction, but extraction is demand-capped — a
  // handful is plenty. Without this bound the planner iron-plates the mine.
  if (draft.machinesDeployed.minerTool < 4) {
    demand.minerTool += 1;
  }
  expandSubDemand(draft, demand);
  return demand;
}

/** Shared per-tick rate budgets consumed across production passes. */
interface ProductionRates {
  printLaborHours: number;
  assembleLaborHours: number;
  kilnBudgetKg: number;
  machiningBudgetKg: number;
  vitaminStarved: boolean;
}

/**
 * One production pass: walk the recipe graph leaf-first and attempt every
 * demanded part, limited by labor, machine throughput, element inputs,
 * vitamins, verified sub-parts, and energy. Inputs move into WIP; whole
 * units complete with a deterministic yield roll; failures scrap their full
 * input mass. Mass moves, never vanishes.
 */
function runProductionPass(
  draft: Draft,
  demand: Record<PartId, number>,
  rates: ProductionRates,
  budget: EnergyBudget,
): void {
  for (const partId of TOPO_ORDER) {
    if (demand[partId] <= 0) {
      continue;
    }
    const recipe = PART_RECIPES[partId];
    const unitMass = partUnitMassKg(partId);
    if (unitMass <= 0) {
      continue;
    }
    // Tools gate: no kiln, no sinter. Missing machines freeze the subtree.
    let toolsOk = true;
    for (const tool of recipe.toolsRequired) {
      if (draft.machinesDeployed[tool] < 1) {
        toolsOk = false;
      }
    }
    if (!toolsOk) {
      continue;
    }
    const isAssembly = Object.keys(recipe.subParts).length > 0;
    const laborPool = isAssembly ? rates.assembleLaborHours : rates.printLaborHours;
    const localized = draft.library[partId].localized;

    // Rate limits, in attempted units.
    const byLabor = recipe.robotHours > 0 ? laborPool / recipe.robotHours : Number.POSITIVE_INFINITY;
    const needsKiln = recipe.toolsRequired.includes('kilnPrinter');
    const needsMachining = recipe.toolsRequired.includes('machiningStation');
    const byKiln = needsKiln ? rates.kilnBudgetKg / unitMass : Number.POSITIVE_INFINITY;
    const byMachining = needsMachining ? rates.machiningBudgetKg / unitMass : Number.POSITIVE_INFINITY;
    // Element inputs (plus localized substitutes).
    let byInputs = Number.POSITIVE_INFINITY;
    const effectiveInputs: Partial<Record<ElementId, number>> = { ...recipe.inputsKg };
    if (localized && recipe.localization) {
      for (const [el, kgPerUnit] of Object.entries(recipe.localization.substituteInputsKg) as [ElementId, number][]) {
        effectiveInputs[el] = (effectiveInputs[el] ?? 0) + kgPerUnit;
      }
    }
    for (const [el, kgPerUnit] of Object.entries(effectiveInputs) as [ElementId, number][]) {
      if (kgPerUnit > 0) {
        byInputs = Math.min(byInputs, draft.atoms.refinedKg[el] / kgPerUnit);
      }
    }
    // Vitamin inputs (skipped once localized).
    let byVitamins = Number.POSITIVE_INFINITY;
    if (!localized) {
      for (const [v, kgPerUnit] of Object.entries(recipe.vitaminsKg) as [VitaminId, number][]) {
        if (kgPerUnit > 0) {
          byVitamins = Math.min(byVitamins, draft.vitaminsKg[v] / kgPerUnit);
        }
      }
    }
    // Sub-parts: consume verified units only. Unverified parts are not trusted.
    let bySubParts = Number.POSITIVE_INFINITY;
    for (const [subId, count] of Object.entries(recipe.subParts) as [PartId, number][]) {
      if (count > 0) {
        bySubParts = Math.min(bySubParts, draft.parts.verified[subId] / count);
      }
    }

    const attemptUnits = Math.min(demand[partId], byLabor, byKiln, byMachining, byInputs, byVitamins, bySubParts);
    if (byVitamins < 0.001 && Math.min(demand[partId], byLabor, byInputs) > 0.01) {
      rates.vitaminStarved = true;
    }
    if (attemptUnits <= 0) {
      continue;
    }
    // Energy for the attempted fraction.
    const laneForEnergy: TaskId = isAssembly ? 'assemble' : 'print';
    const energyFrac = spendEnergy(budget, laneForEnergy, attemptUnits * recipe.energyKwh);
    const units = attemptUnits * energyFrac;
    if (units <= 0) {
      continue;
    }

    // Consume inputs into WIP. Mass moves, never vanishes.
    for (const [el, kgPerUnit] of Object.entries(effectiveInputs) as [ElementId, number][]) {
      draft.atoms.refinedKg[el] = Math.max(0, draft.atoms.refinedKg[el] - kgPerUnit * units);
    }
    if (!localized) {
      for (const [v, kgPerUnit] of Object.entries(recipe.vitaminsKg) as [VitaminId, number][]) {
        draft.vitaminsKg[v] = Math.max(0, draft.vitaminsKg[v] - kgPerUnit * units);
      }
    }
    for (const [subId, count] of Object.entries(recipe.subParts) as [PartId, number][]) {
      draft.parts.verified[subId] = Math.max(0, draft.parts.verified[subId] - count * units);
    }
    draft.atoms.wipKg[partId] = (draft.atoms.wipKg[partId] ?? 0) + unitMass * units;

    // Spend the rate budgets.
    if (isAssembly) {
      rates.assembleLaborHours -= units * recipe.robotHours;
    } else {
      rates.printLaborHours -= units * recipe.robotHours;
    }
    if (needsKiln) {
      rates.kilnBudgetKg -= units * unitMass;
    }
    if (needsMachining) {
      rates.machiningBudgetKg -= units * unitMass;
    }

    // Complete whole units out of WIP with a yield roll each.
    const effectiveYield = localized && recipe.localization
      ? recipe.yieldFraction * recipe.localization.yieldPenalty
      : recipe.yieldFraction;
    let wip = draft.atoms.wipKg[partId] ?? 0;
    while (wip >= unitMass) {
      wip -= unitMass;
      if (roll(draft) < effectiveYield) {
        draft.parts.unverified[partId] += 1;
        if (!hasEvent(draft, 'first-print')) {
          logEvent(draft, 'first-print', `First part off the line: ${recipe.name}. The print yard is lit.`);
        }
        if (partId === 'childSeedChassis' && !hasEvent(draft, 'chassis-started')) {
          logEvent(draft, 'chassis-started', 'Child seed chassis taking shape inside the parent — a stainless flower, still asleep.');
        }
      } else {
        // Fab failure: full unit mass to scrap. Rejected parts on pallets.
        scrapRecipeMass(draft, partId, unitMass);
      }
    }
    draft.atoms.wipKg[partId] = wip;
  }
}

/** Scrap the full input mass of failed attempts, split per recipe composition. */
function scrapRecipeMass(draft: Draft, partId: PartId, massKg: number): void {
  const recipe = PART_RECIPES[partId];
  const unit = partUnitMassKg(partId);
  if (unit <= 0 || massKg <= 0) {
    return;
  }
  const fraction = massKg / unit;
  // Element inputs return to their scrap bins.
  for (const [el, kgPerUnit] of Object.entries(recipe.inputsKg) as [ElementId, number][]) {
    draft.atoms.scrapKg[el] += kgPerUnit * fraction;
  }
  // Vitamin mass and sub-part mass downcycle: precision is destroyed, atoms remain.
  let downcycled = 0;
  for (const kgPerUnit of Object.values(recipe.vitaminsKg)) {
    downcycled += kgPerUnit * fraction;
  }
  for (const [subId, count] of Object.entries(recipe.subParts) as [PartId, number][]) {
    downcycled += partUnitMassKg(subId) * count * fraction;
  }
  draft.atoms.scrapKg.other += downcycled;
}

// ---------------------------------------------------------------------------
// The step function
// ---------------------------------------------------------------------------

/**
 * Advance the simulation by dtHours. Pure: no reads outside `state` and the
 * static data modules; deterministic via the embedded RNG state.
 */
export function step(state: SimState, dtHours: number): SimState {
  if (!Number.isFinite(dtHours) || dtHours <= 0) {
    throw new RangeError(`dtHours must be positive and finite, got ${dtHours}`);
  }
  const draft = cloneToDraft(state);
  const site = SITES[draft.siteId];

  // ---- 1. clock + environment -------------------------------------------
  const solLength = site.solLengthHours;
  draft.hourOfSol += dtHours;
  while (draft.hourOfSol >= solLength) {
    draft.hourOfSol -= solLength;
  }
  draft.sol += dtHours / solLength;

  const tauIdx = Math.floor(draft.sol) % site.opticalDepthBySol.length;
  const tau = site.opticalDepthBySol[tauIdx];
  const transmission = solarTransmission(site, draft.sol);
  const sun = sunFactor(draft.hourOfSol, solLength, site.daylightFraction);
  const isNight = sun <= 0;

  // Storm beats (Mars): tau crossing 2.0 marks storm start/end for the feed.
  if (draft.siteId === 'mars') {
    const wasStorm = draft.events.length > 0 && draft.events[draft.events.length - 1].kind === 'storm-start';
    if (tau > 2 && !hasEvent(draft, 'storm-start')) {
      logEvent(draft, 'storm-start', `Dust storm rising — optical depth τ=${tau.toFixed(1)}. Solar output collapsing.`);
    } else if (tau < 1 && hasEvent(draft, 'storm-start') && !hasEvent(draft, 'storm-end') && !wasStorm) {
      logEvent(draft, 'storm-end', 'Sky clearing. Arrays back above survival power.');
    }
  }

  // ---- 2. energy budget ---------------------------------------------------
  // Deployment ramp: the stainless flower unfolds over the first sols.
  const deployFraction = Math.min(1, draft.sol / SOLAR_DEPLOY_SOLS);
  if (deployFraction >= 1 && !hasEvent(draft, 'solar-deployed')) {
    logEvent(draft, 'solar-deployed', 'Solar field deployed to full aperture.');
  }
  const specificPower = constantValue('solarSpecificPowerKwPerKg');
  // Specific power is rated at 1 AU: scale by the site's solar constant.
  const auScale = site.solarConstantWm2 / constantValue('earthSolarConstantWm2');
  const nameplateKwe = draft.energy.solarMassKg * specificPower * auScale;
  const solarKwe = nameplateKwe * transmission * sun * deployFraction * draft.activeSeedCount;
  const generatedKwh = solarKwe * dtHours;
  draft.energy.generatedCumKwh += generatedKwh;
  draft.energy.currentSolarKwe = solarKwe;

  const budget: EnergyBudget = {
    remainingKwh: draft.energy.batteryKwh + generatedKwh,
    usedByLane: {
      mine: 0, haul: 0, process: 0, print: 0, assemble: 0, qa: 0, repair: 0, recycle: 0, procdev: 0, survival: 0,
    },
  };

  // Survival first: thermal keep-alive scales with night + site severity.
  const survivalKwe = constantValue('nightSurvivalPowerKwePerSeed') * site.thermalSeverity * (isNight ? 1 : 0.4) * draft.activeSeedCount;
  const survivalGranted = spendEnergy(budget, 'survival', survivalKwe * dtHours);
  const brownedOut = survivalGranted < 0.99;
  if (brownedOut && !hasEvent(draft, 'energy-crisis')) {
    logEvent(draft, 'energy-crisis', 'Battery exhausted — survival heaters browning out. Kiln ware cooling mid-cycle.');
  }

  // Battery reserve policy: hold back one full night of survival energy.
  // Work loads may only draw the budget above this reserve, so the factory
  // never assembles itself into freezing to death overnight.
  const nightHours = solLength * (1 - site.daylightFraction);
  const reserveKwh = constantValue('nightSurvivalPowerKwePerSeed') * site.thermalSeverity * draft.activeSeedCount * nightHours;
  budget.remainingKwh = Math.max(0, budget.remainingKwh - reserveKwh);

  // Power factor for labor: how much of the workforce we can energize.
  const robotDrawKwe = constantValue('robotPowerDrawKwe');
  const activeRobotCount = draft.robots.filter((r) => r.status !== 'broken').length;
  const fullLaborKwh = activeRobotCount * robotDrawKwe * dtHours * draft.activeSeedCount;
  const laborAffordable = fullLaborKwh > 0 ? Math.min(1, budget.remainingKwh / fullLaborKwh) : 1;
  const powerFactor = brownedOut ? 0 : laborAffordable;

  // ---- 3. labor -----------------------------------------------------------
  const labor = assignLabor(draft, dtHours, powerFactor);
  // Charge robot power draw to each lane proportionally to hours worked.
  for (const laneId of Object.keys(labor.hours) as TaskId[]) {
    spendEnergy(budget, laneId, labor.hours[laneId] * robotDrawKwe);
  }

  // ---- 4. extraction: mine → haul → process; recycle ---------------------
  const mineEnergyPerKg = constantValue('regolithMiningEnergyKwhPerKg');
  const haulEnergyPerKgKm = constantValue('haulEnergyKwhPerKgKm');
  const minerToolBoost = 1 + draft.machinesDeployed.minerTool * 0.5; // each deployed tool head adds 50% — ASSUMED
  // Demand-driven mining: never stockpile beyond the pad buffer.
  const feedHeadroomKg = Math.max(0, RAW_FEED_BUFFER_KG * draft.activeSeedCount - draft.atoms.rawFeedKg);
  const mineCapacityKg = Math.min(feedHeadroomKg, labor.hours.mine * MINE_RATE_KG_PER_ROBOT_HOUR * minerToolBoost);
  const haulCapacityKg = labor.hours.haul * HAUL_RATE_KG_PER_ROBOT_HOUR;
  let minedKg = Math.min(mineCapacityKg, haulCapacityKg > 0 ? haulCapacityKg : mineCapacityKg * 0.2);
  const mineEnergyFrac = spendEnergy(budget, 'mine', minedKg * mineEnergyPerKg);
  const haulEnergyFrac = spendEnergy(budget, 'haul', minedKg * site.haulDistanceKm * haulEnergyPerKgKm);
  minedKg *= Math.min(mineEnergyFrac, haulEnergyFrac);
  draft.atoms.rawFeedKg += minedKg;
  draft.atoms.massInCumKg += minedKg; // mined mass enters the system boundary

  // Process raw feed → refined elements + water + tailings. Refining is
  // paced by the driver element, iron: run while Fe stock has headroom.
  // Water has its own cap: dense, cheap to leave in the ground, and it must
  // never crowd iron out of the stockpile accounting.
  const ironHeadroomKg = Math.max(0, IRON_STOCK_CAP_KG * draft.activeSeedCount - draft.atoms.refinedKg.Fe);
  const iceFraction = site.regolithFeedstock ? site.iceMassFractionOfFeed : 0;
  const solidsShare = Math.max(1e-6, 1 - iceFraction);
  const ironYieldPerFeedKg = Math.max(
    1e-6,
    solidsShare * constantValue('oreBeneficiationYield') * refineComposition(site.regolithFeedstock).Fe,
  );
  const processWantKg = Math.min(
    draft.atoms.rawFeedKg,
    ironHeadroomKg / ironYieldPerFeedKg, // convert Fe headroom into feed mass
    labor.hours.process * PROCESS_RATE_KG_PER_ROBOT_HOUR,
  );
  if (processWantKg > 0) {
    const sinterPrepEnergy = 0.3; // kWh/kg feed for grind + sort + reduce prep — ASSUMED
    const iceEnergyPerKg = constantValue('iceExtractionEnergyKwhPerKg');
    // Only pay ice-extraction energy while the water tank has headroom.
    const waterHeadroomKg = Math.max(0, WATER_STOCK_CAP_KG * draft.activeSeedCount - draft.atoms.refinedKg.H2O);
    const extractIce = waterHeadroomKg > 0;
    const wantKwh = processWantKg * sinterPrepEnergy + (extractIce ? processWantKg * iceFraction * iceEnergyPerKg : 0);
    const frac = spendEnergy(budget, 'process', wantKwh);
    const processedKg = processWantKg * frac;
    draft.atoms.rawFeedKg -= processedKg;
    // Perchlorate / contamination penalty decays as the wash line matures
    // (proxy: after 200 t cumulative boundary mass the line is clean) — ASSUMED.
    const maturity = Math.min(1, draft.atoms.massInCumKg / 200000);
    const contamination = site.contaminationPenalty * (1 - maturity);
    const baseYield = constantValue('oreBeneficiationYield');
    const yieldFrac = Math.max(0.01, baseYield * (1 - contamination));
    const iceKg = processedKg * iceFraction;
    const solidsKg = processedKg - iceKg;
    const refinedOutKg = solidsKg * yieldFrac;
    const comp = refineComposition(site.regolithFeedstock);
    for (const el of ELEMENT_IDS) {
      draft.atoms.refinedKg[el] += refinedOutKg * comp[el];
    }
    if (extractIce) {
      const captured = Math.min(iceKg * 0.9, waterHeadroomKg); // 10% sublimation capture loss — ASSUMED
      draft.atoms.refinedKg.H2O += captured;
      draft.atoms.tailingsKg += solidsKg * (1 - yieldFrac) + (iceKg - captured);
    } else {
      // Tank full: ice rides through to tailings unmelted.
      draft.atoms.tailingsKg += solidsKg * (1 - yieldFrac) + iceKg;
    }
  }

  // Recycle: junk parts dismantle to scrap, then scrap remelts to refined.
  let recycleBudgetKg = labor.hours.recycle * RECYCLE_RATE_KG_PER_ROBOT_HOUR;
  if (recycleBudgetKg > 0) {
    // Dismantle junk first (it is visible shame on the floor).
    for (const partId of TOPO_ORDER) {
      while (draft.parts.junk[partId] > 0 && recycleBudgetKg >= partUnitMassKg(partId)) {
        draft.parts.junk[partId] -= 1;
        recycleBudgetKg -= partUnitMassKg(partId);
        scrapRecipeMass(draft, partId, partUnitMassKg(partId));
      }
    }
    // Remelt scrap bins into refined stock, paying melt energy + dross loss.
    const meltEnergyPerKg = constantValue('meltRecycleEnergyKwhPerKg');
    for (const el of ELEMENT_IDS) {
      if (recycleBudgetKg <= 0) {
        break;
      }
      const meltKg = Math.min(draft.atoms.scrapKg[el], recycleBudgetKg);
      if (meltKg <= 0) {
        continue;
      }
      const frac = spendEnergy(budget, 'recycle', meltKg * meltEnergyPerKg);
      const actualKg = meltKg * frac;
      draft.atoms.scrapKg[el] -= actualKg;
      draft.atoms.refinedKg[el] += actualKg * (1 - RECYCLE_DROSS_FRACTION);
      draft.atoms.tailingsKg += actualKg * RECYCLE_DROSS_FRACTION;
      recycleBudgetKg -= actualKg;
    }
  }

  // ---- 5. production ------------------------------------------------------
  // If the child is fully staged but its battery share is not charged yet,
  // the factory throttles production and banks joules so the child can wake.
  const socNow = draft.energy.batteryCapacityKwh > 0 ? draft.energy.batteryKwh / draft.energy.batteryCapacityKwh : 0;
  const chargingForWake = draft.child.completionFraction >= 0.999 && socNow < constantValue('childWakeBatteryFraction');
  const rates: ProductionRates = {
    printLaborHours: labor.hours.print,
    assembleLaborHours: labor.hours.assemble,
    // Machine throughput budgets for this tick (all active seeds pooled).
    kilnBudgetKg: draft.machinesDeployed.kilnPrinter * constantValue('printerThroughputKgPerHour') * dtHours * draft.activeSeedCount,
    machiningBudgetKg: draft.machinesDeployed.machiningStation * MACHINING_THROUGHPUT_KG_PER_HOUR * dtHours * draft.activeSeedCount,
    vitaminStarved: false,
  };
  if (!chargingForWake) {
    // Two passes: the child copy gets first call on every budget; parent
    // expansion only spends what the child pass leaves over.
    runProductionPass(draft, computeChildDemand(draft), rates, budget);
    runProductionPass(draft, computeExpansionDemand(draft), rates, budget);
  }
  const anyVitaminStarved = rates.vitaminStarved;

  // ---- 6. QA --------------------------------------------------------------
  // Assemblies first (reverse topo): the child-critical machines must not
  // wait behind a flood of cheap seals. Hours bank across ticks so a 10-hour
  // kiln inspection actually finishes even at 1-hour steps.
  let qaHoursLeft = labor.hours.qa;
  const qaBaseline = constantValue('qaHoursBaselinePerPart');
  for (let i = TOPO_ORDER.length - 1; i >= 0; i -= 1) {
    const partId = TOPO_ORDER[i];
    const recipe = PART_RECIPES[partId];
    const perUnit = Math.max(qaBaseline, recipe.qaHours);
    while (draft.parts.unverified[partId] >= 1 && qaHoursLeft > 0) {
      const banked = draft.parts.qaBankedHours[partId] ?? 0;
      const needed = perUnit - banked;
      const spendHours = Math.min(needed, qaHoursLeft);
      qaHoursLeft -= spendHours;
      if (spendHours < needed) {
        draft.parts.qaBankedHours[partId] = banked + spendHours;
        break; // inspection continues next tick
      }
      draft.parts.qaBankedHours[partId] = 0;
      spendEnergy(budget, 'qa', 0.2); // bench power per test — ASSUMED 0.2 kWh
      draft.parts.unverified[partId] -= 1;
      const latentDefect = (1 - recipe.yieldFraction) * LATENT_DEFECT_SHARE;
      if (roll(draft) < latentDefect) {
        draft.parts.junk[partId] += 1; // visible junk on the floor
      } else {
        draft.parts.verified[partId] += 1;
      }
    }
  }
  let unverifiedBacklog = 0;
  for (const partId of PART_IDS) {
    unverifiedBacklog += draft.parts.unverified[partId];
  }
  if (unverifiedBacklog > 60 && !hasEvent(draft, 'qa-backlog')) {
    logEvent(draft, 'qa-backlog', `QA backlog: ${Math.round(unverifiedBacklog)} untested parts stacking up. Silent junk risk.`);
  }

  // ---- 7. deployment: child allocation, then parent expansion -------------
  // Child gets priority once its chassis exists; before that the parent
  // builds itself up so it can gestate faster.
  for (const [partId, specCount] of Object.entries(CHILD_SPEC.parts) as [PartId, number][]) {
    const deficit = specCount - draft.child.allocatedParts[partId];
    if (deficit <= 0) {
      continue;
    }
    const take = Math.min(deficit, Math.floor(draft.parts.verified[partId]));
    if (take > 0) {
      draft.parts.verified[partId] -= take;
      draft.child.allocatedParts[partId] += take;
      if (partId === 'childSeedChassis') {
        draft.child.chassisStarted = true;
      }
    }
  }
  // Parent expansion: verified infrastructure beyond an assembly-stock
  // buffer deploys to the parent. The buffer matters: battery packs are also
  // sub-parts of robots, miner tools of miner robots — deploying every unit
  // the moment it verifies would starve the assembly bay forever.
  const deployToParent = (partId: PartId, bufferUnits: number): number => {
    const n = Math.floor(draft.parts.verified[partId] - bufferUnits);
    if (n > 0) {
      draft.parts.verified[partId] -= n;
      return n;
    }
    return 0;
  };
  {
    const solarUnits = deployToParent('solarSection', 0);
    draft.energy.solarMassKg += solarUnits * partUnitMassKg('solarSection');
    const batteryUnits = deployToParent('batteryPack', 6);
    draft.energy.batteryCapacityKwh += batteryUnits * partUnitMassKg('batteryPack') * constantValue('batterySpecificEnergyKwhPerKg');
    draft.machinesDeployed.kilnPrinter += deployToParent('kilnPrinter', 0);
    draft.machinesDeployed.machiningStation += deployToParent('machiningStation', 0);
    draft.machinesDeployed.minerTool += deployToParent('minerTool', 2);
    // Fresh robots wake for the parent workforce.
    for (const [role, partId] of Object.entries(ROBOT_PART_FOR_TYPE) as [RobotTypeId, PartId][]) {
      const born = deployToParent(partId, 0);
      for (let i = 0; i < born; i += 1) {
        const maxId = draft.robots.reduce((m, r) => Math.max(m, r.id), 0);
        draft.robots.push({
          id: maxId + 1,
          type: role,
          status: 'idle',
          task: null,
          operatingHours: 0,
          dustFouling: 0,
          massKg: partUnitMassKg(partId),
          builtByGeneration: draft.generation,
          bornSol: Math.floor(draft.sol),
          provenance: `gen-${draft.generation} assembly bay, sol ${Math.floor(draft.sol)}`,
        });
      }
    }
  }
  // Stage vitamin ration + starter feedstock once the child is mostly built.
  if (draft.child.chassisStarted && draft.child.completionFraction > 0.6) {
    for (const v of VITAMIN_IDS) {
      const want = (CHILD_SPEC.vitaminRationKg[v] ?? 0) - draft.child.rationKg[v];
      if (want > 0) {
        const take = Math.min(want, draft.vitaminsKg[v] * 0.5); // never strip the parent bare
        draft.vitaminsKg[v] -= take;
        draft.child.rationKg[v] += take;
      }
    }
    const feedWant = CHILD_SPEC.starterFeedstockKg - draft.child.feedstockKg;
    if (feedWant > 0) {
      // Pull pooled refined mass proportionally across bins.
      let available = 0;
      for (const el of ELEMENT_IDS) {
        available += draft.atoms.refinedKg[el];
      }
      const take = Math.min(feedWant, available * 0.3);
      if (available > 0 && take > 0) {
        for (const el of ELEMENT_IDS) {
          const share = (draft.atoms.refinedKg[el] / available) * take;
          draft.atoms.refinedKg[el] -= share;
        }
        draft.child.feedstockKg += take;
      }
    }
  }

  // ---- 8. process development ---------------------------------------------
  if (draft.procdevTarget === null || draft.library[draft.procdevTarget].localized) {
    // Pick the cheapest localizable part whose data requirement is satisfied.
    let best: PartId | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const partId of PART_IDS) {
      const loc = PART_RECIPES[partId].localization;
      if (!loc || draft.library[partId].localized) {
        continue;
      }
      if (loc.requiresDataDrop && draft.dataDropsReceived < 1) {
        continue;
      }
      if (loc.devRobotHours < bestCost) {
        bestCost = loc.devRobotHours;
        best = partId;
      }
    }
    draft.procdevTarget = best;
  }
  if (draft.procdevTarget !== null && labor.hours.procdev > 0) {
    const target = draft.procdevTarget;
    const loc = PART_RECIPES[target].localization;
    if (loc) {
      const entry = draft.library[target];
      const hoursSpent = labor.hours.procdev;
      spendEnergy(budget, 'procdev', hoursSpent * 1.5); // lab bench power — ASSUMED 1.5 kWe
      entry.devHoursInvested += hoursSpent;
      // Trial mass burns proportionally to progress; failures waste mass by design.
      const trialWantKg = (hoursSpent / loc.devRobotHours) * loc.trialMassKg;
      let available = 0;
      for (const el of ELEMENT_IDS) {
        available += draft.atoms.refinedKg[el];
      }
      const trialKg = Math.min(trialWantKg, available);
      if (available > 0 && trialKg > 0) {
        for (const el of ELEMENT_IDS) {
          const share = (draft.atoms.refinedKg[el] / available) * trialKg;
          draft.atoms.refinedKg[el] -= share;
          draft.atoms.scrapKg[el] += share; // trial articles go to the scrap pile
        }
        entry.trialMassConsumedKg += trialKg;
      }
      if (entry.devHoursInvested >= loc.devRobotHours && entry.trialMassConsumedKg >= loc.trialMassKg * 0.8) {
        entry.localized = true;
        logEvent(draft, 'localized', `${PART_RECIPES[target].name}: local substitute qualified. One less thing riding rockets.`);
      }
    }
  }

  // ---- 9. resupply ---------------------------------------------------------
  if (site.resupply.kind === 'synodic') {
    // Mars: shipments spawn at each window; arrival is the window sol itself
    // (transit already folded into window spacing for this model).
    const { periodSols, firstWindowSol } = site.resupply;
    const windowsPassed = Math.floor((draft.sol - firstWindowSol) / periodSols) + 1;
    const shipmentsSpawned = draft.shipments.length + draft.dataDropsReceived; // each window spawns exactly one
    if (draft.sol >= firstWindowSol && windowsPassed > shipmentsSpawned) {
      const mix = zeroVitamins();
      const rationTotal = Object.values(CHILD_SPEC.vitaminRationKg).reduce((a, b) => a + b, 0);
      for (const v of VITAMIN_IDS) {
        mix[v] = (MARS_WINDOW_VITAMINS_KG * (CHILD_SPEC.vitaminRationKg[v] ?? 0)) / Math.max(1, rationTotal);
      }
      draft.shipments.push({ arrivalSol: draft.sol, vitaminsKg: mix, includesDataDrop: true });
    }
  } else {
    // Earth: auto-reorder when any bin is low; one order in flight at a time.
    const anyLow = VITAMIN_IDS.some((v) => draft.vitaminsKg[v] < 200);
    if (anyLow && draft.shipments.length === 0 && (draft.nextEarthOrderSol === null || draft.sol >= draft.nextEarthOrderSol)) {
      const mix = zeroVitamins();
      const rationTotal = Object.values(CHILD_SPEC.vitaminRationKg).reduce((a, b) => a + b, 0);
      for (const v of VITAMIN_IDS) {
        mix[v] = (EARTH_ORDER_VITAMINS_KG * (CHILD_SPEC.vitaminRationKg[v] ?? 0)) / Math.max(1, rationTotal);
      }
      draft.shipments.push({
        arrivalSol: draft.sol + site.resupply.leadDays,
        vitaminsKg: mix,
        includesDataDrop: true,
      });
      draft.nextEarthOrderSol = draft.sol + site.resupply.leadDays + 1;
    }
  }
  // Deliver anything that has arrived.
  const arrived = draft.shipments.filter((s) => s.arrivalSol <= draft.sol);
  if (arrived.length > 0) {
    draft.shipments = draft.shipments.filter((s) => s.arrivalSol > draft.sol);
    for (const shipment of arrived) {
      let massKgTotal = 0;
      for (const v of VITAMIN_IDS) {
        draft.vitaminsKg[v] += shipment.vitaminsKg[v];
        massKgTotal += shipment.vitaminsKg[v];
      }
      draft.importedKgCum += massKgTotal;
      draft.atoms.massInCumKg += massKgTotal;
      if (shipment.includesDataDrop) {
        draft.dataDropsReceived += 1;
      }
      logEvent(draft, 'resupply', `Resupply landed: ${(massKgTotal / 1000).toFixed(1)} t of vitamins${shipment.includesDataDrop ? ' + process data drop' : ''}.`);
    }
  }

  // ---- 10. robot wear, failures, repair ------------------------------------
  const shape = constantValue('robotWeibullShape');
  const scale = constantValue('robotWeibullScaleHours');
  for (const robot of draft.robots) {
    if (robot.status === 'broken') {
      continue;
    }
    // Dust fouling accumulates while working in dusty air; storms are brutal.
    if (robot.status === 'working' && draft.siteId === 'mars') {
      robot.dustFouling = Math.min(1, robot.dustFouling + (tau > 1.5 ? 0.003 : 0.0004) * dtHours);
    }
    if (robot.status === 'working') {
      // Weibull hazard h(t) = (k/λ)(t/λ)^(k−1); per-tick failure probability ≈ h·dt.
      const t = Math.max(1, robot.operatingHours);
      const hazardPerHour = (shape / scale) * Math.pow(t / scale, shape - 1);
      const failureProb = Math.min(0.5, hazardPerHour * dtHours * (1 + robot.dustFouling));
      if (roll(draft) < failureProb) {
        robot.status = 'broken';
        robot.task = null;
        logEvent(draft, 'robot-failure', `Robot #${robot.id} (${robot.type}) down at ${Math.round(robot.operatingHours)} op-hours. A broken robot is negative hands.`);
      }
    }
  }
  // Technicians repair the broken, oldest-first: hours + steel + occasionally an actuator.
  let repairHoursLeft = labor.hours.repair;
  for (const robot of draft.robots) {
    if (robot.status !== 'broken') {
      continue;
    }
    if (repairHoursLeft < REPAIR_HOURS_PER_ROBOT || draft.atoms.refinedKg.Fe < REPAIR_MASS_KG) {
      break;
    }
    // One in five repairs consumes a spare actuator; without one, the repair waits.
    const needsActuator = roll(draft) < 0.2;
    if (needsActuator && draft.parts.verified.actuator < 1) {
      continue;
    }
    repairHoursLeft -= REPAIR_HOURS_PER_ROBOT;
    draft.atoms.refinedKg.Fe -= REPAIR_MASS_KG;
    draft.atoms.scrapKg.Fe += REPAIR_MASS_KG; // swapped-out worn parts hit the scrap pile
    if (needsActuator) {
      draft.parts.verified.actuator -= 1;
      draft.atoms.scrapKg.other += partUnitMassKg('actuator'); // old actuator downcycles
      robot.massKg += 0; // replacement actuator mass swaps 1:1 — no net change
    }
    robot.status = 'idle';
    robot.operatingHours *= 0.4; // overhaul resets most of the wear clock — ASSUMED
    robot.dustFouling *= 0.2;
  }
  // Remaining repair hours clean dust off working robots.
  if (repairHoursLeft > 0) {
    for (const robot of draft.robots) {
      if (robot.dustFouling > 0.05 && repairHoursLeft > 0.5) {
        robot.dustFouling *= 0.7;
        repairHoursLeft -= 0.5;
      }
    }
  }

  // ---- 11. child wake, doublings, end states --------------------------------
  // Completion fraction: mass-weighted progress against the full wake spec.
  {
    const specMass = childSpecMassKg();
    let doneMass = draft.child.feedstockKg;
    for (const [partId, specCount] of Object.entries(CHILD_SPEC.parts) as [PartId, number][]) {
      doneMass += Math.min(draft.child.allocatedParts[partId], specCount) * partUnitMassKg(partId);
    }
    for (const v of VITAMIN_IDS) {
      doneMass += Math.min(draft.child.rationKg[v], CHILD_SPEC.vitaminRationKg[v] ?? 0);
    }
    draft.child.completionFraction = specMass > 0 ? Math.min(1, doneMass / specMass) : 0;
  }
  // Wake check: full spec + charged battery + daylight.
  if (draft.child.completionFraction >= 0.999 && draft.child.wokeSol === null) {
    const socFraction = draft.energy.batteryCapacityKwh > 0 ? draft.energy.batteryKwh / draft.energy.batteryCapacityKwh : 0;
    if (socFraction >= constantValue('childWakeBatteryFraction') && !isNight) {
      // The generation ticks. The child walks out to its own pad.
      draft.generation += 1;
      draft.activeSeedCount += 1;
      let shippedKg = draft.child.feedstockKg;
      for (const [partId, count] of Object.entries(draft.child.allocatedParts) as [PartId, number][]) {
        shippedKg += count * partUnitMassKg(partId);
      }
      for (const v of VITAMIN_IDS) {
        shippedKg += draft.child.rationKg[v];
      }
      draft.shippedChildrenMassKg += shippedKg;
      draft.child = {
        allocatedParts: zeroParts(),
        rationKg: zeroVitamins(),
        feedstockKg: 0,
        chassisStarted: false,
        completionFraction: 0,
        wokeSol: null,
      };
      logEvent(draft, 'child-wake', `GENERATION ${draft.generation} IS AWAKE. The child walks to its own pad and starts printing.`);
      if (draft.endState === null) {
        draft.endState = 'child-awoke';
      }
    }
  }

  // ---- 12. energy settlement -----------------------------------------------
  {
    let usedKwh = 0;
    for (const lane of Object.keys(budget.usedByLane) as (TaskId | 'survival')[]) {
      usedKwh += budget.usedByLane[lane];
      draft.energy.consumedCumKwh[lane] += budget.usedByLane[lane];
    }
    const newBattery = draft.energy.batteryKwh + generatedKwh - usedKwh;
    if (newBattery > draft.energy.batteryCapacityKwh) {
      draft.energy.curtailedCumKwh += newBattery - draft.energy.batteryCapacityKwh;
      draft.energy.batteryKwh = draft.energy.batteryCapacityKwh;
    } else {
      draft.energy.batteryKwh = Math.max(0, newBattery);
    }
    draft.energy.currentLoadKwe = dtHours > 0 ? usedKwh / dtHours : 0;
  }

  // ---- 13. doubling detection & failure end-states ---------------------------
  const capacity = capacityMassKg(draft);
  if (draft.capacityBaselineKg <= 0) {
    draft.capacityBaselineKg = capacity;
  }
  while (capacity >= draft.capacityBaselineKg * Math.pow(2, draft.doublings.length + 1)) {
    const importSince = draft.importedKgCum - draft.importedKgAtLastDoubling;
    draft.doublings.push({
      multiple: Math.pow(2, draft.doublings.length + 1),
      sol: draft.sol,
      importKgSinceLast: importSince,
    });
    draft.importedKgAtLastDoubling = draft.importedKgCum;
    logEvent(draft, 'doubling', `Capacity ×${Math.pow(2, draft.doublings.length)} at sol ${Math.floor(draft.sol)} — ${Math.round(importSince)} kg imported this doubling.`);
    if (draft.doublings.length >= 3 && draft.endState !== 'three-doublings') {
      draft.endState = 'three-doublings';
    }
  }

  // Stall counters tick once per sol crossing (see snapshot block below).
  const crossedSol = Math.floor(draft.sol) > draft.lastSnapshotSol;
  if (crossedSol) {
    const totalVitamins = VITAMIN_IDS.reduce((sum, v) => sum + draft.vitaminsKg[v], 0);
    const inbound = draft.shipments.length > 0;
    draft.stallCounters.vitamin = anyVitaminStarved && totalVitamins < 50 && !inbound ? draft.stallCounters.vitamin + 1 : 0;
    // Energy death means true brownout: survival load itself went unpaid.
    draft.stallCounters.energy = brownedOut ? draft.stallCounters.energy + 1 : 0;
    // Hands collapse means the fleet is dead, not asleep: sheltering robots
    // through a storm night are still hands tomorrow.
    const ableRobots = draft.robots.filter((r) => r.status !== 'broken').length;
    draft.stallCounters.hands = ableRobots === 0 ? draft.stallCounters.hands + 1 : 0;

    if (draft.endState === null || draft.endState === 'child-awoke') {
      if (draft.stallCounters.vitamin >= 30) {
        draft.endState = 'vitamin-cliff';
        logEvent(draft, 'vitamin-stall', 'VITAMIN CLIFF: bodies printed, no motors or controllers to animate them. Pallets of almost-robots.');
      } else if (draft.stallCounters.energy >= 3) {
        draft.endState = 'energy-death';
        logEvent(draft, 'energy-crisis', 'ENERGY DEATH: batteries flat, arrays dark. The kiln ware has cooled mid-cycle.');
      } else if (draft.stallCounters.hands >= 10) {
        draft.endState = 'hands-collapse';
        logEvent(draft, 'info', 'HANDS COLLAPSE: every robot is down and nothing can fix them. The factory is a sculpture.');
      }
    }
  }

  // ---- 14. per-sol snapshot + conservation audit -----------------------------
  if (crossedSol) {
    draft.lastSnapshotSol = Math.floor(draft.sol);
    // Projected doubling time from the trailing growth window.
    let doublingTime: number | null = null;
    const past = draft.history.length >= GROWTH_WINDOW_SOLS ? draft.history[draft.history.length - GROWTH_WINDOW_SOLS] : draft.history[0];
    if (past && past.capacityKg > 0 && capacity > past.capacityKg) {
      const growthPerSol = Math.log(capacity / past.capacityKg) / Math.max(1, draft.sol - past.sol);
      if (growthPerSol > 1e-9) {
        doublingTime = Math.log(2) / growthPerSol;
      }
    }
    // Mass audit: everything tracked vs everything that entered.
    const tracked = totalTrackedMassKg(draft);
    draft.massClosureError = draft.atoms.massInCumKg > 0 ? Math.abs(tracked - draft.atoms.massInCumKg) / draft.atoms.massInCumKg : 0;

    let junkCount = 0;
    let scrapTotal = 0;
    for (const partId of PART_IDS) {
      junkCount += draft.parts.junk[partId];
    }
    for (const el of ELEMENT_IDS) {
      scrapTotal += draft.atoms.scrapKg[el];
    }
    const snapshot: SolSnapshot = {
      sol: Math.floor(draft.sol),
      capacityKg: capacity,
      doublingTimeSols: doublingTime,
      solarKwe: solarKwe,
      batteryFraction: draft.energy.batteryCapacityKwh > 0 ? draft.energy.batteryKwh / draft.energy.batteryCapacityKwh : 0,
      opticalDepth: tau,
      workingRobots: labor.workingRobots,
      brokenRobots: draft.robots.filter((r) => r.status === 'broken').length,
      scrapKg: scrapTotal,
      junkCount,
      generation: draft.generation,
      childCompletion: draft.child.completionFraction,
      vitaminsKg: VITAMIN_IDS.reduce((sum, v) => sum + draft.vitaminsKg[v], 0),
      importKgCum: draft.importedKgCum,
    };
    draft.history.push(snapshot);
  }

  return draft;
}

/** Advance the sim by whole sols using a fixed internal tick. */
export function advanceSols(state: SimState, sols: number, tickHours: number): SimState {
  if (!Number.isFinite(sols) || sols <= 0 || !Number.isFinite(tickHours) || tickHours <= 0) {
    return state;
  }
  const site = SITES[state.siteId];
  const totalHours = sols * site.solLengthHours;
  let current = state;
  let elapsed = 0;
  while (elapsed < totalHours) {
    const dt = Math.min(tickHours, totalHours - elapsed);
    current = step(current, dt);
    elapsed += dt;
  }
  return current;
}
