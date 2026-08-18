/**
 * Deterministic PRNG for the simulator.
 *
 * mulberry32: tiny, fast, good-enough statistical quality for failure rolls.
 * The generator state is a single uint32 carried inside SimState, so
 * step(state) is pure: same seed + same inputs => same history, always.
 */

/** Advance a mulberry32 state once. Returns the next state and a float in [0, 1). */
export function nextRandom(state: number): { readonly nextState: number; readonly value: number } {
  // Force uint32 arithmetic; JS bitwise ops already truncate to 32 bits.
  const a = (state + 0x6d2b79f5) | 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { nextState: a >>> 0, value };
}

/** Hash a string scenario seed into a uint32 PRNG seed (FNV-1a). */
export function seedFromString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
