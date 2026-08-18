/**
 * Cargo manifest templates for the landed seed.
 *
 * The whole manifest must sum to the payload slider (default 100 t).
 * Templates express mass fractions; `buildManifest` turns a template +
 * payload mass into concrete counts and kilograms, conserving mass to
 * within rounding (the remainder lands in pooled feedstock).
 */

import type { RobotTypeId, TemplateId, VitaminId } from '@/sim/ids';
import { constantValue } from '@/sim/constants';
import { partUnitMassKg } from '@/data/parts';

/** Mass-fraction shape of a cargo template. Fractions must sum to ≤ 1. */
export interface CargoTemplate {
  readonly id: TemplateId;
  readonly name: string;
  readonly blurb: string;
  /** Fraction of payload mass in worker robots. */
  readonly robotsFraction: number;
  /** Robot role mix within the robot mass. */
  readonly robotMix: Record<RobotTypeId, number>;
  /** Fraction in deployed solar array mass. */
  readonly solarFraction: number;
  /** Fraction in battery packs. */
  readonly batteryFraction: number;
  /** Fraction in kiln/printer + machining lines. */
  readonly printersFraction: number;
  /** Fraction in imported vitamins. */
  readonly vitaminsFraction: number;
  /** Vitamin bin mix within the vitamin mass. */
  readonly vitaminMix: Record<VitaminId, number>;
  // Remainder of payload = starter refined feedstock.
}

/** Concrete manifest: what actually steps off the ship. */
export interface LandedManifest {
  readonly robotCounts: Record<RobotTypeId, number>;
  readonly solarMassKg: number;
  readonly batteryMassKg: number;
  readonly kilnPrinterCount: number;
  readonly machiningStationCount: number;
  readonly vitaminsKg: Record<VitaminId, number>;
  readonly feedstockKg: number;
  readonly totalMassKg: number;
}

/** The four templates. */
export const TEMPLATES: Record<TemplateId, CargoTemplate> = {
  balanced: {
    id: 'balanced',
    name: 'Balanced seed',
    blurb: 'A little of everything. The default demo seed.',
    robotsFraction: 0.18,
    robotMix: { miner: 0.25, hauler: 0.2, assembler: 0.35, technician: 0.2 },
    solarFraction: 0.2,
    batteryFraction: 0.1,
    printersFraction: 0.22,
    vitaminsFraction: 0.18,
    // Chemicals are deliberately the thin bin: battery chemistry is what the
    // demo seed runs out of first — the vitamin cliff the resupply rescues.
    vitaminMix: { actuatorsBearings: 0.33, chipsPower: 0.32, sealsLubricants: 0.15, opticsSensors: 0.15, chemicals: 0.05 },
  },
  handsFirst: {
    id: 'handsFirst',
    name: 'Hands first',
    blurb: 'Maximum robots. Bet: labor is the bottleneck, print capacity can follow.',
    robotsFraction: 0.34,
    robotMix: { miner: 0.3, hauler: 0.2, assembler: 0.3, technician: 0.2 },
    solarFraction: 0.16,
    batteryFraction: 0.08,
    printersFraction: 0.16,
    vitaminsFraction: 0.16,
    vitaminMix: { actuatorsBearings: 0.34, chipsPower: 0.26, sealsLubricants: 0.14, opticsSensors: 0.14, chemicals: 0.12 },
  },
  powerFirst: {
    id: 'powerFirst',
    name: 'Power first',
    blurb: 'Solar and batteries. Bet: joules gate everything, especially through storms.',
    robotsFraction: 0.14,
    robotMix: { miner: 0.25, hauler: 0.2, assembler: 0.35, technician: 0.2 },
    solarFraction: 0.32,
    batteryFraction: 0.18,
    printersFraction: 0.16,
    vitaminsFraction: 0.12,
    vitaminMix: { actuatorsBearings: 0.3, chipsPower: 0.3, sealsLubricants: 0.13, opticsSensors: 0.14, chemicals: 0.13 },
  },
  vitaminsFirst: {
    id: 'vitaminsFirst',
    name: 'Vitamins first',
    blurb: 'Stockpile the un-printables. Bet: the cliff is what kills seeds, not joules.',
    robotsFraction: 0.15,
    robotMix: { miner: 0.25, hauler: 0.2, assembler: 0.35, technician: 0.2 },
    solarFraction: 0.17,
    batteryFraction: 0.08,
    printersFraction: 0.16,
    vitaminsFraction: 0.36,
    vitaminMix: { actuatorsBearings: 0.32, chipsPower: 0.28, sealsLubricants: 0.13, opticsSensors: 0.13, chemicals: 0.14 },
  },
};

// Landed machine masses equal their recipe-derived masses so the atoms
// ledger closes: a landed kiln weighs what a printed kiln weighs.
const KILN_PRINTER_MASS_KG = partUnitMassKg('kilnPrinter');
const MACHINING_STATION_MASS_KG = partUnitMassKg('machiningStation');

/**
 * Turn a template + payload mass into a concrete landed manifest.
 * Mass conservation: every kg of payload lands in exactly one bin; the
 * rounding remainder is dumped into feedstock so nothing evaporates.
 */
export function buildManifest(templateId: TemplateId, payloadMassT: number): LandedManifest {
  if (!Number.isFinite(payloadMassT) || payloadMassT <= 0) {
    throw new RangeError(`payloadMassT must be positive and finite, got ${payloadMassT}`);
  }
  const template = TEMPLATES[templateId];
  const totalKg = payloadMassT * 1000;
  const robotMassKg = constantValue('robotMassKg');

  // Robots: fraction → whole robots per role; leftovers return to the pool.
  const robotBudget = totalKg * template.robotsFraction;
  const robotCounts: Record<RobotTypeId, number> = { miner: 0, hauler: 0, assembler: 0, technician: 0 };
  let robotMassUsed = 0;
  for (const role of Object.keys(template.robotMix) as RobotTypeId[]) {
    const count = Math.floor((robotBudget * template.robotMix[role]) / robotMassKg);
    robotCounts[role] = count;
    robotMassUsed += count * robotMassKg;
  }

  // Machines: a seed lands a handful of flight-qualified lines, not a whole
  // factory floor — print throughput is the honest early bottleneck, and the
  // point of the game is that the seed must print the rest of its own kilns.
  // The unspent printer budget lands as feedstock (spare stock + fixtures).
  const printerBudget = totalKg * template.printersFraction;
  const kilnPrinterCount = Math.max(1, Math.min(4, Math.floor((printerBudget * (2 / 3)) / KILN_PRINTER_MASS_KG)));
  const machiningStationCount = Math.max(1, Math.min(1, Math.floor((printerBudget * (1 / 3)) / MACHINING_STATION_MASS_KG)));
  const printerMassUsed = kilnPrinterCount * KILN_PRINTER_MASS_KG + machiningStationCount * MACHINING_STATION_MASS_KG;

  const solarMassKg = totalKg * template.solarFraction;
  const batteryMassKg = totalKg * template.batteryFraction;

  const vitaminBudget = totalKg * template.vitaminsFraction;
  const vitaminsKg: Record<VitaminId, number> = {
    actuatorsBearings: vitaminBudget * template.vitaminMix.actuatorsBearings,
    chipsPower: vitaminBudget * template.vitaminMix.chipsPower,
    sealsLubricants: vitaminBudget * template.vitaminMix.sealsLubricants,
    opticsSensors: vitaminBudget * template.vitaminMix.opticsSensors,
    chemicals: vitaminBudget * template.vitaminMix.chemicals,
  };
  const vitaminMassUsed = Object.values(vitaminsKg).reduce((a, b) => a + b, 0);

  // Everything not spent above lands as pooled refined feedstock.
  const feedstockKg = totalKg - robotMassUsed - printerMassUsed - solarMassKg - batteryMassKg - vitaminMassUsed;

  return {
    robotCounts,
    solarMassKg,
    batteryMassKg,
    kilnPrinterCount,
    machiningStationCount,
    vitaminsKg,
    feedstockKg: Math.max(0, feedstockKg),
    totalMassKg: totalKg,
  };
}
