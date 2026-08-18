/**
 * Audited default constants for the SEED simulator.
 *
 * Every constant carries a `source` string: either a citation (paper,
 * handbook, public spec) or the literal prefix 'ASSUMED:' with a reason.
 * The in-app "Sources & assumptions" drawer renders this table directly,
 * and hover tooltips reference entries by key. If you change a number,
 * change its source line too.
 */

/** A single audited constant: value, human-readable unit, and provenance. */
export interface AuditedConstant {
  readonly value: number;
  readonly unit: string;
  readonly label: string;
  readonly source: string;
  /** Optional slider bounds for user-adjustable assumptions. */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

/** Keys for all audited constants. Adding a key here forces a table entry. */
export type ConstantKey =
  | 'payloadMassT'
  | 'solarSpecificPowerKwPerKg'
  | 'batterySpecificEnergyKwhPerKg'
  | 'robotMassKg'
  | 'robotPowerDrawKwe'
  | 'robotMeanUptimeFraction'
  | 'robotWeibullShape'
  | 'robotWeibullScaleHours'
  | 'sinterEnergyKwhPerKg'
  | 'meltRecycleEnergyKwhPerKg'
  | 'iceExtractionEnergyKwhPerKg'
  | 'regolithMiningEnergyKwhPerKg'
  | 'oreBeneficiationYield'
  | 'perchloratePenaltyFraction'
  | 'machiningEnergyKwhPerKg'
  | 'haulEnergyKwhPerKgKm'
  | 'marsSolarConstantWm2'
  | 'earthSolarConstantWm2'
  | 'marsSolLengthHours'
  | 'earthDayLengthHours'
  | 'synodicPeriodDays'
  | 'earthResupplyLeadDays'
  | 'dustStormOpticalDepthPeak'
  | 'quietYearOpticalDepth'
  | 'nightSurvivalPowerKwePerSeed'
  | 'qaHoursBaselinePerPart'
  | 'childWakeBatteryFraction'
  | 'printerThroughputKgPerHour';

/** The audited constants table. One place, one truth. */
export const CONSTANTS: Record<ConstantKey, AuditedConstant> = {
  payloadMassT: {
    value: 100,
    unit: 't',
    label: 'Landed seed payload mass',
    source: 'SpaceX Starship payload user guide (2020): 100+ t to Mars surface class. Slider because real landed mass is unproven.',
    min: 40,
    max: 200,
    step: 5,
  },
  solarSpecificPowerKwPerKg: {
    value: 0.1,
    unit: 'kW/kg',
    label: 'Solar array specific power (deployed, incl. structure)',
    source: 'ASSUMED: ROSA-class flexible arrays reach ~0.1 kW/kg at 1 AU incl. deployment mass (NASA ROSA flight data ~0.12 kW/kg blanket-only). Conservative for ground deploy.',
    min: 0.02,
    max: 0.3,
    step: 0.01,
  },
  batterySpecificEnergyKwhPerKg: {
    value: 0.2,
    unit: 'kWh/kg',
    label: 'Battery pack specific energy',
    source: 'Li-ion pack level ~200 Wh/kg (BloombergNEF pack survey 2023). Cell-level is higher; pack overhead eats it.',
    min: 0.1,
    max: 0.4,
    step: 0.01,
  },
  robotMassKg: {
    value: 75,
    unit: 'kg',
    label: 'Worker robot mass (Optimus-class humanoid / small wheeled)',
    source: 'Tesla Optimus public spec claims ~73 kg (AI Day 2022). Rounded to 75.',
    min: 40,
    max: 200,
    step: 5,
  },
  robotPowerDrawKwe: {
    value: 0.5,
    unit: 'kWe',
    label: 'Robot average working power draw',
    source: 'ASSUMED: 500 W sustained average for a 75 kg worker doing mixed mine/assembly labor. Optimus claim ~0.5 kW working average.',
    min: 0.1,
    max: 2,
    step: 0.05,
  },
  robotMeanUptimeFraction: {
    value: 0.7,
    unit: 'fraction',
    label: 'Robot mean uptime (duty cycle after charge + maintenance)',
    source: 'ASSUMED: 70% duty cycle — industrial robot arms hit >90% but they are bolted down; mobile dusty robots will not.',
    min: 0.3,
    max: 0.95,
    step: 0.05,
  },
  robotWeibullShape: {
    value: 2.0,
    unit: 'dimensionless',
    label: 'Robot failure Weibull shape (k)',
    source: 'ASSUMED: k=2 (wear-out dominated, hazard rises linearly with age) — standard choice for mechanical wear per reliability handbooks (e.g. O\u2019Connor, Practical Reliability Engineering).',
    min: 0.8,
    max: 4,
    step: 0.1,
  },
  robotWeibullScaleHours: {
    value: 8000,
    unit: 'h',
    label: 'Robot failure Weibull scale (λ, characteristic life)',
    source: 'ASSUMED: ~8,000 operating hours (≈1.7 Mars years at a 13 h/sol duty) to characteristic failure without overhaul. Industrial arms exceed 50,000 h in clean factories; dust and thermal cycling cut that hard.',
    min: 500,
    max: 20000,
    step: 100,
  },
  sinterEnergyKwhPerKg: {
    value: 2.5,
    unit: 'kWh/kg',
    label: 'Sinter / powder-print energy per finished kg',
    source: 'Laser powder-bed fusion of steel measured 1.5–4 kWh/kg (Baumers et al. 2011, Energy inputs to additive manufacturing). Midpoint 2.5.',
    min: 0.5,
    max: 8,
    step: 0.1,
  },
  meltRecycleEnergyKwhPerKg: {
    value: 1.2,
    unit: 'kWh/kg',
    label: 'Scrap remelt energy per kg',
    source: 'Electric arc furnace steel remelt ~0.4–0.6 kWh/kg at industrial scale (IEA steel roadmap); small crucible scale is worse. ASSUMED 1.2 at seed scale.',
    min: 0.4,
    max: 4,
    step: 0.1,
  },
  iceExtractionEnergyKwhPerKg: {
    value: 1.0,
    unit: 'kWh/kg',
    label: 'Water-ice extraction energy per kg (Mars)',
    source: 'Sublimation + capture from icy regolith estimated 0.7–1.5 kWh/kg water (Hoffman et al., NASA ISRU Mars Water studies 2016–2019). Midpoint 1.0.',
    min: 0.3,
    max: 3,
    step: 0.1,
  },
  regolithMiningEnergyKwhPerKg: {
    value: 0.05,
    unit: 'kWh/kg',
    label: 'Regolith excavation + primary crush energy per kg',
    source: 'Terrestrial surface mining ~0.01–0.03 kWh/kg ore (SME Mining Engineering Handbook); small-scale electric excavation penalty applied. ASSUMED 0.05.',
    min: 0.01,
    max: 0.3,
    step: 0.01,
  },
  oreBeneficiationYield: {
    value: 0.35,
    unit: 'fraction',
    label: 'Refined output mass per raw regolith mass (all elements pooled)',
    source: 'ASSUMED: 35% of hauled regolith becomes usable refined element mass after beneficiation + reduction; Mars regolith is ~18% FeOx, ~10% Al2O3, ~45% SiO2 by oxide weight (Curiosity APXS data), but reduction losses are brutal.',
    min: 0.05,
    max: 0.7,
    step: 0.05,
  },
  perchloratePenaltyFraction: {
    value: 0.15,
    unit: 'fraction',
    label: 'Mars feedstock yield penalty until perchlorate wash-out is running',
    source: 'Phoenix lander measured ~0.5 wt% perchlorate in Mars soil (Hecht et al. 2009, Science). Penalty is ASSUMED: dirty feedstock poisons sinter batches.',
    min: 0,
    max: 0.5,
    step: 0.05,
  },
  machiningEnergyKwhPerKg: {
    value: 0.8,
    unit: 'kWh/kg',
    label: 'Post-print machining / finishing energy per kg',
    source: 'CNC finishing energy 0.3–1.5 kWh/kg depending on tolerance (Gutowski et al. 2006, electrical energy requirements of manufacturing). Midpoint-ish 0.8.',
    min: 0.1,
    max: 3,
    step: 0.1,
  },
  haulEnergyKwhPerKgKm: {
    value: 0.001,
    unit: 'kWh/(kg·km)',
    label: 'Haul energy per kg per km (electric rover / truck)',
    source: 'Electric truck ~1 kWh/(t·km) loaded (NACFE Run on Less Electric 2021) = 0.001 kWh/(kg·km). Mars rover on soft regolith is worse; kept as lower bound.',
    min: 0.0005,
    max: 0.01,
    step: 0.0005,
  },
  marsSolarConstantWm2: {
    value: 590,
    unit: 'W/m²',
    label: 'Mars top-of-atmosphere mean solar irradiance',
    source: 'Mars mean solar constant ≈ 590 W/m² (Appelbaum & Flood 1990, NASA TM-102299, Solar radiation on Mars).',
  },
  earthSolarConstantWm2: {
    value: 1361,
    unit: 'W/m²',
    label: 'Earth top-of-atmosphere solar irradiance',
    source: 'Total solar irradiance 1361 W/m² (Kopp & Lean 2011, GRL).',
  },
  marsSolLengthHours: {
    value: 24.66,
    unit: 'h',
    label: 'Mars sol length',
    source: 'Mars sidereal day 24 h 39 m 35 s ≈ 24.66 h (NASA Mars fact sheet).',
  },
  earthDayLengthHours: {
    value: 24,
    unit: 'h',
    label: 'Earth day length',
    source: 'Definitional.',
  },
  synodicPeriodDays: {
    value: 780,
    unit: 'days',
    label: 'Earth–Mars synodic period (resupply window spacing)',
    source: 'Earth–Mars synodic period ≈ 779.9 days ≈ 26 months (orbital mechanics, NASA trajectory browser).',
  },
  earthResupplyLeadDays: {
    value: 14,
    unit: 'days',
    label: 'Earth-mode vitamin resupply lead time',
    source: 'ASSUMED: two weeks from purchase order to loading dock for precision components at industrial quantity.',
    min: 2,
    max: 90,
    step: 1,
  },
  dustStormOpticalDepthPeak: {
    value: 5.0,
    unit: 'tau',
    label: 'Global dust storm peak optical depth',
    source: 'Opportunity rover measured tau > 10 in the 2018 global storm; regional storms tau 2–5 (Lemmon et al. 2015, Icarus). 5.0 used for the demo storm.',
    min: 1,
    max: 10,
    step: 0.5,
  },
  quietYearOpticalDepth: {
    value: 0.5,
    unit: 'tau',
    label: 'Quiet-year background optical depth',
    source: 'Background tau ≈ 0.3–0.7 at Meridiani/Gale outside storm season (Lemmon et al. 2015, Icarus).',
  },
  nightSurvivalPowerKwePerSeed: {
    value: 3.0,
    unit: 'kWe',
    label: 'Night survival load per seed (thermal + avionics + comms)',
    source: 'ASSUMED: 3 kWe keep-alive for a 100 t industrial seed; MSL rover keep-alive ~0.1 kWe, scaled up for tanks, electronics bays, and kiln freeze protection.',
    min: 0.5,
    max: 10,
    step: 0.5,
  },
  qaHoursBaselinePerPart: {
    value: 0.5,
    unit: 'robot-h',
    label: 'Baseline QA robot-hours per part',
    source: 'ASSUMED: 30 min average inspection + functional test per part class; precision parts override this in their recipes.',
    min: 0.1,
    max: 4,
    step: 0.1,
  },
  childWakeBatteryFraction: {
    value: 0.8,
    unit: 'fraction',
    label: 'Child battery state-of-charge required to wake',
    source: 'ASSUMED: a child must wake with ≥80% charge to survive its first night alone.',
    min: 0.3,
    max: 1,
    step: 0.05,
  },
  printerThroughputKgPerHour: {
    value: 1.5,
    unit: 'kg/h',
    label: 'Kiln/printer finished-mass throughput per machine',
    source: 'ASSUMED: 1.5 kg/h finished output per kiln-printer line — an order above today\u2019s single LPBF machines (~0.1 kg/h) because a seed line is sinter + cast + roll, not just laser powder bed.',
    min: 0.2,
    max: 10,
    step: 0.2,
  },
};

/** Convenience accessor: raw numeric value of an audited constant. */
export function constantValue(key: ConstantKey): number {
  return CONSTANTS[key].value;
}
