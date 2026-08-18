/**
 * The parts library / recipe graph.
 *
 * Replication is recipes, not magic. Every part costs atoms + joules +
 * robot-hours + yield loss + vitamins. Mass is conserved: a finished part
 * weighs exactly the sum of its element and vitamin inputs; failed attempts
 * dump their full input mass onto the scrap pile (elements) and the junk
 * floor (whole rejected parts), never into the void.
 */

import type { ElementId, MachineId, PartId, VitaminId } from '@/sim/ids';

/** How a vitamin dependency can eventually be replaced by a local process. */
export interface LocalizationPath {
  /** Robot-hours of process development required before the substitute works. */
  readonly devRobotHours: number;
  /** Trial mass consumed (scrapped) during development, in kg of refined feedstock. */
  readonly trialMassKg: number;
  /** True if an Earth data drop (arrives with any resupply) must land first. */
  readonly requiresDataDrop: boolean;
  /** Local element mass that replaces the vitamin mass once localized (must equal the vitamin kg being replaced). */
  readonly substituteInputsKg: Partial<Record<ElementId, number>>;
  /** Yield multiplier applied after localization (local substitutes are usually worse at first). */
  readonly yieldPenalty: number;
}

/** A single recipe in the parts library. */
export interface PartRecipe {
  readonly id: PartId;
  readonly name: string;
  /** Refined element inputs per unit, kg. */
  readonly inputsKg: Partial<Record<ElementId, number>>;
  /** Imported vitamin inputs per unit, kg (until localized). */
  readonly vitaminsKg: Partial<Record<VitaminId, number>>;
  /** Fabrication + assembly energy per attempted unit, kWh. */
  readonly energyKwh: number;
  /** Direct labor per attempted unit, robot-hours. */
  readonly robotHours: number;
  /** Machines that must exist (count ≥ 1) to attempt this part. Empty = hand-buildable from landed tooling. */
  readonly toolsRequired: readonly MachineId[];
  /** Fraction of attempts that pass fabrication; the rest scrap their inputs. */
  readonly yieldFraction: number;
  /** QA labor per unit, robot-hours. Skipping QA ships silent junk. */
  readonly qaHours: number;
  /** Sub-parts consumed per unit (assembly tree). Consumed parts carry their own mass. */
  readonly subParts: Partial<Record<PartId, number>>;
  /** Optional path to eliminating this part's vitamin inputs locally. */
  readonly localization?: LocalizationPath;
}

/** Sum of element + vitamin + sub-part mass = finished part mass. Computed, never hand-typed. */
export function partUnitMassKg(id: PartId): number {
  const recipe = PART_RECIPES[id];
  let mass = 0;
  for (const kgValue of Object.values(recipe.inputsKg)) {
    mass += kgValue;
  }
  for (const kgValue of Object.values(recipe.vitaminsKg)) {
    mass += kgValue;
  }
  for (const [subId, count] of Object.entries(recipe.subParts) as [PartId, number][]) {
    mass += partUnitMassKg(subId) * count;
  }
  return mass;
}

/**
 * The recipe graph. Big enough to hurt: structure, power, actuation,
 * sensing, sealing, tooling, mobility, robots, and the child chassis.
 */
export const PART_RECIPES: Record<PartId, PartRecipe> = {
  structuralFrame: {
    id: 'structuralFrame',
    name: 'Structural frame',
    // Sintered steel box-section frame, ~40 kg. Printable early: it is the easy 85% of mass.
    inputsKg: { Fe: 36, Al: 4 },
    vitaminsKg: {},
    energyKwh: 110, // 40 kg × 2.5 kWh/kg sinter + finishing (constants: sinterEnergyKwhPerKg)
    robotHours: 3,
    toolsRequired: ['kilnPrinter'],
    yieldFraction: 0.9,
    qaHours: 0.5,
    subParts: {},
  },
  solarSection: {
    id: 'solarSection',
    name: 'Solar array section',
    // 50 kg deployable section ≈ 5 kWe at 0.1 kW/kg (constants: solarSpecificPowerKwPerKg).
    // Local Si cell line is primitive; power electronics stay imported until localized.
    inputsKg: { Si: 30, Al: 14, Fe: 3 },
    vitaminsKg: { chipsPower: 3 },
    energyKwh: 160,
    robotHours: 6,
    toolsRequired: ['kilnPrinter'],
    yieldFraction: 0.8,
    qaHours: 1,
    subParts: {},
    localization: {
      devRobotHours: 14000, // a local PV + power-electronics line is a multi-year program — ASSUMED
      trialMassKg: 4000,
      requiresDataDrop: true,
      substituteInputsKg: { Si: 3 },
      yieldPenalty: 0.85,
    },
  },
  powerCable: {
    id: 'powerCable',
    name: 'Power cable run',
    // 10 kg aluminium conductor + printed polymer jacket. Fully local from sol 0.
    inputsKg: { Al: 8, C: 2 },
    vitaminsKg: {},
    energyKwh: 18,
    robotHours: 1,
    toolsRequired: ['kilnPrinter'],
    yieldFraction: 0.95,
    qaHours: 0.2,
    subParts: {},
  },
  batteryPack: {
    id: 'batteryPack',
    name: 'Battery pack',
    // 60 kg pack ≈ 12 kWh at 0.2 kWh/kg (constants: batterySpecificEnergyKwhPerKg).
    // Electrolyte + separator chemistry is a vitamin until a local cell line exists.
    inputsKg: { Fe: 20, Al: 15, C: 10 },
    vitaminsKg: { chemicals: 12, chipsPower: 3 },
    energyKwh: 140,
    robotHours: 8,
    toolsRequired: ['kilnPrinter', 'machiningStation'],
    yieldFraction: 0.75,
    qaHours: 2,
    subParts: {},
    localization: {
      devRobotHours: 18000, // local cell chemistry from scratch — ASSUMED, hardest program
      trialMassKg: 5000,
      requiresDataDrop: true,
      substituteInputsKg: { C: 10, other: 5 },
      yieldPenalty: 0.8,
    },
  },
  actuator: {
    id: 'actuator',
    name: 'Precision actuator',
    // 12 kg joint actuator. Housing prints locally; the rolling elements and
    // magnet stack are the vitamin. This is the part that freezes robot production.
    inputsKg: { Fe: 7 },
    vitaminsKg: { actuatorsBearings: 4, chipsPower: 1 },
    energyKwh: 45,
    robotHours: 4,
    toolsRequired: ['kilnPrinter', 'machiningStation'],
    yieldFraction: 0.7,
    qaHours: 1.5,
    subParts: {},
    localization: {
      devRobotHours: 9000, // grinding your own bearing races on Mars is slow — ASSUMED
      trialMassKg: 2500,
      requiresDataDrop: false,
      substituteInputsKg: { Fe: 5 },
      yieldPenalty: 0.75,
    },
  },
  sensorComputeModule: {
    id: 'sensorComputeModule',
    name: 'Sensor / compute module',
    // 5 kg of cameras, IMUs, radios, and compute. Almost pure vitamin: the
    // hardest thing to localize, by design. Only the bracket is local.
    inputsKg: { Al: 1 },
    vitaminsKg: { opticsSensors: 2, chipsPower: 2 },
    energyKwh: 8,
    robotHours: 2,
    toolsRequired: [],
    yieldFraction: 0.95,
    qaHours: 1,
    subParts: {},
  },
  sealKit: {
    id: 'sealKit',
    name: 'Seal / lubricant kit',
    // 3 kg of o-rings, gaskets, grease. Tiny mass, total veto power: a missing
    // seal freezes the kiln subtree.
    inputsKg: {},
    vitaminsKg: { sealsLubricants: 3 },
    energyKwh: 1,
    robotHours: 0.5,
    toolsRequired: [],
    yieldFraction: 0.98,
    qaHours: 0.2,
    subParts: {},
    localization: {
      devRobotHours: 3500, // polymer seals from local carbon feed — ASSUMED, the first program to close
      trialMassKg: 800,
      requiresDataDrop: false,
      substituteInputsKg: { C: 3 },
      yieldPenalty: 0.9,
    },
  },
  kilnPrinter: {
    id: 'kilnPrinter',
    name: 'Kiln / printer line',
    // The machine that makes machines: sinter kiln + powder handling + print head.
    // 2 kg/h finished throughput each (constants: printerThroughputKgPerHour).
    inputsKg: { Fe: 120, Si: 30, other: 20 },
    vitaminsKg: {},
    energyKwh: 700,
    robotHours: 60,
    toolsRequired: ['kilnPrinter'], // printers print printer parts
    yieldFraction: 0.85,
    qaHours: 10,
    subParts: { structuralFrame: 2, actuator: 2, sensorComputeModule: 1, sealKit: 2, powerCable: 1 },
  },
  machiningStation: {
    id: 'machiningStation',
    name: 'Machining station',
    // Post-print precision: drills the holes the sinter cannot hold tolerance on.
    inputsKg: { Fe: 90, other: 10 },
    vitaminsKg: {},
    energyKwh: 450,
    robotHours: 40,
    toolsRequired: ['kilnPrinter'],
    yieldFraction: 0.85,
    qaHours: 8,
    subParts: { structuralFrame: 1, actuator: 3, sensorComputeModule: 1, sealKit: 1 },
  },
  minerTool: {
    id: 'minerTool',
    name: 'Miner toolhead',
    // Bucket-wheel + crusher toolhead for the miner chassis. Seals matter: dust.
    inputsKg: { Fe: 45 },
    vitaminsKg: {},
    energyKwh: 130,
    robotHours: 10,
    toolsRequired: ['kilnPrinter', 'machiningStation'],
    yieldFraction: 0.85,
    qaHours: 2,
    subParts: { sealKit: 1, actuator: 1 },
  },
  wheelset: {
    id: 'wheelset',
    name: 'Wheelset / drivetrain',
    // Hauler mobility: printed hubs, imported bearings inside the actuator.
    inputsKg: { Fe: 25, C: 5 },
    vitaminsKg: {},
    energyKwh: 80,
    robotHours: 6,
    toolsRequired: ['kilnPrinter', 'machiningStation'],
    yieldFraction: 0.85,
    qaHours: 1,
    subParts: { actuator: 2, sealKit: 1 },
  },
  robotMiner: {
    id: 'robotMiner',
    name: 'Robot — miner',
    inputsKg: { Fe: 5 },
    vitaminsKg: {},
    energyKwh: 60,
    robotHours: 20,
    toolsRequired: ['machiningStation'],
    yieldFraction: 0.9,
    qaHours: 4,
    subParts: { structuralFrame: 1, actuator: 4, sensorComputeModule: 1, sealKit: 1, minerTool: 1, batteryPack: 1 },
  },
  robotHauler: {
    id: 'robotHauler',
    name: 'Robot — hauler',
    inputsKg: { Fe: 5 },
    vitaminsKg: {},
    energyKwh: 60,
    robotHours: 20,
    toolsRequired: ['machiningStation'],
    yieldFraction: 0.9,
    qaHours: 4,
    subParts: { structuralFrame: 1, actuator: 2, sensorComputeModule: 1, sealKit: 1, wheelset: 1, batteryPack: 1 },
  },
  robotAssembler: {
    id: 'robotAssembler',
    name: 'Robot — assembler',
    inputsKg: { Fe: 5 },
    vitaminsKg: {},
    energyKwh: 60,
    robotHours: 24,
    toolsRequired: ['machiningStation'],
    yieldFraction: 0.9,
    qaHours: 5,
    subParts: { structuralFrame: 1, actuator: 6, sensorComputeModule: 1, sealKit: 1, batteryPack: 1 },
  },
  robotTechnician: {
    id: 'robotTechnician',
    name: 'Robot — technician',
    inputsKg: { Fe: 5 },
    vitaminsKg: {},
    energyKwh: 60,
    robotHours: 24,
    toolsRequired: ['machiningStation'],
    yieldFraction: 0.9,
    qaHours: 6,
    subParts: { structuralFrame: 1, actuator: 5, sensorComputeModule: 2, sealKit: 1, batteryPack: 1 },
  },
  childSeedChassis: {
    id: 'childSeedChassis',
    name: 'Child seed chassis',
    // The stainless flower: pressure-tight core, deployment mechanisms, pad feet.
    // The chassis alone is not a child — the wake spec in constants demands
    // power, hands, printers, library, and a vitamin ration on top.
    inputsKg: { Fe: 700, Al: 100, Si: 50, other: 50 },
    vitaminsKg: {},
    energyKwh: 3200,
    robotHours: 300,
    toolsRequired: ['kilnPrinter', 'machiningStation'],
    yieldFraction: 0.9,
    qaHours: 40,
    subParts: { structuralFrame: 8, actuator: 6, sealKit: 4, powerCable: 4, sensorComputeModule: 1 },
  },
};

/**
 * The published minimum capability spec a Generation N+1 seed must meet to
 * count as a copy. Not "equal mass of scrap" — a deployable factory.
 */
export interface ChildSpec {
  /** Verified part counts that must be assembled into / staged with the child. */
  readonly parts: Partial<Record<PartId, number>>;
  /** Vitamin ration handed to the child so it can start printing, kg per bin. */
  readonly vitaminRationKg: Partial<Record<VitaminId, number>>;
  /** Refined feedstock starter stock, kg pooled. */
  readonly starterFeedstockKg: number;
}

/** Child wake spec: power, hands, printer throughput, brains, ration. */
export const CHILD_SPEC: ChildSpec = {
  parts: {
    childSeedChassis: 1,
    solarSection: 12, // ≈ 60 kWe nameplate
    batteryPack: 8, // ≈ 96 kWh night reserve
    kilnPrinter: 2,
    machiningStation: 1,
    robotMiner: 2,
    robotHauler: 2,
    robotAssembler: 3,
    robotTechnician: 2,
    sensorComputeModule: 2, // the library copy rides on redundant compute
    powerCable: 6,
  },
  vitaminRationKg: {
    actuatorsBearings: 120,
    chipsPower: 90,
    sealsLubricants: 40,
    opticsSensors: 40,
    chemicals: 60,
  },
  starterFeedstockKg: 2000,
};

/** Total finished mass of the child spec (parts + ration + feedstock), kg. */
export function childSpecMassKg(): number {
  let mass = CHILD_SPEC.starterFeedstockKg;
  for (const [partId, count] of Object.entries(CHILD_SPEC.parts) as [PartId, number][]) {
    mass += partUnitMassKg(partId) * count;
  }
  for (const kgValue of Object.values(CHILD_SPEC.vitaminRationKg)) {
    mass += kgValue;
  }
  return mass;
}
