/**
 * Branded unit types for the SEED simulator.
 *
 * TypeScript structural typing would happily let you add kilograms to
 * kilowatt-hours. Branding each scalar with a phantom tag makes that a
 * compile error. All arithmetic on branded units goes through the helpers
 * below so the units stay honest.
 */

/** Phantom-brand helper: a number that carries a unit tag at compile time. */
export type Branded<Tag extends string> = number & { readonly __unit: Tag };

/** Mass in kilograms. */
export type MassKg = Branded<'MassKg'>;
/** Energy in kilowatt-hours. */
export type EnergyKwh = Branded<'EnergyKwh'>;
/** Power in kilowatts (electric). */
export type PowerKwe = Branded<'PowerKwe'>;
/** Robot labor in robot-hours. */
export type RobotHours = Branded<'RobotHours'>;
/** Time in sols (Mars) or days (Earth) — one planetary rotation of the site. */
export type Sol = Branded<'Sol'>;
/** Time in hours. */
export type Hours = Branded<'Hours'>;
/** Replication generation index (0 = the landed seed). */
export type GenerationIndex = Branded<'GenerationIndex'>;
/** Dimensionless fraction, expected within [0, 1]. */
export type Fraction = Branded<'Fraction'>;

/** Construct a MassKg. Throws on non-finite input. */
export function kg(value: number): MassKg {
  assertFinite(value, 'MassKg');
  return value as MassKg;
}

/** Construct an EnergyKwh. Throws on non-finite input. */
export function kwh(value: number): EnergyKwh {
  assertFinite(value, 'EnergyKwh');
  return value as EnergyKwh;
}

/** Construct a PowerKwe. Throws on non-finite input. */
export function kwe(value: number): PowerKwe {
  assertFinite(value, 'PowerKwe');
  return value as PowerKwe;
}

/** Construct RobotHours. Throws on non-finite input. */
export function rh(value: number): RobotHours {
  assertFinite(value, 'RobotHours');
  return value as RobotHours;
}

/** Construct a Sol. Throws on non-finite input. */
export function sol(value: number): Sol {
  assertFinite(value, 'Sol');
  return value as Sol;
}

/** Construct Hours. Throws on non-finite input. */
export function hours(value: number): Hours {
  assertFinite(value, 'Hours');
  return value as Hours;
}

/** Construct a GenerationIndex. Throws on negative or non-integer input. */
export function gen(value: number): GenerationIndex {
  assertFinite(value, 'GenerationIndex');
  if (value < 0 || !Number.isInteger(value)) {
    throw new RangeError(`GenerationIndex must be a non-negative integer, got ${value}`);
  }
  return value as GenerationIndex;
}

/** Construct a Fraction, clamped into [0, 1]. */
export function frac(value: number): Fraction {
  assertFinite(value, 'Fraction');
  return Math.min(1, Math.max(0, value)) as Fraction;
}

/** Add two quantities of the same unit. */
export function add<T extends Branded<string>>(a: T, b: T): T {
  return (a + b) as T;
}

/** Subtract b from a (same unit). */
export function sub<T extends Branded<string>>(a: T, b: T): T {
  return (a - b) as T;
}

/** Scale a branded quantity by a dimensionless factor. */
export function scale<T extends Branded<string>>(a: T, factor: number): T {
  assertFinite(factor, 'scale factor');
  return (a * factor) as T;
}

/** Clamp a branded quantity to be at least zero (rounding guard). */
export function clampNonNegative<T extends Branded<string>>(a: T): T {
  return (a < 0 ? 0 : a) as T;
}

/** Power sustained over a duration yields energy: kWe × h = kWh. */
export function powerOverHours(power: PowerKwe, duration: Hours): EnergyKwh {
  return kwh(power * duration);
}

/** Energy delivered over a duration implies average power: kWh / h = kWe. Guards divide-by-zero. */
export function energyToPower(energy: EnergyKwh, duration: Hours): PowerKwe {
  if (duration <= 0) {
    return kwe(0);
  }
  return kwe(energy / duration);
}

/** Convert hours to sols given the site's sol length in hours. Guards divide-by-zero. */
export function hoursToSols(h: Hours, solLengthHours: Hours): Sol {
  if (solLengthHours <= 0) {
    return sol(0);
  }
  return sol(h / solLengthHours);
}

/** Convert sols to hours given the site's sol length in hours. */
export function solsToHours(s: Sol, solLengthHours: Hours): Hours {
  return hours(s * solLengthHours);
}

/** Safe ratio of two same-unit quantities (dimensionless). Returns fallback when the denominator is ~0. */
export function ratio<T extends Branded<string>>(numerator: T, denominator: T, fallback: number): number {
  if (Math.abs(denominator) < 1e-12) {
    return fallback;
  }
  return numerator / denominator;
}

/** Internal guard: reject NaN/Infinity at unit construction time. */
function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite, got ${value}`);
  }
}
