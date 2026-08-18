/**
 * Site definitions: one Earth factory lot, one Mars icy plain.
 *
 * No live APIs. The irradiance / dust optical-depth series are baked
 * deterministic arrays (one value per sol) generated from documented
 * formulas at module load, so every run of the same scenario sees the
 * same weather.
 */

import type { SiteId } from '@/sim/ids';
import { constantValue } from '@/sim/constants';

/** Everything site-specific the simulator needs. */
export interface SiteDefinition {
  readonly id: SiteId;
  readonly name: string;
  readonly blurb: string;
  /** Length of one local day/sol in hours. */
  readonly solLengthHours: number;
  /** Top-of-atmosphere irradiance, W/m². */
  readonly solarConstantWm2: number;
  /** Fraction of a sol with usable daylight (flat-plate, no tracking). */
  readonly daylightFraction: number;
  /** Haul distance from mine face to pad, km. */
  readonly haulDistanceKm: number;
  /** True if feedstock is raw regolith needing beneficiation (vs. delivered ore). */
  readonly regolithFeedstock: boolean;
  /** Perchlorate / contamination yield penalty until washing runs (0 on Earth). */
  readonly contaminationPenalty: number;
  /** kg of water recoverable per kg of icy feedstock mined. */
  readonly iceMassFractionOfFeed: number;
  /** Resupply model. */
  readonly resupply:
    | { readonly kind: 'lead-time'; readonly leadDays: number }
    | { readonly kind: 'synodic'; readonly periodSols: number; readonly firstWindowSol: number };
  /**
   * Per-sol atmospheric optical depth series (index = sol number, wraps).
   * Drives solar output: transmission ≈ exp(-tau × airmass-ish factor).
   */
  readonly opticalDepthBySol: readonly number[];
  /** Ambient temperature swing severity 0–1: drives night keep-alive load scaling. */
  readonly thermalSeverity: number;
}

/** Series length: two local years' worth of sols, enough for long runs to wrap sensibly. */
const SERIES_LENGTH_SOLS = 1400;

/**
 * Build the Mars optical-depth series: quiet background with a seasonal
 * ripple and one regional-going-global storm centred on sol 210 for the
 * demo beat. Values follow Lemmon et al. 2015 ranges (see constants.ts).
 */
function buildMarsTauSeries(): number[] {
  const quiet = constantValue('quietYearOpticalDepth');
  const peak = constantValue('dustStormOpticalDepthPeak');
  const series: number[] = [];
  for (let s = 0; s < SERIES_LENGTH_SOLS; s += 1) {
    // Seasonal ripple: dust season raises background tau ~±0.15 over the Mars year (669 sols).
    const seasonal = quiet + 0.15 * Math.sin((2 * Math.PI * s) / 669);
    // Demo storm: rises over ~15 sols, holds ~25 sols, decays over ~40 sols, centred near sol 210.
    const stormStart = 195;
    const stormHold = 25;
    const rise = 15;
    const decay = 40;
    let storm = 0;
    if (s >= stormStart && s < stormStart + rise) {
      storm = ((s - stormStart) / rise) * (peak - seasonal);
    } else if (s >= stormStart + rise && s < stormStart + rise + stormHold) {
      storm = peak - seasonal;
    } else if (s >= stormStart + rise + stormHold && s < stormStart + rise + stormHold + decay) {
      storm = (1 - (s - stormStart - rise - stormHold) / decay) * (peak - seasonal);
    }
    series.push(Math.max(0.1, seasonal + storm));
  }
  return series;
}

/**
 * Build the Earth cloud "optical depth" series: a weekly-ish weather cycle
 * with a few multi-day overcast runs. Tau here is an effective attenuation
 * proxy so both sites share one solar model.
 */
function buildEarthTauSeries(): number[] {
  const series: number[] = [];
  for (let d = 0; d < SERIES_LENGTH_SOLS; d += 1) {
    // Clear-sky baseline tau ~0.25 (Rayleigh + aerosol), storms push toward ~2.
    const weekly = 0.25 + 0.2 * Math.max(0, Math.sin((2 * Math.PI * d) / 7 + 1.3));
    // Deterministic pseudo-storms every ~19 days lasting 3 days.
    const stormPhase = d % 19;
    const storm = stormPhase < 3 ? 1.4 : 0;
    series.push(weekly + storm);
  }
  return series;
}

/** The two baked sites. */
export const SITES: Record<SiteId, SiteDefinition> = {
  earth: {
    id: 'earth',
    name: 'Earth — high-desert factory lot',
    blurb: 'Grid-adjacent gravel lot. Trucked ore, air cooling, 24 h logistics. Doubling should look easier here — and still be hard.',
    solLengthHours: constantValue('earthDayLengthHours'),
    solarConstantWm2: constantValue('earthSolarConstantWm2'),
    daylightFraction: 0.5,
    haulDistanceKm: 40, // ore truck haul from railhead — ASSUMED
    regolithFeedstock: false,
    contaminationPenalty: 0,
    iceMassFractionOfFeed: 1, // water is a hose, not a mine
    resupply: { kind: 'lead-time', leadDays: constantValue('earthResupplyLeadDays') },
    opticalDepthBySol: buildEarthTauSeries(),
    thermalSeverity: 0.3,
  },
  mars: {
    id: 'mars',
    name: 'Mars — Arcadia icy plain',
    blurb: 'Shallow subsurface ice, ochre sky, 6 mbar. Every joule is fought for; every chip rode a rocket. The heartbeat is the 26-month window.',
    solLengthHours: constantValue('marsSolLengthHours'),
    solarConstantWm2: constantValue('marsSolarConstantWm2'),
    daylightFraction: 0.5,
    haulDistanceKm: 3, // pad-to-ice-face rover haul — ASSUMED
    regolithFeedstock: true,
    contaminationPenalty: constantValue('perchloratePenaltyFraction'),
    iceMassFractionOfFeed: 0.3, // icy regolith water fraction — Arcadia SWIM estimates, ASSUMED mid
    resupply: {
      kind: 'synodic',
      // 780 Earth days ≈ 760 sols (1 sol = 1.0275 days).
      periodSols: Math.round(constantValue('synodicPeriodDays') / 1.0275),
      firstWindowSol: 320, // first resupply arrival after landing — demo beat
    },
    opticalDepthBySol: buildMarsTauSeries(),
    thermalSeverity: 1,
  },
};

/**
 * Effective solar transmission for a given sol. Beer–Lambert with an
 * effective airmass factor of 0.5 for a fixed flat panel averaged over the
 * day (ASSUMED simplification; tracking would beat it).
 */
export function solarTransmission(site: SiteDefinition, solIndex: number): number {
  const idx = ((Math.floor(solIndex) % site.opticalDepthBySol.length) + site.opticalDepthBySol.length) % site.opticalDepthBySol.length;
  const tau = site.opticalDepthBySol[idx];
  return Math.exp(-tau * 0.5);
}
