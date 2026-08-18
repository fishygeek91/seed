/**
 * Zustand store: owns the live SimState, the playback clock, and the
 * scrubber. The UI only renders store data and dispatches actions; all
 * physics stays inside the pure step() function.
 */

'use client';

import { create } from 'zustand';
import type { SimState, Allocations, NewGameOptions } from '@/sim/state';
import { createInitialState } from '@/sim/state';
import { step } from '@/sim/step';
import type { SiteId, TaskId, TemplateId } from '@/sim/ids';

/** Playback speed presets, in simulated hours per real second. */
export const SPEED_PRESETS: readonly number[] = [2, 8, 24, 96, 240];

/** Camera focus targets for the 3D scene. 'auto' hands the camera to the director. */
export type FocusTarget = 'seed' | 'child' | 'field' | 'auto';

/** The full UI-facing store shape. */
interface SimStore {
  readonly state: SimState;
  readonly playing: boolean;
  readonly speedIndex: number;
  /** Scrubber position: null = live; a sol number = viewing history. */
  readonly scrubSol: number | null;
  readonly focus: FocusTarget;
  /** Ambient audio feed on/off. Off by default; enabling requires a click (browser autoplay policy). */
  readonly soundOn: boolean;
  readonly showSources: boolean;
  readonly showNewGame: boolean;
  /** Advance the live sim by a wall-clock frame of dtSeconds. */
  tick: (dtSeconds: number) => void;
  play: () => void;
  pause: () => void;
  setSpeedIndex: (index: number) => void;
  setScrubSol: (sol: number | null) => void;
  setFocus: (focus: FocusTarget) => void;
  setSoundOn: (on: boolean) => void;
  setAllocation: (task: TaskId, weight: number) => void;
  newGame: (options: NewGameOptions) => void;
  setShowSources: (show: boolean) => void;
  setShowNewGame: (show: boolean) => void;
}

/** Default demo scenario: Mars, balanced seed, 100 t, fixed seed string so the demo plays itself. */
export function defaultNewGameOptions(): NewGameOptions {
  return {
    siteId: 'mars',
    templateId: 'balanced',
    payloadMassT: 100,
    scenarioSeed: 'demo-arcadia-01',
  };
}

/** Max simulated hours consumed per animation frame, to keep the UI responsive. */
const MAX_HOURS_PER_FRAME = 20;
/** Internal physics tick, hours. Smaller = smoother night/day; larger = faster. */
const TICK_HOURS = 1;

export const useSimStore = create<SimStore>((set, get) => ({
  state: createInitialState(defaultNewGameOptions()),
  playing: true,
  speedIndex: 2,
  scrubSol: null,
  focus: 'seed',
  soundOn: false,
  showSources: false,
  showNewGame: false,

  tick: (dtSeconds: number) => {
    const { playing, speedIndex, state, scrubSol } = get();
    if (!playing || scrubSol !== null || !Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return;
    }
    const wantHours = Math.min(MAX_HOURS_PER_FRAME, SPEED_PRESETS[speedIndex] * dtSeconds);
    let next = state;
    let advanced = 0;
    while (advanced < wantHours) {
      const dt = Math.min(TICK_HOURS, wantHours - advanced);
      next = step(next, dt);
      advanced += dt;
    }
    set({ state: next });
  },

  play: () => set({ playing: true, scrubSol: null }),
  pause: () => set({ playing: false }),
  setSpeedIndex: (index: number) => {
    const clamped = Math.max(0, Math.min(SPEED_PRESETS.length - 1, Math.round(index)));
    set({ speedIndex: clamped });
  },
  setScrubSol: (sol: number | null) => set({ scrubSol: sol, playing: sol === null ? get().playing : false }),
  setFocus: (focus: FocusTarget) => set({ focus }),
  setSoundOn: (on: boolean) => set({ soundOn: on }),

  setAllocation: (task: TaskId, weight: number) => {
    const safe = Number.isFinite(weight) ? Math.max(0, Math.min(100, weight)) : 0;
    const current = get().state;
    const allocations: Allocations = { ...current.allocations, [task]: safe };
    // Allocations live inside SimState so the pure step() sees them; this is
    // the one place the UI writes into state, and it writes config only.
    set({ state: { ...current, allocations } });
  },

  newGame: (options: NewGameOptions) => {
    set({
      state: createInitialState(options),
      playing: true,
      scrubSol: null,
      focus: 'seed',
      showNewGame: false,
    });
  },

  setShowSources: (show: boolean) => set({ showSources: show }),
  setShowNewGame: (show: boolean) => set({ showNewGame: show }),
}));

/** Convenience: options list for the new-game dialog. */
export const SITE_OPTIONS: readonly SiteId[] = ['mars', 'earth'];
export const TEMPLATE_OPTIONS: readonly TemplateId[] = ['balanced', 'handsFirst', 'powerFirst', 'vitaminsFirst'];
