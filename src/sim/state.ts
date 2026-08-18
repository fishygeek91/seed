/**
 * SimState: the complete, serializable state of one SEED scenario.
 *
 * The simulation is a pure function step(state, dtHours) => nextState.
 * Everything the sim can read or write lives here; the UI only renders
 * this object and dispatches allocation changes.
 */

import type { ElementId, PartId, RobotTypeId, SiteId, TaskId, TemplateId, VitaminId } from '@/sim/ids';
import { ELEMENT_IDS, VITAMIN_IDS, PART_IDS, ROBOT_TYPE_IDS } from '@/sim/ids';
import { buildManifest } from '@/data/templates';
import { constantValue } from '@/sim/constants';
import { seedFromString } from '@/sim/rng';

/** One worker robot. Labor is physics: battery, wear, dust, a failure curve. */
export interface RobotState {
  readonly id: number;
  readonly type: RobotTypeId;
  readonly status: 'working' | 'idle' | 'sheltering' | 'broken';
  readonly task: TaskId | null;
  /** Cumulative operating hours — drives the Weibull wear-out hazard. */
  readonly operatingHours: number;
  /** Dust fouling 0–1; reduces effective work rate until cleaned. */
  readonly dustFouling: number;
  /** This robot's as-built mass, kg (landed units differ from printed units). */
  readonly massKg: number;
  /** Ancestry: which generation's factory built this robot. */
  readonly builtByGeneration: number;
  /** Sol this robot woke. */
  readonly bornSol: number;
  /** Human-readable provenance, e.g. 'landed cargo' or 'gen-0 kiln line'. */
  readonly provenance: string;
}

/** Atoms ledger: feedstock → WIP → parts → machines → scrap → recycle. Nothing is deleted. */
export interface AtomsLedger {
  /** Raw mined mass awaiting beneficiation (Mars regolith / Earth ore), kg. */
  readonly rawFeedKg: number;
  /** Refined element stocks ready for recipes, kg per bin. */
  readonly refinedKg: Record<ElementId, number>;
  /** Work-in-progress mass currently inside fab processes, kg per part. */
  readonly wipKg: Partial<Record<PartId, number>>;
  /** Scrap awaiting remelt, kg per element bin (vitamin mass downcycles into 'other'). */
  readonly scrapKg: Record<ElementId, number>;
  /** Beneficiation tailings — mass hauled but rejected, kg. Kept so mass closes. */
  readonly tailingsKg: number;
  /** Cumulative mass that entered the system boundary (landed + mined + imported), kg. */
  readonly massInCumKg: number;
}

/** Joules ledger. Generation, storage, sinks. Must close: in = used + stored + curtailed. */
export interface EnergyLedger {
  /** Battery state of charge, kWh. */
  readonly batteryKwh: number;
  /** Installed battery capacity, kWh. */
  readonly batteryCapacityKwh: number;
  /** Deployed solar array mass, kg (nameplate = mass × kW/kg). */
  readonly solarMassKg: number;
  /** Cumulative generation, kWh. */
  readonly generatedCumKwh: number;
  /** Cumulative consumption by sink, kWh. */
  readonly consumedCumKwh: Record<TaskId | 'survival', number>;
  /** Cumulative solar energy curtailed (battery full, nothing to power), kWh. */
  readonly curtailedCumKwh: number;
  /** Battery energy landed with the seed (initial stock), kWh — for closure. */
  readonly landedBatteryKwh: number;
  /** Instantaneous solar output last tick, kWe (display convenience). */
  readonly currentSolarKwe: number;
  /** Instantaneous total load last tick, kWe (display convenience). */
  readonly currentLoadKwe: number;
}

/** Parts inventory: unverified (fresh off the line) vs verified (passed QA) vs junk (failed QA, on the floor). */
export interface PartsInventory {
  readonly unverified: Record<PartId, number>;
  readonly verified: Record<PartId, number>;
  readonly junk: Record<PartId, number>;
  /** QA hours banked toward the next unit of each part — lets multi-hour inspections span ticks. */
  readonly qaBankedHours: Partial<Record<PartId, number>>;
}

/** Library entry for one part: can we make it, and is the vitamin substituted yet? */
export interface LibraryEntry {
  /** True once a local substitute replaces all vitamin inputs. */
  readonly localized: boolean;
  /** Process-dev robot-hours invested so far. */
  readonly devHoursInvested: number;
  /** Trial mass consumed so far, kg. */
  readonly trialMassConsumedKg: number;
}

/** Progress toward assembling and waking the next-generation child. */
export interface ChildProgress {
  /** Verified parts allocated to the child so far. */
  readonly allocatedParts: Record<PartId, number>;
  /** Vitamin ration staged for the child, kg per bin. */
  readonly rationKg: Record<VitaminId, number>;
  /** Starter feedstock staged, kg. */
  readonly feedstockKg: number;
  /** True once the chassis exists and the build is visible on the pad. */
  readonly chassisStarted: boolean;
  /** 0–1 completion of the full wake spec. */
  readonly completionFraction: number;
  /** Sol the child woke; null while gestating. */
  readonly wokeSol: number | null;
}

/** A resupply shipment in flight or queued. */
export interface Shipment {
  readonly arrivalSol: number;
  readonly vitaminsKg: Record<VitaminId, number>;
  readonly includesDataDrop: boolean;
}

/** One entry in the event feed (also drives the demo beats). */
export interface SimEvent {
  readonly sol: number;
  readonly kind:
    | 'landing'
    | 'solar-deployed'
    | 'first-print'
    | 'chassis-started'
    | 'storm-start'
    | 'storm-end'
    | 'resupply'
    | 'window-missed'
    | 'child-wake'
    | 'doubling'
    | 'localized'
    | 'robot-failure'
    | 'energy-crisis'
    | 'vitamin-stall'
    | 'qa-backlog'
    | 'info';
  readonly message: string;
}

/** A recorded capacity doubling. */
export interface DoublingRecord {
  readonly multiple: number; // 2, 4, 8, ...
  readonly sol: number;
  readonly importKgSinceLast: number;
}

/** Light per-sol snapshot for the time scrubber and charts. */
export interface SolSnapshot {
  readonly sol: number;
  readonly capacityKg: number;
  readonly doublingTimeSols: number | null; // null = diverging / not yet measurable
  readonly solarKwe: number;
  readonly batteryFraction: number;
  readonly opticalDepth: number;
  readonly workingRobots: number;
  readonly brokenRobots: number;
  readonly scrapKg: number;
  readonly junkCount: number;
  readonly generation: number;
  readonly childCompletion: number;
  readonly vitaminsKg: number;
  readonly importKgCum: number;
}

/** User-controlled allocation weights across labor lanes (relative, normalized in-step). */
export type Allocations = Record<TaskId, number>;

/** The complete scenario state. */
export interface SimState {
  // --- configuration (frozen at new-game) ---
  readonly siteId: SiteId;
  readonly templateId: TemplateId;
  readonly payloadMassT: number;
  readonly scenarioSeed: string;
  // --- deterministic RNG state ---
  readonly rngState: number;
  // --- clock ---
  readonly sol: number; // fractional sols elapsed since landing
  readonly hourOfSol: number; // 0..solLengthHours
  // --- the four flows ---
  readonly atoms: AtomsLedger;
  readonly energy: EnergyLedger;
  readonly robots: readonly RobotState[];
  readonly library: Record<PartId, LibraryEntry>;
  // --- inventories & machines ---
  readonly parts: PartsInventory;
  readonly machinesDeployed: Record<'kilnPrinter' | 'machiningStation' | 'minerTool', number>;
  // --- vitamins ---
  readonly vitaminsKg: Record<VitaminId, number>;
  readonly importedKgCum: number;
  readonly importedKgAtLastDoubling: number;
  readonly dataDropsReceived: number;
  // --- replication ---
  readonly generation: number;
  readonly activeSeedCount: number; // woken seeds all replicate; scales aggregate production
  readonly child: ChildProgress;
  readonly doublings: readonly DoublingRecord[];
  readonly capacityBaselineKg: number;
  // --- logistics ---
  readonly shipments: readonly Shipment[];
  readonly nextEarthOrderSol: number | null;
  // --- controls ---
  readonly allocations: Allocations;
  // --- output streams ---
  readonly events: readonly SimEvent[];
  readonly history: readonly SolSnapshot[];
  readonly lastSnapshotSol: number;
  // --- process-dev focus (planner-chosen, shown in UI) ---
  readonly procdevTarget: PartId | null;
  // --- mass shipped out with woken children (still counted as capacity) ---
  readonly shippedChildrenMassKg: number;
  // --- consecutive-sol stall counters that trip failure end states ---
  readonly stallCounters: { readonly vitamin: number; readonly energy: number; readonly hands: number };
  // --- mass-conservation audit: |tracked − input| / input, updated per snapshot ---
  readonly massClosureError: number;
  // --- end-state flag ---
  readonly endState:
    | null
    | 'child-awoke'
    | 'three-doublings'
    | 'vitamin-cliff'
    | 'energy-death'
    | 'hands-collapse'
    | 'dust-stall';
}

/** Zeroed per-element record helper. */
export function zeroElements(): Record<ElementId, number> {
  const out = {} as Record<ElementId, number>;
  for (const el of ELEMENT_IDS) {
    out[el] = 0;
  }
  return out;
}

/** Zeroed per-vitamin record helper. */
export function zeroVitamins(): Record<VitaminId, number> {
  const out = {} as Record<VitaminId, number>;
  for (const v of VITAMIN_IDS) {
    out[v] = 0;
  }
  return out;
}

/** Zeroed per-part record helper. */
export function zeroParts(): Record<PartId, number> {
  const out = {} as Record<PartId, number>;
  for (const p of PART_IDS) {
    out[p] = 0;
  }
  return out;
}

/** Default allocation weights: a sane balanced loop with QA and repair funded. */
export function defaultAllocations(): Allocations {
  return {
    mine: 14,
    haul: 10,
    process: 14,
    print: 18,
    assemble: 16,
    qa: 12,
    repair: 8,
    recycle: 4,
    procdev: 4,
  };
}

/** Options for creating a new scenario. */
export interface NewGameOptions {
  readonly siteId: SiteId;
  readonly templateId: TemplateId;
  readonly payloadMassT: number;
  readonly scenarioSeed: string;
}

/**
 * Build Generation 0: one landed seed, cargo per the chosen template.
 * Every kilogram of payload lands in exactly one ledger bin.
 */
export function createInitialState(options: NewGameOptions): SimState {
  const manifest = buildManifest(options.templateId, options.payloadMassT);
  const batterySpecific = constantValue('batterySpecificEnergyKwhPerKg');

  // Landed robots, provenance 'landed cargo'.
  const robots: RobotState[] = [];
  let nextId = 1;
  for (const role of ROBOT_TYPE_IDS) {
    for (let i = 0; i < manifest.robotCounts[role]; i += 1) {
      robots.push({
        id: nextId,
        type: role,
        status: 'idle',
        task: null,
        operatingHours: 0,
        dustFouling: 0,
        massKg: constantValue('robotMassKg'),
        builtByGeneration: 0,
        bornSol: 0,
        provenance: 'landed cargo',
      });
      nextId += 1;
    }
  }

  // Refined feedstock lands pre-split: mostly Fe, then Al/Si/C/other. ASSUMED split of the starter pallet.
  const refined = zeroElements();
  refined.Fe = manifest.feedstockKg * 0.45;
  refined.Al = manifest.feedstockKg * 0.15;
  refined.Si = manifest.feedstockKg * 0.15;
  refined.C = manifest.feedstockKg * 0.1;
  refined.H2O = manifest.feedstockKg * 0.05;
  refined.other = manifest.feedstockKg * 0.1;

  const library = {} as Record<PartId, LibraryEntry>;
  for (const p of PART_IDS) {
    library[p] = { localized: false, devHoursInvested: 0, trialMassConsumedKg: 0 };
  }

  const consumed = {
    mine: 0,
    haul: 0,
    process: 0,
    print: 0,
    assemble: 0,
    qa: 0,
    repair: 0,
    recycle: 0,
    procdev: 0,
    survival: 0,
  } as Record<TaskId | 'survival', number>;

  const landedBatteryKwh = manifest.batteryMassKg * batterySpecific;

  const initial: SimState = {
    siteId: options.siteId,
    templateId: options.templateId,
    payloadMassT: options.payloadMassT,
    scenarioSeed: options.scenarioSeed,
    rngState: seedFromString(`${options.scenarioSeed}|${options.siteId}|${options.templateId}`),
    sol: 0,
    hourOfSol: 6, // land at local morning so the demo opens in daylight
    atoms: {
      rawFeedKg: 0,
      refinedKg: refined,
      wipKg: {},
      scrapKg: zeroElements(),
      tailingsKg: 0,
      massInCumKg: manifest.totalMassKg,
    },
    energy: {
      batteryKwh: landedBatteryKwh * 0.9, // ships at 90% SoC — ASSUMED transit self-discharge
      batteryCapacityKwh: landedBatteryKwh,
      solarMassKg: manifest.solarMassKg,
      generatedCumKwh: 0,
      consumedCumKwh: consumed,
      curtailedCumKwh: 0,
      landedBatteryKwh: landedBatteryKwh * 0.9,
      currentSolarKwe: 0,
      currentLoadKwe: 0,
    },
    robots,
    library,
    parts: { unverified: zeroParts(), verified: zeroParts(), junk: zeroParts(), qaBankedHours: {} },
    machinesDeployed: {
      kilnPrinter: manifest.kilnPrinterCount,
      machiningStation: manifest.machiningStationCount,
      minerTool: 0,
    },
    vitaminsKg: { ...manifest.vitaminsKg },
    importedKgCum: Object.values(manifest.vitaminsKg).reduce((a, b) => a + b, 0),
    importedKgAtLastDoubling: Object.values(manifest.vitaminsKg).reduce((a, b) => a + b, 0),
    dataDropsReceived: 0,
    generation: 0,
    activeSeedCount: 1,
    child: {
      allocatedParts: zeroParts(),
      rationKg: zeroVitamins(),
      feedstockKg: 0,
      chassisStarted: false,
      completionFraction: 0,
      wokeSol: null,
    },
    doublings: [],
    capacityBaselineKg: 0, // computed by the first step
    shipments: [],
    nextEarthOrderSol: options.siteId === 'earth' ? 0 : null,
    allocations: defaultAllocations(),
    events: [{ sol: 0, kind: 'landing', message: 'Generation 0 seed has landed. Deploying solar.' }],
    history: [],
    lastSnapshotSol: -1,
    procdevTarget: null,
    shippedChildrenMassKg: 0,
    stallCounters: { vitamin: 0, energy: 0, hands: 0 },
    massClosureError: 0,
    endState: null,
  };
  return initial;
}
