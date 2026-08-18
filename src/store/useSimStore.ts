/**
 * Zustand store: owns the live SimState, the playback clock, and the
 * scrubber. The UI only renders store data and dispatches actions; all
 * physics stays inside the pure step() function.
 */

'use client';

import { create } from 'zustand';
import type { SimState, Allocations, NewGameOptions, SolSnapshot, DoublingRecord } from '@/sim/state';
import { createInitialState } from '@/sim/state';
import { step } from '@/sim/step';
import type { SiteId, TaskId, TemplateId } from '@/sim/ids';
import type { ReelBeat } from '@/sim/reel';
import { buildReelBeats } from '@/sim/reel';
import { TEMPLATES } from '@/data/templates';
import { SITES } from '@/data/sites';

/** Playback speed presets, in simulated hours per real second. */
export const SPEED_PRESETS: readonly number[] = [2, 8, 24, 96, 240];

/** Camera focus targets for the 3D scene. 'auto' hands the camera to the director. */
export type FocusTarget = 'seed' | 'child' | 'field' | 'auto';

/** Distilled results of a finished comparison run. */
export interface CompareResult {
  /** Short human label: what differs from the baseline run. */
  readonly label: string;
  readonly options: NewGameOptions;
  /** Sol the variant was simulated to (the baseline's sol at start). */
  readonly targetSol: number;
  readonly history: readonly SolSnapshot[];
  readonly doublings: readonly DoublingRecord[];
  readonly generation: number;
  readonly firstWakeSol: number | null;
  readonly endState: SimState['endState'];
  readonly importedKgCum: number;
}

/** Comparison lifecycle. The runner component drives 'running' → 'done'. */
export type CompareStatus =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'running';
      readonly label: string;
      readonly options: NewGameOptions;
      readonly targetSol: number;
      readonly progressSol: number;
    }
  | { readonly kind: 'done'; readonly result: CompareResult };

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
  /** Mission-reel beats while a replay is running; null = no reel. */
  readonly reelBeats: readonly ReelBeat[] | null;
  /** Index of the beat currently on screen. */
  readonly reelIndex: number;
  /** True while the running reel is also being recorded to a film. */
  readonly reelRecording: boolean;
  /** Comparison run lifecycle. */
  readonly compare: CompareStatus;
  /** Monotonic id; bumped per startCompare so the runner restarts cleanly. */
  readonly compareRunId: number;
  readonly showSources: boolean;
  readonly showNewGame: boolean;
  readonly showCompare: boolean;
  /** Advance the live sim by a wall-clock frame of dtSeconds. */
  tick: (dtSeconds: number) => void;
  play: () => void;
  pause: () => void;
  setSpeedIndex: (index: number) => void;
  setScrubSol: (sol: number | null) => void;
  setFocus: (focus: FocusTarget) => void;
  setSoundOn: (on: boolean) => void;
  /** Start the mission reel (no-op when the run is too young for a story). */
  startReel: (record?: boolean) => void;
  /** Recorder feedback: cleared when recording could not start or has ended. */
  setReelRecording: (on: boolean) => void;
  /** Stop the reel and return to live playback. */
  stopReel: () => void;
  /** Advance to the next beat, or finish and return to live. */
  advanceReel: () => void;
  /** Kick off a headless comparison run of the given variant scenario. */
  startCompare: (options: NewGameOptions) => void;
  /** Progress callback from the runner (variant sol reached so far). */
  setCompareProgress: (sol: number) => void;
  /** Result callback from the runner. */
  finishCompare: (result: CompareResult) => void;
  /** Ghost-race extension: the runner keeps the finished variant pacing the live run. */
  extendCompare: (result: CompareResult) => void;
  /** Dismiss the comparison (also cancels a run in progress). */
  clearCompare: () => void;
  setAllocation: (task: TaskId, weight: number) => void;
  newGame: (options: NewGameOptions) => void;
  setShowSources: (show: boolean) => void;
  setShowNewGame: (show: boolean) => void;
  setShowCompare: (show: boolean) => void;
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
  reelBeats: null,
  reelIndex: 0,
  reelRecording: false,
  compare: { kind: 'idle' },
  compareRunId: 0,
  showSources: false,
  showNewGame: false,
  showCompare: false,

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

  play: () => set({ playing: true, scrubSol: null, reelBeats: null }),
  pause: () => set({ playing: false }),
  setSpeedIndex: (index: number) => {
    const clamped = Math.max(0, Math.min(SPEED_PRESETS.length - 1, Math.round(index)));
    set({ speedIndex: clamped });
  },
  // Manual scrubbing takes the timeline away from a running reel.
  setScrubSol: (sol: number | null) => set({ scrubSol: sol, playing: sol === null ? get().playing : false, reelBeats: null }),
  // Taking the camera cancels the reel and returns the view to live.
  setFocus: (focus: FocusTarget) =>
    get().reelBeats === null ? set({ focus }) : set({ focus, reelBeats: null, scrubSol: null, playing: true }),
  setSoundOn: (on: boolean) => set({ soundOn: on }),

  startReel: (record?: boolean) => {
    const beats = buildReelBeats(get().state);
    if (beats.length < 2) {
      return;
    }
    set({ reelBeats: beats, reelIndex: 0, reelRecording: record === true, playing: false, scrubSol: beats[0].sol });
  },
  setReelRecording: (on: boolean) => set({ reelRecording: on }),
  stopReel: () => set({ reelBeats: null, reelIndex: 0, reelRecording: false, scrubSol: null, playing: true }),
  advanceReel: () => {
    const { reelBeats, reelIndex } = get();
    if (reelBeats === null) {
      return;
    }
    const next = reelIndex + 1;
    if (next >= reelBeats.length) {
      get().stopReel();
      return;
    }
    set({ reelIndex: next, scrubSol: reelBeats[next].sol });
  },

  startCompare: (options: NewGameOptions) => {
    const state = get().state;
    // The label names only what differs from the baseline run.
    const parts: string[] = [];
    if (options.templateId !== state.templateId) {
      parts.push(TEMPLATES[options.templateId].name);
    }
    if (options.siteId !== state.siteId) {
      parts.push(SITES[options.siteId].name);
    }
    if (options.payloadMassT !== state.payloadMassT) {
      parts.push(`${options.payloadMassT} t`);
    }
    if (options.scenarioSeed !== state.scenarioSeed) {
      parts.push(`seed "${options.scenarioSeed}"`);
    }
    const label = parts.length > 0 ? parts.join(' · ') : 'Identical scenario';
    // Simulate the variant to the baseline's current sol so the curves align.
    const targetSol = Math.max(20, Math.floor(state.sol));
    set({
      compare: { kind: 'running', label, options, targetSol, progressSol: 0 },
      compareRunId: get().compareRunId + 1,
      showCompare: false,
    });
  },
  setCompareProgress: (sol: number) => {
    const current = get().compare;
    if (current.kind !== 'running') {
      return;
    }
    set({ compare: { ...current, progressSol: sol } });
  },
  finishCompare: (result: CompareResult) => {
    if (get().compare.kind !== 'running') {
      return; // cancelled while the last slice was in flight
    }
    set({ compare: { kind: 'done', result } });
  },
  extendCompare: (result: CompareResult) => {
    if (get().compare.kind !== 'done') {
      return; // dismissed while the extension slice was in flight
    }
    set({ compare: { kind: 'done', result } });
  },
  clearCompare: () => set({ compare: { kind: 'idle' } }),

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
      reelBeats: null,
      reelIndex: 0,
      // A comparison is only meaningful against the run it was started from.
      compare: { kind: 'idle' },
      showNewGame: false,
    });
  },

  setShowSources: (show: boolean) => set({ showSources: show }),
  setShowNewGame: (show: boolean) => set({ showNewGame: show }),
  setShowCompare: (show: boolean) => set({ showCompare: show }),
}));

/** Convenience: options list for the new-game dialog. */
export const SITE_OPTIONS: readonly SiteId[] = ['mars', 'earth'];
export const TEMPLATE_OPTIONS: readonly TemplateId[] = ['balanced', 'handsFirst', 'powerFirst', 'vitaminsFirst'];
