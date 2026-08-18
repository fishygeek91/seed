# SEED

A first-principles simulator of a self-replicating factory. One landed seed — a Starship-worth of robots, power, printers, miners, and a parts library — must eat sunlight, ice, and rock until it can copy itself.

**The only score that matters is industrial doubling time**: sols (or days) for factory mass + working capacity to reach 2×. Then 4×. Then 8×. If doubling time shrinks, you are watching takeoff. If it grows, the seed is dying.

## Install & run

```bash
npm install
npm run dev
# open http://localhost:3000
```

No backend, no auth, no analytics, no API calls. Everything runs locally and deterministically: same scenario seed + same inputs ⇒ same history.

Useful extras:

```bash
npm run build          # production build
npm run lint           # ESLint (strict TS: no any, no !, no unknown-casts)
npx tsx scripts/smoke.ts   # headless 600-sol run: beats, determinism, mass closure
```

## How the sim steps

The simulation is a pure function: `step(state, dtHours) => nextState` in `src/sim/step.ts`. The UI (Zustand store + React) only renders state and dispatches allocation changes — no physics lives in components. Each tick runs, in order:

1. **Clock + environment** — sol fraction, sun elevation, baked dust optical-depth series (Beer–Lambert attenuation).
2. **Energy budget** — solar in; night-survival load paid first; a full night of keep-alive energy is held in battery reserve before any work is powered.
3. **Labor** — robots assigned to lanes (mine → haul → process → print → assemble → QA → repair → recycle → process-dev) by your allocation sliders, derated by uptime, dust fouling, and power.
4. **Extraction** — demand-capped mining and hauling, beneficiation with perchlorate penalty (Mars), ice extraction, scrap remelt with dross loss.
5. **Production** — two passes over the recipe graph: the child copy gets first call on labor, machines, materials, and joules; parent expansion (more solar, batteries, kilns) spends the leftovers. Inputs move into WIP; whole units complete with a deterministic yield roll; failures scrap their full input mass.
6. **QA** — mandatory, assembly-first, with hour-banking so a 10-hour kiln inspection spans ticks. Latent defects become visible junk on the floor.
7. **Deployment** — child spec allocation first, then parent infrastructure (keeping an assembly-stock buffer of battery packs and toolheads), then fresh robots wake.
8. **Process development** — vitamin localization paid in robot-hours + scrapped trial mass, some programs gated on Earth data drops.
9. **Resupply** — Earth: lead-time orders. Mars: ~26-month synodic windows only.
10. **Robot wear** — Weibull hazard (k=2), dust fouling, technician repairs.
11. **Child wake check, doubling detection, end states, per-sol snapshot, and a mass-conservation audit** (tracked mass vs. boundary inputs must close within rounding — it holds at 0.0000%).

The four flows — **Atoms, Joules, Hands, Information** — are conserved. Scrap is never deleted; vitamins destroyed in failed parts downcycle to bulk mass; every kWh is consumed, stored, or curtailed.

## Where constants and recipes live

- `src/sim/constants.ts` — every headline number, each with a citation (Appelbaum & Flood 1990, Kopp & Lean 2011, Hecht et al. 2009, Baumers et al. 2011, BNEF pack surveys, …) or an explicit `ASSUMED: reason`. Rendered verbatim by the in-app **Sources** drawer.
- `src/data/parts.ts` — the recipe graph (16 parts: frames, solar sections, cables, battery packs, actuators, sensor/compute, seals, kiln lines, machining, miner tools, wheelsets, four robot roles, the child chassis) plus `CHILD_SPEC`, the published minimum a Generation N+1 seed must meet to count as a copy.
- `src/data/sites.ts` — Earth factory lot vs. Mars icy plain: sol length, irradiance, haul distance, perchlorates, baked quiet-year/storm-year optical-depth series, resupply model.
- `src/data/templates.ts` — the four cargo manifests (Balanced / Hands first / Power first / Vitamins first) for the payload slider.
- `src/sim/units.ts` — branded unit types (`MassKg`, `EnergyKwh`, `PowerKwe`, `RobotHours`, `Sol`, …) so kilograms cannot be added to kilowatt-hours.

## How to demo this in 90 seconds

Open the app — the default scenario (Mars, Balanced seed, deterministic seed string) plays itself at 24 sim-hours/second. Watch the left event feed and the huge doubling-time number: the seed lands and unfolds its arrays (sol 0–2), the kiln yard lights, the child chassis rises on the neighbouring pad (~sol 60) and **Generation 1 wakes and walks out** shortly after. Bump the speed to 96 h/s: around sol 200 a global dust storm collapses solar and the doubling counter spikes toward ∞ (a scrub); the sky clears, and at sol ~320 a resupply lands 15 t of vitamins plus a process data drop — Generation 3, which had been vitamin-starved at 53% for a hundred sols, wakes within ten sols. From there the counter falls hard — hundreds of sols down through ~131 — as generations chain (29 by sol 600). Hover any number for its formula and source, open **Sources** for the audited constants, drag the time scrubber to replay any sol, and hit **Export brief** for a markdown seed brief.

Once a run has a story, hit **Reel** for the mission reel: the app scans the event log, picks the beats that matter (landing, first chassis, sampled generation wakes, storms, touchdowns, every doubling — capped at 16), scrubs the timeline to each one with a purpose-built shot, letterboxes the viewport with the event text as the subtitle, and fires the matching sound stinger. About a minute, fully deterministic, then back to live. Any scrub, focus, or play input hands control back to you.

The right panel's **history strip** is the run's flight recorder: three charts on one time axis — log capacity (exponential growth plots straight; storms shaded, ×2 doublings ticked, wakes and cargo drops marked on the baseline), solar power with battery state of charge, and doubling time on a log scale where the line breaks at ∞ and falls toward takeoff. It is also a scrub surface: hover any chart for a crosshair readout of that sol, click or drag to jump the whole app — 3D scene, HUD, ledgers — to that moment, and drag to the right edge to return to live.

Two more controls make the demo hands-free: set camera focus to **Auto** and the director takes the shot list — it tracks resupply landers all the way down, cuts to generation wakes and freshly onlined colony seeds, pulls wide for dust storms, and otherwise rotates through overwatch, print-yard, child-assembly, and colony shots (a "◉ TRACKING" caption names the current subject). Toggle **♪** for the ambient feed — every sound is synthesized in WebAudio, no assets: wind keyed to storm optical depth, machine hum keyed to how hard the factory is working, a rising retropropulsion roar during descent, and rate-limited stingers for wakes, doublings, touchdowns, and failures.
