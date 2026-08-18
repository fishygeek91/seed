/**
 * Procedural audio: the factory heard through its own telemetry feed.
 *
 * Nothing is fetched — every sound is synthesized in the WebAudio graph, in
 * keeping with the app's no-assets, no-network rule. Four continuous layers
 * track the sim each frame:
 *
 *   wind    — looping noise through a bandpass; gain and brightness follow
 *             dust-storm intensity, so a global storm is heard as a gale.
 *   rumble  — the same noise through a low shelf; only wakes in heavy storms.
 *   hum     — two detuned sawtooth drones behind a lowpass, keyed to how many
 *             robots are working and whether the kiln line is drawing power.
 *             This is the sound of the factory being alive.
 *   jet     — a rising bandpassed roar keyed to resupply descent progress, so
 *             a lander on final approach is heard before it is seen.
 *
 * On top of the bed, one-shot stingers mark sim events (child wake, capacity
 * doubling, touchdown, storm onset, failures). Every stinger is rate-limited
 * per event kind so fast playback speeds cannot turn the feed into noise.
 */

import type { SimEvent } from '@/sim/state';

/** Continuous ambient inputs, sampled once per animation frame. */
export interface AmbientFrame {
  /** 0 quiet — 1 full global dust storm. */
  readonly stormIntensity: number;
  /** 0–1 proxy for how hard the factory is working (robots on task). */
  readonly machineLoad: number;
  /** True when the kiln / print yard is drawing power. */
  readonly kilnActive: boolean;
  /** Night dims the hum slightly: survival loads only. */
  readonly isNight: boolean;
  /** Resupply descent progress 0–1 while a lander is on final approach, else null. */
  readonly resupplyDescent: number | null;
}

/** Minimum seconds between two stingers of the same event kind. Kinds absent here are silent. */
const STINGER_GAP_S: Partial<Record<SimEvent['kind'], number>> = {
  landing: 2,
  'solar-deployed': 2,
  'first-print': 2,
  'chassis-started': 2,
  'storm-start': 6,
  'storm-end': 6,
  resupply: 2,
  'window-missed': 4,
  'child-wake': 2,
  doubling: 1.5,
  localized: 1.5,
  'robot-failure': 4,
  'energy-crisis': 5,
  'vitamin-stall': 5,
};

/** Master output level; individual layers and stingers stay well under it. */
const MASTER_LEVEL = 0.9;

/**
 * The one audio engine. Constructed statelessly (safe to import anywhere);
 * the WebAudio graph is only built inside unlock(), which must be called from
 * a user gesture so the browser lets the context start.
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private rumbleGain: GainNode | null = null;
  private humGain: GainNode | null = null;
  private jetGain: GainNode | null = null;
  private jetFilter: BiquadFilterNode | null = null;
  private enabled = false;
  private suspendTimer: number | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private readonly lastStingerAt = new Map<SimEvent['kind'], number>();

  /** Build the context and graph if needed, and resume it. Call from a click handler. */
  unlock(): void {
    if (typeof window === 'undefined') {
      return;
    }
    if (this.ctx === null) {
      this.buildGraph();
    }
    if (this.ctx !== null && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  /** Fade the whole feed in or out; suspends the context when off to save CPU. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null) {
      return;
    }
    if (this.suspendTimer !== null) {
      window.clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
    if (on) {
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      master.gain.setTargetAtTime(MASTER_LEVEL, ctx.currentTime, 0.25);
    } else {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
      // Give the fade time to finish before halting the graph.
      this.suspendTimer = window.setTimeout(() => {
        void ctx.suspend();
        this.suspendTimer = null;
      }, 500);
    }
  }

  /** Steer the continuous layers toward this frame's sim conditions. */
  update(frame: AmbientFrame): void {
    const ctx = this.ctx;
    if (!this.enabled || ctx === null) {
      return;
    }
    const t = ctx.currentTime;
    const storm = frame.stormIntensity;
    if (this.windGain !== null && this.windFilter !== null) {
      // Baseline breeze always present; a storm raises both level and pitch.
      this.windGain.gain.setTargetAtTime(0.018 + storm * 0.17, t, 0.4);
      this.windFilter.frequency.setTargetAtTime(280 + storm * 750, t, 0.4);
    }
    if (this.rumbleGain !== null) {
      // Quadratic so the rumble only wakes for serious storms.
      this.rumbleGain.gain.setTargetAtTime(storm * storm * 0.24, t, 0.6);
    }
    if (this.humGain !== null) {
      const level = (frame.kilnActive ? 0.028 : 0) + frame.machineLoad * 0.03;
      this.humGain.gain.setTargetAtTime(frame.isNight ? level * 0.6 : level, t, 0.5);
    }
    if (this.jetGain !== null && this.jetFilter !== null) {
      if (frame.resupplyDescent !== null) {
        const p = frame.resupplyDescent;
        this.jetGain.gain.setTargetAtTime(Math.pow(p, 1.4) * 0.15, t, 0.3);
        this.jetFilter.frequency.setTargetAtTime(500 + p * 1100, t, 0.3);
      } else {
        // Cut fast after touchdown; the thud stinger takes over.
        this.jetGain.gain.setTargetAtTime(0, t, 0.15);
      }
    }
  }

  /**
   * A MediaStream carrying the master bus, for muxing into film recordings.
   * Null until the engine has been unlocked (no context = nothing to tap).
   */
  recordingStream(): MediaStream | null {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null) {
      return null;
    }
    if (this.recordDest === null) {
      this.recordDest = ctx.createMediaStreamDestination();
      master.connect(this.recordDest);
    }
    return this.recordDest.stream;
  }

  /** Play the stinger for a sim event, rate-limited per kind. */
  playEvent(kind: SimEvent['kind']): void {
    const ctx = this.ctx;
    if (!this.enabled || ctx === null) {
      return;
    }
    const gap = STINGER_GAP_S[kind];
    if (gap === undefined) {
      return;
    }
    const now = ctx.currentTime;
    const last = this.lastStingerAt.get(kind);
    if (last !== undefined && now - last < gap) {
      return;
    }
    this.lastStingerAt.set(kind, now);
    switch (kind) {
      case 'landing':
        // Arrival: one low, calm strike.
        this.tone({ freq: 196, delay: 0, duration: 1.6, peak: 0.08, type: 'sine' });
        break;
      case 'solar-deployed':
      case 'first-print':
        this.tone({ freq: 659.25, delay: 0, duration: 0.7, peak: 0.05, type: 'triangle' });
        break;
      case 'chassis-started':
        this.tone({ freq: 440, delay: 0, duration: 0.7, peak: 0.05, type: 'triangle' });
        break;
      case 'storm-start':
        // A slow sub-bass swell: the sky closing in.
        this.tone({ freq: 36, delay: 0, duration: 3.2, peak: 0.2, type: 'sine', attack: 1.2 });
        break;
      case 'storm-end':
        // The sky clears on one high, thin note.
        this.tone({ freq: 987.77, delay: 0, duration: 1.4, peak: 0.045, type: 'sine' });
        break;
      case 'resupply':
        // Touchdown: a 44 Hz thud plus a dust-blast noise burst.
        this.tone({ freq: 44, delay: 0, duration: 0.8, peak: 0.32, type: 'sine' });
        this.burst({ duration: 0.5, filterFreq: 180, peak: 0.2 });
        break;
      case 'child-wake': {
        // The headline event: an ascending phosphor chime (G4 C5 E5 G5).
        const notes = [392, 523.25, 659.25, 783.99];
        notes.forEach((freq, i) => {
          this.tone({ freq, delay: i * 0.14, duration: 1.2, peak: 0.085, type: 'sine' });
        });
        break;
      }
      case 'doubling':
        // Capacity doubled: a confident two-note ping, one octave apart.
        this.tone({ freq: 523.25, delay: 0, duration: 0.8, peak: 0.06, type: 'triangle' });
        this.tone({ freq: 1046.5, delay: 0.11, duration: 0.9, peak: 0.05, type: 'triangle' });
        break;
      case 'localized':
        // A vitamin dependency severed: bright and brief.
        this.tone({ freq: 1318.5, delay: 0, duration: 0.6, peak: 0.045, type: 'sine' });
        break;
      case 'robot-failure':
        // A small servo dying: a quiet downward chirp.
        this.tone({ freq: 620, delay: 0, duration: 0.16, peak: 0.035, type: 'triangle', glideTo: 170 });
        break;
      case 'window-missed':
      case 'energy-crisis':
      case 'vitamin-stall':
        // Alarm: a descending minor pair, deliberately unpleasant but quiet.
        this.tone({ freq: 311.13, delay: 0, duration: 0.35, peak: 0.05, type: 'square' });
        this.tone({ freq: 233.08, delay: 0.22, duration: 0.5, peak: 0.05, type: 'square' });
        break;
      default:
        break;
    }
  }

  /** Construct the persistent graph: master bus, noise layers, hum drones. */
  private buildGraph(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.master = master;

    const noise = this.makeNoiseBuffer(ctx, 2.7);

    // Wind: looping noise → bandpass → gain.
    const windSource = ctx.createBufferSource();
    windSource.buffer = noise;
    windSource.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 300;
    windFilter.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    windSource.start();
    this.windFilter = windFilter;
    this.windGain = windGain;

    // Storm rumble: the same noise buffer through a deep lowpass.
    const rumbleSource = ctx.createBufferSource();
    rumbleSource.buffer = noise;
    rumbleSource.loop = true;
    rumbleSource.playbackRate.value = 0.5; // darker spectrum
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 85;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleSource.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(master);
    rumbleSource.start();
    this.rumbleGain = rumbleGain;

    // Machine hum: two detuned saws → lowpass → gain, with a slow LFO wobble
    // on the gain so the drone breathes instead of sitting dead flat.
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 240;
    const humGain = ctx.createGain();
    humGain.gain.value = 0;
    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.value = 55;
    const oscB = ctx.createOscillator();
    oscB.type = 'sawtooth';
    oscB.frequency.value = 110.6; // slightly sharp octave: a real machine beat
    oscA.connect(humFilter);
    oscB.connect(humFilter);
    humFilter.connect(humGain);
    humGain.connect(master);
    oscA.start();
    oscB.start();
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.37;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.008;
    lfo.connect(lfoDepth);
    lfoDepth.connect(humGain.gain);
    lfo.start();
    this.humGain = humGain;

    // Retropropulsion jet: noise → sweeping bandpass → gain (idle at zero).
    const jetSource = ctx.createBufferSource();
    jetSource.buffer = noise;
    jetSource.loop = true;
    jetSource.playbackRate.value = 1.4;
    const jetFilter = ctx.createBiquadFilter();
    jetFilter.type = 'bandpass';
    jetFilter.frequency.value = 500;
    jetFilter.Q.value = 0.9;
    const jetGain = ctx.createGain();
    jetGain.gain.value = 0;
    jetSource.connect(jetFilter);
    jetFilter.connect(jetGain);
    jetGain.connect(master);
    jetSource.start();
    this.jetFilter = jetFilter;
    this.jetGain = jetGain;
  }

  /** Deterministic white-noise buffer (32-bit LCG — no Math.random, matching house style). */
  private makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let s = 0x9e3779b9 | 0;
    for (let i = 0; i < length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      data[i] = s / 2147483648;
    }
    return buffer;
  }

  /** One enveloped oscillator note: optional attack ramp and pitch glide. */
  private tone(opts: {
    readonly freq: number;
    readonly delay: number;
    readonly duration: number;
    readonly peak: number;
    readonly type: OscillatorType;
    readonly attack?: number;
    readonly glideTo?: number;
  }): void {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null) {
      return;
    }
    const t0 = ctx.currentTime + opts.delay;
    const attack = opts.attack ?? 0.015;
    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.glideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(opts.glideTo, t0 + opts.duration);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(opts.peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + opts.duration + 0.05);
  }

  /** One enveloped noise burst through a lowpass (touchdown dust blast). */
  private burst(opts: { readonly duration: number; readonly filterFreq: number; readonly peak: number }): void {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null) {
      return;
    }
    const t0 = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.makeNoiseBuffer(ctx, opts.duration + 0.1);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = opts.filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(opts.peak, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t0);
    source.stop(t0 + opts.duration + 0.1);
  }
}

/** The app-wide audio engine instance. Inert until unlock() is called from a gesture. */
export const soundEngine = new SoundEngine();
