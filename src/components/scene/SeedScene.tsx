/**
 * The center 3D view: the factory's own holographic self-model.
 *
 * SEED does not render a movie of Mars — it renders the machine's telemetry.
 * Everything visible is driven by sim state — printers print printer parts,
 * rovers shuttle ore, the kiln mouth breathes plasma-violet, scrap piles up
 * as magenta shame, and the child seed rises on the neighbouring pad as a
 * phosphor-green wireframe until it unfolds and walks.
 *
 * Rendering approach: every machine is an emissive wireframe hologram in a
 * lightless star void. The terrain is a single shader: a world-space survey
 * grid with anti-aliased minor/major lines, elevation contours, polar range
 * rings and spokes, and a rotating radar sweep — all conforming to the
 * displaced dune geometry. Bloom lifts the emissives; a scanline pass and
 * grain make it read as a CRT feed. No textures are fetched — the solar
 * cell grid is painted onto a CanvasTexture at mount.
 */

'use client';

import { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, Noise, Scanline } from '@react-three/postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useSimStore } from '@/store/useSimStore';
import { selectView } from '@/components/view';
import type { SceneView } from '@/components/view';
import type { ReelBeat } from '@/sim/reel';

/* ------------------------------------------------------------------ */
/* Shared hologram materials & deterministic noise                     */
/* ------------------------------------------------------------------ */

/** Primary hull hologram: cyan wireframe, the parent machine. */
const HOLO_HULL = { color: '#000000', emissive: '#37e8c2', emissiveIntensity: 1.0, wireframe: true } as const;
/** Structural frame hologram: deep schematic blue. */
const HOLO_FRAME = { color: '#000000', emissive: '#1f6fd8', emissiveIntensity: 0.8, wireframe: true } as const;
/** Accent hologram used on masts, toolheads, and foot pads. */
const HOLO_ACCENT = { color: '#000000', emissive: '#17b0a0', emissiveIntensity: 0.9, wireframe: true } as const;
/** The child copy renders phosphor green: new growth. */
const HOLO_CHILD = { color: '#000000', emissive: '#2bff9e', emissiveIntensity: 0.9, wireframe: true } as const;
/** Process heat (kiln, print line) is plasma violet — never rust orange. */
const PLASMA = '#c86bff';

/** Deterministic pseudo-random in [0,1) from an integer index (display only). */
function hash01(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Cheap deterministic 2D value-ish noise from summed sines (display only). */
function terrainNoise(x: number, z: number): number {
  return (
    Math.sin(x * 0.045 + 1.7) * Math.cos(z * 0.038 + 0.6) * 0.55 +
    Math.sin(x * 0.11 + z * 0.07 + 4.1) * 0.28 +
    Math.sin(x * 0.31 - z * 0.23 + 2.3) * 0.12 +
    Math.sin(x * 0.83 + z * 0.91 + 0.9) * 0.05
  );
}

/** Paint a phosphor photovoltaic cell grid onto a CanvasTexture (client only). */
function makeSolarTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return null;
  }
  // Near-black cell field: the grid lines carry the glow.
  ctx.fillStyle = '#02110d';
  ctx.fillRect(0, 0, 256, 128);
  // Cell grid lines.
  ctx.strokeStyle = 'rgba(63, 210, 255, 0.8)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= 256; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 128);
    ctx.stroke();
  }
  for (let y = 0; y <= 128; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  // Fine busbars inside each cell.
  ctx.strokeStyle = 'rgba(43, 255, 158, 0.22)';
  ctx.lineWidth = 1;
  for (let y = 8; y <= 128; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/* ------------------------------------------------------------------ */
/* Survey-grid terrain shader                                          */
/* ------------------------------------------------------------------ */

/** Terrain vertex shader: hand world position to the fragment stage. */
const GRID_VERTEX = `
varying vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Terrain fragment shader: anti-aliased survey grid (2 m minor, 10 m major),
 * elevation contours every 0.75 m, polar range rings every 15 m with 30°
 * spokes, and a rotating radar sweep with an exponential trail. Everything
 * fades radially into the void so the hologram has an edge.
 */
const GRID_FRAGMENT = `
uniform vec3 uLine;
uniform vec3 uPolar;
uniform vec3 uContour;
uniform float uBright;
uniform float uSweep;
varying vec3 vWorld;

float lineAA(float coord) {
  float d = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
  return 1.0 - clamp(d, 0.0, 1.0);
}

float gridAA(vec2 p, float scale) {
  vec2 c = p / scale;
  vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
  return 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
}

void main() {
  float dist = length(vWorld.xz);
  float fade = 1.0 - smoothstep(40.0, 128.0, dist);

  // Cartesian survey grid.
  float minor = gridAA(vWorld.xz, 2.0) * 0.16;
  float major = gridAA(vWorld.xz, 10.0) * 0.5;

  // Elevation contours read the dune field without any albedo.
  float contour = lineAA(vWorld.y / 0.75) * 0.4;

  // Polar overlay: range rings every 15 m, spokes every 30 degrees.
  float ring = lineAA(dist / 15.0) * 0.35;
  float angle = atan(vWorld.z, vWorld.x);
  float spoke = lineAA(angle / 0.5235988) * 0.10 * smoothstep(6.0, 20.0, dist);

  // Radar sweep: a bright leading edge with an exponential phosphor trail.
  float da = mod(uSweep - angle, 6.2831853);
  float sweep = exp(-da * 5.0) * 0.5 * smoothstep(3.0, 8.0, dist);

  vec3 col = vec3(0.003, 0.012, 0.010);
  col += uLine * (minor + major) * fade * uBright;
  col += uContour * contour * fade * uBright;
  col += uPolar * (ring + spoke + sweep) * fade * uBright;

  // Blue-noise-ish dither to kill gradient banding.
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (dither - 0.5) * 0.004;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Singleton uniform set for the one terrain sheet. Lives at module scope so
 * the per-frame useFrame writes are plain object mutation, not mutation of a
 * hook-derived value (which the React Compiler lint rules forbid).
 */
const TERRAIN_UNIFORMS = {
  uLine: { value: new THREE.Color('#2bff9e') },
  uPolar: { value: new THREE.Color('#3fd2ff') },
  uContour: { value: new THREE.Color('#1a8f6e') },
  uBright: { value: 1 },
  uSweep: { value: 0 },
};

/** Ground elevation at (x, z): flat compacted pad, rippled dunes beyond, rim uplift. */
function terrainHeight(x: number, z: number): number {
  const dist = Math.hypot(x, z);
  const padMask = THREE.MathUtils.smoothstep(dist, 16, 44);
  const n = terrainNoise(x, z);
  // Fine wind ripples ride on top of the dune field, fading out on the pad.
  const ripple = Math.sin(x * 1.35 + Math.sin(z * 0.6) * 1.5) * Math.cos(z * 1.1 + 0.4) * 0.05;
  return n * 3.4 * padMask + ripple * padMask + Math.max(0, dist - 90) * 0.055;
}

/**
 * The displaced dune field rendered as a survey hologram. Day, night, and
 * storms modulate grid brightness: the feed dims at night and flickers with
 * dust interference during a storm.
 */
function Terrain({ sunHeight, storm }: { readonly sunHeight: number; readonly storm: number }): React.ReactElement {
  const geometry = useMemo(() => {
    const size = 260;
    const segments = 128;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();
    return geo;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    // Radar sweep advances steadily; brightness breathes with sol and storm.
    TERRAIN_UNIFORMS.uSweep.value = (t * 0.45) % (Math.PI * 2);
    const dayBright = 0.62 + Math.max(0, sunHeight) * 0.38;
    const flicker = storm > 0.02 ? 1 - storm * (0.22 + 0.16 * Math.abs(Math.sin(t * 37) * Math.sin(t * 11.3))) : 1;
    TERRAIN_UNIFORMS.uBright.value = THREE.MathUtils.lerp(TERRAIN_UNIFORMS.uBright.value, dayBright * flicker, 0.1);
  });

  return (
    <mesh geometry={geometry}>
      <shaderMaterial uniforms={TERRAIN_UNIFORMS} vertexShader={GRID_VERTEX} fragmentShader={GRID_FRAGMENT} fog={false} />
    </mesh>
  );
}

/** Hundreds of instanced pebbles scattered on the terrain as dim survey returns. */
function PebbleField(): React.ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = 700;
  useEffect(() => {
    const mesh = meshRef.current;
    if (mesh === null) {
      return;
    }
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const angle = hash01(i * 3 + 0.7) * Math.PI * 2;
      // Bias density toward the pad fringe with a sub-linear radius falloff.
      const radius = 6 + Math.pow(hash01(i * 5 + 1.3), 0.7) * 66;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      dummy.position.set(x, terrainHeight(x, z) + 0.02, z);
      dummy.rotation.set(hash01(i * 7) * 3, hash01(i * 11) * 3, hash01(i * 13) * 3);
      dummy.scale.setScalar(0.05 + hash01(i * 17) * 0.16);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color='#000000' emissive='#0e3a34' emissiveIntensity={0.7} wireframe />
    </instancedMesh>
  );
}

/** Distant mesas / hills as faint wireframe relief on the horizon. */
function DistantRelief(): React.ReactElement {
  return (
    <group>
      {Array.from({ length: 9 }, (_, i) => {
        const angle = (i / 9) * Math.PI * 2 + hash01(i * 17) * 0.5;
        const radius = 105 + hash01(i * 5) * 35;
        const width = 18 + hash01(i * 3) * 30;
        const height = 6 + hash01(i * 7) * 14;
        return (
          <mesh key={`mesa-${i}`} position={[Math.cos(angle) * radius, height * 0.28, Math.sin(angle) * radius]} rotation={[0, hash01(i) * Math.PI, 0]}>
            <cylinderGeometry args={[width * 0.55, width, height, 7]} />
            <meshStandardMaterial color='#000000' emissive='#0c3040' emissiveIntensity={0.8} wireframe />
          </mesh>
        );
      })}
    </group>
  );
}

/** Wind-borne dust rendered as signal interference; density tracks the storm. */
function StormDust({ view }: { readonly view: SceneView }): React.ReactElement {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const count = 1100;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (hash01(i * 3 + 1) - 0.5) * 150;
      arr[i * 3 + 1] = 0.3 + hash01(i * 3 + 2) * 16;
      arr[i * 3 + 2] = (hash01(i * 3 + 3) - 0.5) * 150;
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    const points = pointsRef.current;
    const material = materialRef.current;
    if (points === null || material === null) {
      return;
    }
    const storm = view.stormIntensity;
    // Baseline static on Mars even on quiet sols; ramps hard in a storm.
    const baseline = view.siteId === 'mars' ? 0.03 : 0.015;
    material.opacity = THREE.MathUtils.lerp(material.opacity, baseline + storm * 0.4, 0.05);
    material.size = 0.14 + storm * 0.2;
    const geo = points.geometry;
    const pos = geo.getAttribute('position');
    const wind = (2.5 + storm * 26) * delta;
    for (let i = 0; i < count; i++) {
      let x = pos.getX(i) + wind * (0.7 + hash01(i) * 0.6);
      const y = pos.getY(i) + Math.sin(i + x * 0.1) * delta * (0.4 + storm);
      if (x > 76) {
        x = -76;
      }
      pos.setX(i, x);
      pos.setY(i, THREE.MathUtils.clamp(y, 0.2, 17));
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach='attributes-position' args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={materialRef}
        color='#3fd2ff'
        size={0.14}
        transparent
        opacity={0}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

/** The sun as a telemetry marker: a bright wireframe octahedron tracking sol time. */
function SunMarker({
  sunDirection,
  sunHeight,
  storm,
}: {
  readonly sunDirection: THREE.Vector3;
  readonly sunHeight: number;
  readonly storm: number;
}): React.ReactElement | null {
  if (sunHeight <= 0.02) {
    return null;
  }
  const position = sunDirection.clone().multiplyScalar(150);
  const brightness = Math.max(0.3, (1 - storm * 0.8) * 3);
  return (
    <group position={[position.x, position.y, position.z]}>
      <mesh>
        <octahedronGeometry args={[3.2, 0]} />
        <meshBasicMaterial color={new THREE.Color('#eafff6').multiplyScalar(brightness)} wireframe fog={false} toneMapped={false} />
      </mesh>
      <mesh>
        <octahedronGeometry args={[1.2, 0]} />
        <meshBasicMaterial color={new THREE.Color('#ffffff').multiplyScalar(brightness * 1.6)} fog={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Terrain + void + sun marker + interference, driven by site, sol time, and storm. */
function Environment({ view }: { readonly view: SceneView }): React.ReactElement {
  const dayFrac = view.hourOfSol / view.solLengthHours;
  const sunAngle = (dayFrac - 0.25) * Math.PI * 2; // noon overhead
  const sunHeight = Math.sin(sunAngle);
  const storm = view.stormIntensity;
  const sunDirection = useMemo(
    () => new THREE.Vector3(Math.cos(sunAngle), Math.max(0.04, sunHeight), 0.38).normalize(),
    [sunAngle, sunHeight],
  );
  // Depth cue: black fog swallows the far grid; storms close the horizon in.
  const fogFar = Math.max(46, 170 - storm * 120);

  return (
    <group>
      <fog attach='fog' args={['#010409', 24, fogFar]} />
      {/* The void is always starred — this is a self-model, not a sky. */}
      <Stars radius={190} depth={60} count={3000} factor={2.6} saturation={0} fade speed={0.25} />
      <SunMarker sunDirection={sunDirection} sunHeight={sunHeight} storm={storm} />
      {/* Faint fill so translucent panes never go fully dead. */}
      <ambientLight intensity={0.04} color='#7fe8c8' />
      <Terrain sunHeight={sunHeight} storm={storm} />
      <PebbleField />
      <DistantRelief />
      <StormDust view={view} />
      {/* Scattered boulders on the pad fringe. */}
      {Array.from({ length: 30 }, (_, i) => {
        const r = 16 + hash01(i) * 55;
        const a = i * 2.4;
        return (
          <mesh key={`rock-${i}`} position={[Math.cos(a) * r, 0.12 + hash01(i * 7) * 0.1, Math.sin(a) * r]} rotation={[hash01(i * 3) * 3, hash01(i * 5) * 3, 0]}>
            <dodecahedronGeometry args={[0.18 + hash01(i * 7) * 0.55, 0]} />
            <meshStandardMaterial color='#000000' emissive='#10403a' emissiveIntensity={0.7} wireframe />
          </mesh>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* The factory                                                         */
/* ------------------------------------------------------------------ */

/** One unfolding solar wing with a painted phosphor cell texture. */
function SolarPetal({
  angle,
  foldAngle,
  length,
  width,
  texture,
}: {
  readonly angle: number;
  readonly foldAngle: number;
  readonly length: number;
  readonly width: number;
  readonly texture: THREE.Texture | null;
}): React.ReactElement {
  return (
    <group rotation={[0, angle, 0]} position={[0, 0.4, 0]}>
      <group position={[2.05, 0, 0]} rotation={[0, 0, foldAngle]}>
        <mesh position={[length / 2, 0.03, 0]}>
          <boxGeometry args={[length, 0.06, width]} />
          {texture !== null ? (
            <meshBasicMaterial map={texture} toneMapped={false} />
          ) : (
            <meshStandardMaterial color='#000000' emissive='#0d5a72' emissiveIntensity={0.8} />
          )}
        </mesh>
        {/* Spine truss under the wing. */}
        <mesh position={[length / 2, -0.06, 0]}>
          <boxGeometry args={[length, 0.05, 0.12]} />
          <meshStandardMaterial {...HOLO_FRAME} />
        </mesh>
      </group>
    </group>
  );
}

/** The landed parent seed: hull, rings, dish, legs, solar petals, kiln yard, machining bay. */
function ParentSeed({ view }: { readonly view: SceneView }): React.ReactElement {
  const petals = 8;
  const deploy = view.solarDeployFraction;
  const kilnRef = useRef<THREE.MeshStandardMaterial>(null);
  const kilnLightRef = useRef<THREE.PointLight>(null);
  const solarTexture = useMemo(() => makeSolarTexture(), []);

  useFrame(({ clock }) => {
    // The kiln mouth breathes: flickering emissive + light when powered.
    const active = view.kilnActive ? 1 : 0;
    const t = clock.getElapsedTime();
    const flicker = 0.85 + Math.sin(t * 9.3) * 0.08 + Math.sin(t * 23.7) * 0.07;
    const material = kilnRef.current;
    if (material !== null) {
      material.emissiveIntensity = THREE.MathUtils.lerp(material.emissiveIntensity, active * 3.6 * flicker + 0.04, 0.1);
    }
    const light = kilnLightRef.current;
    if (light !== null) {
      light.intensity = THREE.MathUtils.lerp(light.intensity, active * 14 * flicker, 0.1);
    }
  });

  return (
    <group>
      {/* Landing footprint: an etched ring where the seed touched down. */}
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[4.35, 4.6, 48]} />
        <meshBasicMaterial color='#134a44' transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      {/* Core: the landed pressure hull with ring stiffeners. */}
      <mesh position={[0, 2.3, 0]}>
        <cylinderGeometry args={[1.6, 1.9, 4.4, 28]} />
        <meshStandardMaterial {...HOLO_HULL} />
      </mesh>
      {[1.1, 2.3, 3.5].map((y) => (
        <mesh key={`ring-${y}`} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.62 + (2.3 - y) * 0.055, 0.05, 8, 32]} />
          <meshStandardMaterial {...HOLO_FRAME} />
        </mesh>
      ))}
      <mesh position={[0, 4.9, 0]}>
        <coneGeometry args={[1.6, 1.3, 28]} />
        <meshStandardMaterial {...HOLO_HULL} />
      </mesh>
      {/* Nav beacon at the tip — always breathing so the seed reads alive. */}
      <mesh position={[0, 5.7, 0]}>
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshStandardMaterial color='#ff3d8a' emissive='#ff3d8a' emissiveIntensity={2.6} />
      </mesh>
      {/* Comms dish tracking Earthward. */}
      <group position={[0.9, 4.4, 0.9]} rotation={[0.5, 0.8, 0]}>
        <mesh>
          <sphereGeometry args={[0.5, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.4]} />
          <meshStandardMaterial {...HOLO_ACCENT} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.5, 6]} />
          <meshStandardMaterial {...HOLO_FRAME} />
        </mesh>
      </group>
      {/* Airlock hatch with a lit porthole. */}
      <mesh position={[0, 1.4, 1.82]} rotation={[0.06, 0, 0]}>
        <boxGeometry args={[0.8, 1.1, 0.12]} />
        <meshStandardMaterial {...HOLO_FRAME} />
      </mesh>
      <mesh position={[0, 1.55, 1.9]}>
        <circleGeometry args={[0.14, 16]} />
        <meshStandardMaterial color='#eafff6' emissive='#eafff6' emissiveIntensity={1.8} />
      </mesh>
      {/* Landing legs with foot pads. */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        return (
          <group key={`leg-${i}`} rotation={[0, a, 0]}>
            <mesh position={[2, 0.85, 0]} rotation={[0, 0, 0.55]}>
              <cylinderGeometry args={[0.08, 0.11, 2.3, 8]} />
              <meshStandardMaterial {...HOLO_FRAME} />
            </mesh>
            <mesh position={[2.55, 0.08, 0]}>
              <cylinderGeometry args={[0.42, 0.5, 0.14, 12]} />
              <meshStandardMaterial {...HOLO_ACCENT} />
            </mesh>
          </group>
        );
      })}
      {/* Solar petals unfold from vertical (packed) to flat (deployed). */}
      {Array.from({ length: petals }, (_, i) => (
        <SolarPetal
          key={`petal-${i}`}
          angle={(i / petals) * Math.PI * 2}
          foldAngle={(1 - deploy) * Math.PI * 0.45}
          length={4.8}
          width={1.7}
          texture={solarTexture}
        />
      ))}
      {/* Kiln / print yard: breathes plasma violet when powered. */}
      <group position={[6.5, 0, 4.5]}>
        <mesh position={[0, 0.95, 0]}>
          <boxGeometry args={[3.4, 1.9, 2.3]} />
          <meshStandardMaterial {...HOLO_FRAME} />
        </mesh>
        {/* Roof pipework. */}
        {[-0.9, 0, 0.9].map((x) => (
          <mesh key={`pipe-${x}`} position={[x, 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 2.1, 8]} />
            <meshStandardMaterial {...HOLO_ACCENT} />
          </mesh>
        ))}
        {/* The glowing mouth. */}
        <mesh position={[0, 0.8, 1.17]}>
          <planeGeometry args={[2.7, 1.05]} />
          <meshStandardMaterial ref={kilnRef} color='#0c0212' emissive={PLASMA} emissiveIntensity={0.04} toneMapped={false} />
        </mesh>
        <pointLight ref={kilnLightRef} position={[0, 1, 1.9]} intensity={0} distance={12} decay={1.8} color={PLASMA} />
        {/* Stack with a hot collar. */}
        <mesh position={[1.25, 2.7, -0.6]}>
          <cylinderGeometry args={[0.12, 0.17, 1.6, 10]} />
          <meshStandardMaterial {...HOLO_ACCENT} />
        </mesh>
        <mesh position={[1.25, 2.05, -0.6]}>
          <cylinderGeometry args={[0.15, 0.15, 0.2, 10]} />
          <meshStandardMaterial color='#12061c' emissive={PLASMA} emissiveIntensity={view.kilnActive ? 1.6 : 0.05} />
        </mesh>
        <KilnSmoke active={view.kilnActive} />
        <KilnEmbers active={view.kilnActive} />
      </group>
      {/* Machining bay with arc-weld flashes. */}
      <group position={[-6, 0, 4]}>
        <mesh position={[0, 0.75, 0]}>
          <boxGeometry args={[2.6, 1.5, 1.9]} />
          <meshStandardMaterial {...HOLO_FRAME} />
        </mesh>
        <mesh position={[0, 1.62, 0]} rotation={[0, 0, 0.12]}>
          <boxGeometry args={[2.9, 0.08, 2.1]} />
          <meshStandardMaterial {...HOLO_ACCENT} />
        </mesh>
        <ArcWelder active={view.kilnActive} />
      </group>
      {/* Cable harness runs from core to yards: live glowing conduits. */}
      <mesh position={[3.2, 0.06, 2.2]} rotation={[0, -0.6, 0.01]}>
        <boxGeometry args={[6.5, 0.08, 0.2]} />
        <meshStandardMaterial color='#000000' emissive='#3fd2ff' emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[-3.1, 0.06, 2]} rotation={[0, 0.55, -0.01]}>
        <boxGeometry args={[6, 0.08, 0.2]} />
        <meshStandardMaterial color='#000000' emissive='#3fd2ff' emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

/** Faint plasma exhaust rising from the kiln stack when it runs. */
function KilnSmoke({ active }: { readonly active: boolean }): React.ReactElement {
  const pointsRef = useRef<THREE.Points>(null);
  const count = 40;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = 1.25 + (hash01(i * 3) - 0.5) * 0.2;
      arr[i * 3 + 1] = 3.5 + hash01(i * 5) * 3.5;
      arr[i * 3 + 2] = -0.6 + (hash01(i * 7) - 0.5) * 0.2;
    }
    return arr;
  }, []);
  useFrame((_, delta) => {
    const points = pointsRef.current;
    if (points === null) {
      return;
    }
    points.visible = active;
    if (!active) {
      return;
    }
    const pos = points.geometry.getAttribute('position');
    for (let i = 0; i < count; i++) {
      let y = pos.getY(i) + delta * (0.5 + hash01(i) * 0.5);
      let x = pos.getX(i) + delta * 0.35;
      if (y > 7.5) {
        y = 3.5;
        x = 1.25;
      }
      pos.setY(i, y);
      pos.setX(i, x);
    }
    pos.needsUpdate = true;
  });
  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach='attributes-position' args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color='#a06ad8' size={0.3} transparent opacity={0.22} depthWrite={false} sizeAttenuation />
    </points>
  );
}

/** Mutable particle bookkeeping for small display-only emitters. */
interface ParticlePool {
  readonly velocities: Float32Array;
  readonly life: Float32Array;
  cursor: number;
  spawnSeed: number;
}

/** Allocate the mutable half of a particle pool (built lazily inside useFrame). */
function makeParticlePool(count: number): ParticlePool {
  return { velocities: new Float32Array(count * 3), life: new Float32Array(count), cursor: 0, spawnSeed: 1 };
}

/** Initial particle positions: everything parked out of sight below ground. */
function makeHiddenPositions(count: number): Float32Array {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 1] = -50;
  }
  return positions;
}

/** Intermittent arc-weld flash on the machining deck, with a shower of sparks. */
function ArcWelder({ active }: { readonly active: boolean }): React.ReactElement {
  const flashRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const sparksRef = useRef<THREE.Points>(null);
  const sparkPoolRef = useRef<ParticlePool | null>(null);
  const sparkCount = 30;
  const sparkPositions = useMemo(() => makeHiddenPositions(sparkCount), []);
  useFrame(({ clock }, delta) => {
    const flash = flashRef.current;
    const light = lightRef.current;
    if (flash === null || light === null) {
      return;
    }
    const t = clock.getElapsedTime();
    // Deterministic strobe pattern: bursts of arc, then quiet.
    const burst = hash01(Math.floor(t * 1.7)) > 0.55;
    const strobe = hash01(Math.floor(t * 30)) > 0.4;
    const on = active && burst && strobe;
    flash.visible = on;
    light.intensity = on ? 18 : 0;
    // Sparks: spawn while the arc is lit, fly ballistically, die fast.
    const points = sparksRef.current;
    if (points === null) {
      return;
    }
    if (sparkPoolRef.current === null) {
      sparkPoolRef.current = makeParticlePool(sparkCount);
    }
    const pool = sparkPoolRef.current;
    const pos = points.geometry.getAttribute('position');
    const { velocities, life } = pool;
    if (on) {
      for (let s = 0; s < 2; s++) {
        const i = pool.cursor % sparkCount;
        pool.cursor += 1;
        const seed = pool.spawnSeed;
        pool.spawnSeed += 1;
        pos.setXYZ(i, 0, 0, 0);
        velocities[i * 3] = (hash01(seed * 3 + 0.1) - 0.5) * 3.2;
        velocities[i * 3 + 1] = 0.8 + hash01(seed * 5 + 0.2) * 2.4;
        velocities[i * 3 + 2] = (hash01(seed * 7 + 0.3) - 0.5) * 3.2;
        life[i] = 0.35 + hash01(seed * 11 + 0.4) * 0.4;
      }
    }
    for (let i = 0; i < sparkCount; i++) {
      if (life[i] <= 0) {
        continue;
      }
      life[i] -= delta;
      if (life[i] <= 0) {
        pos.setY(i, -50);
        continue;
      }
      velocities[i * 3 + 1] -= 7.5 * delta; // display gravity, tuned for drama
      pos.setXYZ(
        i,
        pos.getX(i) + velocities[i * 3] * delta,
        pos.getY(i) + velocities[i * 3 + 1] * delta,
        pos.getZ(i) + velocities[i * 3 + 2] * delta,
      );
    }
    pos.needsUpdate = true;
  });
  return (
    <group position={[0.4, 1.75, 0.3]}>
      <mesh ref={flashRef} visible={false}>
        <sphereGeometry args={[0.09, 8, 8]} />
        <meshBasicMaterial color={new THREE.Color('#dfe9ff').multiplyScalar(9)} toneMapped={false} />
      </mesh>
      <pointLight ref={lightRef} intensity={0} distance={9} decay={2} color='#cfe0ff' />
      <points ref={sparksRef}>
        <bufferGeometry>
          <bufferAttribute attach='attributes-position' args={[sparkPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={new THREE.Color('#bfe8ff').multiplyScalar(2.4)}
          size={0.04}
          transparent
          opacity={0.95}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          sizeAttenuation
        />
      </points>
    </group>
  );
}

/** Hot embers drifting up out of the kiln mouth when the yard is firing. */
function KilnEmbers({ active }: { readonly active: boolean }): React.ReactElement {
  const pointsRef = useRef<THREE.Points>(null);
  const count = 20;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (hash01(i * 3 + 0.4) - 0.5) * 2.2;
      arr[i * 3 + 1] = 0.8 + hash01(i * 5 + 0.5) * 2.4;
      arr[i * 3 + 2] = 1.3 + hash01(i * 7 + 0.6) * 0.5;
    }
    return arr;
  }, []);
  useFrame((_, delta) => {
    const points = pointsRef.current;
    if (points === null) {
      return;
    }
    points.visible = active;
    if (!active) {
      return;
    }
    const pos = points.geometry.getAttribute('position');
    for (let i = 0; i < count; i++) {
      let y = pos.getY(i) + delta * (0.7 + hash01(i * 13) * 0.8);
      let x = pos.getX(i) + Math.sin(y * 3 + i) * delta * 0.3;
      let z = pos.getZ(i) + delta * 0.5;
      if (y > 3.4) {
        y = 0.85;
        x = (hash01(i * 3 + 0.4) - 0.5) * 2.2;
        z = 1.3;
      }
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
  });
  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach='attributes-position' args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={new THREE.Color('#e09aff').multiplyScalar(2.6)}
        size={0.06}
        transparent
        opacity={0.9}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
        sizeAttenuation
      />
    </points>
  );
}

/** Scrap heap + junk pallets: rejected parts glow alarm magenta — visible shame. */
function ScrapYard({ view }: { readonly view: SceneView }): React.ReactElement {
  const scrapScale = Math.min(2.5, 0.25 + view.scrapKg / 20000);
  const palletCount = Math.min(12, Math.floor(view.junkCount / 4));
  return (
    <group position={[-5, 0, -6]}>
      {/* Irregular heap: overlapping shards instead of a neat cone. */}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh
          key={`shard-${i}`}
          position={[(hash01(i * 3) - 0.5) * scrapScale * 1.8, scrapScale * (0.2 + hash01(i * 5) * 0.3), (hash01(i * 7) - 0.5) * scrapScale * 1.8]}
          rotation={[hash01(i) * 3, hash01(i * 11) * 3, hash01(i * 13) * 3]}
        >
          <dodecahedronGeometry args={[scrapScale * (0.35 + hash01(i * 9) * 0.4), 0]} />
          <meshStandardMaterial color='#000000' emissive='#b02060' emissiveIntensity={0.55} wireframe />
        </mesh>
      ))}
      {Array.from({ length: palletCount }, (_, i) => (
        <mesh key={`pallet-${i}`} position={[2.4 + (i % 4) * 1.15, 0.19, Math.floor(i / 4) * 1.15]} rotation={[0, (hash01(i * 17) - 0.5) * 0.3, 0]}>
          <boxGeometry args={[0.9, 0.38, 0.9]} />
          <meshStandardMaterial color='#000000' emissive='#7a1a46' emissiveIntensity={0.5} wireframe />
        </mesh>
      ))}
    </group>
  );
}

/** One worker rover: wireframe chassis, four wheels, sensor mast with a glowing eye strip. */
function Rover({ seed, isNight }: { readonly seed: number; readonly isNight: boolean }): React.ReactElement {
  const tint = 0.75 + hash01(seed * 29) * 0.4;
  return (
    <group>
      <mesh position={[0, 0.42, 0]}>
        <boxGeometry args={[0.55, 0.26, 0.8]} />
        <meshStandardMaterial color='#000000' emissive={new THREE.Color('#37e8c2').multiplyScalar(tint)} emissiveIntensity={1} wireframe />
      </mesh>
      {/* Cargo bin on the back. */}
      <mesh position={[0, 0.6, -0.22]}>
        <boxGeometry args={[0.46, 0.14, 0.32]} />
        <meshStandardMaterial {...HOLO_ACCENT} />
      </mesh>
      {/* Wheels. */}
      {[-0.32, 0.32].map((x) =>
        [-0.26, 0.26].map((z) => (
          <mesh key={`wheel-${x}-${z}`} position={[x, 0.16, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.15, 0.15, 0.1, 12]} />
            <meshStandardMaterial {...HOLO_FRAME} />
          </mesh>
        )),
      )}
      {/* Sensor mast + eye strip. */}
      <mesh position={[0, 0.72, 0.24]}>
        <cylinderGeometry args={[0.03, 0.04, 0.34, 6]} />
        <meshStandardMaterial {...HOLO_ACCENT} />
      </mesh>
      <mesh position={[0, 0.92, 0.24]}>
        <boxGeometry args={[0.22, 0.09, 0.14]} />
        <meshStandardMaterial {...HOLO_FRAME} />
      </mesh>
      <mesh position={[0, 0.92, 0.32]}>
        <planeGeometry args={[0.16, 0.03]} />
        <meshStandardMaterial color='#7fd1ff' emissive='#7fd1ff' emissiveIntensity={2.2} />
      </mesh>
      {/* Headlight glow at night (emissive only — real lights are budgeted). */}
      <mesh position={[0, 0.42, 0.42]} visible={isNight}>
        <planeGeometry args={[0.3, 0.08]} />
        <meshStandardMaterial color='#eafff6' emissive='#eafff6' emissiveIntensity={3} />
      </mesh>
    </group>
  );
}

/** Worker rovers shuttling between their own dig sites and the kiln yard. */
function RobotSwarm({ view }: { readonly view: SceneView }): React.ReactElement {
  const groupRef = useRef<THREE.Group>(null);
  const dustRef = useRef<THREE.Points>(null);
  const dustPoolRef = useRef<ParticlePool | null>(null);
  const count = Math.min(40, view.workingRobots);
  const brokenCount = Math.min(8, view.brokenRobots);
  const dustCount = 120;
  const dustPositions = useMemo(() => makeHiddenPositions(dustCount), []);

  useFrame(({ clock }, delta) => {
    const group = groupRef.current;
    if (group === null) {
      return;
    }
    const t = clock.getElapsedTime();
    group.children.forEach((child, i) => {
      // Each rover ping-pongs along its own line between dig site and yard.
      const speed = 0.12 + hash01(i) * 0.1;
      const phase = (t * speed + hash01(i * 7) * 2) % 2;
      const along = phase < 1 ? phase : 2 - phase;
      const eased = along * along * (3 - 2 * along); // smoothstep for accel/decel
      const ax = -9 + hash01(i * 3) * 16;
      const az = -8 + hash01(i * 5) * 13;
      const bx = 6.5 + (hash01(i * 11) - 0.5) * 3;
      const bz = 4.5 + (hash01(i * 13) - 0.5) * 2;
      child.position.x = ax + (bx - ax) * eased;
      child.position.z = az + (bz - az) * eased;
      // Face the direction of travel, flipping on the return leg.
      const heading = Math.atan2(bx - ax, bz - az);
      child.rotation.y = phase < 1 ? heading : heading + Math.PI;
      // Terrain-hugging bob.
      child.position.y = Math.abs(Math.sin(t * 6 + i)) * 0.015;
    });
    // Dust plumes kicked up behind moving rovers: spawn at wheel level, drift
    // downwind, and settle out over a couple of seconds.
    const points = dustRef.current;
    if (points === null) {
      return;
    }
    if (dustPoolRef.current === null) {
      dustPoolRef.current = makeParticlePool(dustCount);
    }
    const pool = dustPoolRef.current;
    const pos = points.geometry.getAttribute('position');
    const { life } = pool;
    if (group.children.length > 0) {
      for (let s = 0; s < 2; s++) {
        const i = pool.cursor % dustCount;
        pool.cursor += 1;
        const seed = pool.spawnSeed;
        pool.spawnSeed += 1;
        const rover = group.children[Math.floor(hash01(seed * 13 + 0.9) * group.children.length)];
        pos.setXYZ(
          i,
          rover.position.x + (hash01(seed * 3 + 0.5) - 0.5) * 0.4,
          0.08,
          rover.position.z + (hash01(seed * 5 + 0.6) - 0.5) * 0.4,
        );
        life[i] = 1.2 + hash01(seed * 7 + 0.7) * 1.2;
      }
    }
    for (let i = 0; i < dustCount; i++) {
      if (life[i] <= 0) {
        continue;
      }
      life[i] -= delta;
      if (life[i] <= 0) {
        pos.setY(i, -50);
        continue;
      }
      pos.setXYZ(i, pos.getX(i) + delta * 0.45, pos.getY(i) + delta * 0.22, pos.getZ(i) + delta * 0.1);
    }
    pos.needsUpdate = true;
  });

  return (
    <group>
      <group ref={groupRef}>
        {Array.from({ length: count }, (_, i) => (
          <group key={`bot-${i}`}>
            <Rover seed={i} isNight={view.isNight} />
          </group>
        ))}
      </group>
      <points ref={dustRef}>
        <bufferGeometry>
          <bufferAttribute attach='attributes-position' args={[dustPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial color='#2a9a8a' size={0.24} transparent opacity={0.18} depthWrite={false} sizeAttenuation />
      </points>
      {/* Broken rovers lie where they fell, near the repair bay, flagged magenta. */}
      {Array.from({ length: brokenCount }, (_, i) => (
        <group key={`down-${i}`} position={[-7 + hash01(i * 11) * 2.5, 0.12, 6 + hash01(i * 13) * 2.5]} rotation={[0.35 + hash01(i) * 0.4, hash01(i * 3) * 6, 0.5]}>
          <mesh>
            <boxGeometry args={[0.55, 0.26, 0.8]} />
            <meshStandardMaterial color='#000000' emissive='#8a1a4a' emissiveIntensity={0.5} wireframe />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** The child seed rising on its own pad: a phosphor-green wireframe, petal by petal. */
function ChildSeed({ view }: { readonly view: SceneView }): React.ReactElement | null {
  const completion = view.childCompletion;
  const walkRef = useRef<THREE.Group>(null);
  const solarTexture = useMemo(() => makeSolarTexture(), []);
  useFrame(({ clock }) => {
    const g = walkRef.current;
    if (g === null) {
      return;
    }
    // When the child wakes, it translates out toward its own horizon.
    const target = view.childWalking ? 1 : 0;
    g.position.x = THREE.MathUtils.lerp(g.position.x, 15 + target * 11, 0.02);
    if (view.childWalking) {
      g.position.y = Math.abs(Math.sin(clock.getElapsedTime() * 2)) * 0.12;
    }
  });
  if (completion < 0.02 && !view.childWalking) {
    return null;
  }
  const height = 0.5 + completion * 3.9;
  const underConstruction = completion < 0.999 && !view.childWalking;
  return (
    <group ref={walkRef} position={[15, 0, -3]}>
      {/* Pad: an etched construction ring. */}
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.35, 3.6, 40]} />
        <meshBasicMaterial color='#1a8f6e' transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      {/* Growing hull, faintly hot at the build line. */}
      <mesh position={[0, height / 2 + 0.1, 0]}>
        <cylinderGeometry args={[1.3, 1.55, height, 22]} />
        <meshStandardMaterial {...HOLO_CHILD} />
      </mesh>
      {/* Fresh print line: a glowing hoop at the top of the growing hull. */}
      {underConstruction ? (
        <mesh position={[0, height + 0.08, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.3 + (1.55 - 1.3) * (1 - completion) * 0.4, 0.045, 8, 36]} />
          <meshStandardMaterial color='#12061c' emissive={PLASMA} emissiveIntensity={view.kilnActive ? 2.8 : 0.3} toneMapped={false} />
        </mesh>
      ) : null}
      {/* Nose cone appears near the end. */}
      {completion > 0.9 ? (
        <mesh position={[0, height + 0.65, 0]}>
          <coneGeometry args={[1.3, 1.1, 22]} />
          <meshStandardMaterial {...HOLO_CHILD} />
        </mesh>
      ) : null}
      {/* Petals appear past 60% completion and open with progress. */}
      {completion > 0.6
        ? Array.from({ length: 6 }, (_, i) => (
            <SolarPetal
              key={`cpetal-${i}`}
              angle={(i / 6) * Math.PI * 2}
              foldAngle={(1 - Math.min(1, (completion - 0.6) / 0.4)) * Math.PI * 0.45}
              length={3}
              width={1.2}
              texture={solarTexture}
            />
          ))
        : null}
      {/* Scaffolding truss ring + crane arm while under construction. */}
      {underConstruction ? (
        <group>
          {[0, 1, 2, 3].map((i) => {
            const a = (i * Math.PI) / 2;
            return (
              <mesh key={`scaf-${i}`} position={[Math.cos(a) * 2.2, 2.4, Math.sin(a) * 2.2]}>
                <boxGeometry args={[0.09, 4.8, 0.09]} />
                <meshStandardMaterial {...HOLO_FRAME} />
              </mesh>
            );
          })}
          <mesh position={[0, 4.85, 0]} rotation={[0, Math.PI / 4, 0]}>
            <boxGeometry args={[6.4, 0.09, 0.09]} />
            <meshStandardMaterial {...HOLO_FRAME} />
          </mesh>
          <mesh position={[1.1, 4.5, 1.1]} rotation={[0, -Math.PI / 4, 0.5]}>
            <boxGeometry args={[2.6, 0.08, 0.08]} />
            <meshStandardMaterial {...HOLO_ACCENT} />
          </mesh>
        </group>
      ) : null}
      {/* Wake glow: the child breathes once alive. */}
      {view.childWalking ? (
        <mesh position={[0, height + 1.4, 0]}>
          <sphereGeometry args={[0.09, 12, 12]} />
          <meshStandardMaterial color='#2bff9e' emissive='#2bff9e' emissiveIntensity={3} />
        </mesh>
      ) : null}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* The colony: descendant seeds filling the plain                      */
/* ------------------------------------------------------------------ */

/** Hard cap on instanced colony seeds (well past anything a run produces). */
const COLONY_MAX = 128;

/** Deterministic golden-angle spiral placement for descendant seed n. */
function colonySeedSite(index: number): { readonly x: number; readonly z: number; readonly rotY: number; readonly scale: number } {
  const angle = index * 2.399963 + 0.9; // golden angle keeps neighbours apart
  const radius = 24 + 4.6 * Math.sqrt(index + 1);
  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    rotY: hash01(index * 31) * Math.PI * 2,
    scale: 0.85 + hash01(index * 37) * 0.25,
  };
}

/**
 * Every woken generation stands on the plain as its own seed: instanced
 * pads, hulls, nose cones, six glowing solar petals each, and a blinking nav
 * beacon. Four draw calls total no matter how many generations chain, so
 * takeoff is visible — the horizon literally fills with wireframe flowers.
 */
function Colony({ view }: { readonly view: SceneView }): React.ReactElement {
  const padRef = useRef<THREE.InstancedMesh>(null);
  const hullRef = useRef<THREE.InstancedMesh>(null);
  const noseRef = useRef<THREE.InstancedMesh>(null);
  const petalRef = useRef<THREE.InstancedMesh>(null);
  const beaconRef = useRef<THREE.InstancedMesh>(null);
  const beaconMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const count = Math.min(COLONY_MAX, view.colonyCount);

  useEffect(() => {
    const pad = padRef.current;
    const hull = hullRef.current;
    const nose = noseRef.current;
    const petal = petalRef.current;
    const beacon = beaconRef.current;
    if (pad === null || hull === null || nose === null || petal === null || beacon === null) {
      return;
    }
    const seedTransform = new THREE.Object3D();
    const part = new THREE.Object3D();
    const composed = new THREE.Matrix4();
    /** Compose seed-level transform × part-local transform into `composed`. */
    const place = (px: number, py: number, pz: number, ry: number): THREE.Matrix4 => {
      part.position.set(px, py, pz);
      part.rotation.set(0, ry, 0);
      part.scale.setScalar(1);
      part.updateMatrix();
      composed.multiplyMatrices(seedTransform.matrix, part.matrix);
      return composed;
    };
    for (let i = 0; i < count; i++) {
      const site = colonySeedSite(i);
      seedTransform.position.set(site.x, terrainHeight(site.x, site.z), site.z);
      seedTransform.rotation.set(0, site.rotY, 0);
      seedTransform.scale.setScalar(site.scale);
      seedTransform.updateMatrix();
      pad.setMatrixAt(i, place(0, 0.04, 0, 0));
      hull.setMatrixAt(i, place(0, 1.8, 0, 0));
      nose.setMatrixAt(i, place(0, 4.0, 0, 0));
      beacon.setMatrixAt(i, place(0, 4.62, 0, 0));
      for (let p = 0; p < 6; p++) {
        const petalAngle = (p / 6) * Math.PI * 2;
        petal.setMatrixAt(
          i * 6 + p,
          place(Math.cos(petalAngle) * 2.7, 0.35, Math.sin(petalAngle) * 2.7, -petalAngle + Math.PI / 2),
        );
      }
    }
    pad.count = count;
    hull.count = count;
    nose.count = count;
    beacon.count = count;
    petal.count = count * 6;
    pad.instanceMatrix.needsUpdate = true;
    hull.instanceMatrix.needsUpdate = true;
    nose.instanceMatrix.needsUpdate = true;
    petal.instanceMatrix.needsUpdate = true;
    beacon.instanceMatrix.needsUpdate = true;
  }, [count]);

  useFrame(({ clock }) => {
    // All colony beacons breathe in unison: a heartbeat you can see at night.
    const material = beaconMatRef.current;
    if (material !== null) {
      material.emissiveIntensity = 1.6 + Math.sin(clock.getElapsedTime() * 2.2) * 1.2;
    }
  });

  return (
    <group>
      <instancedMesh ref={padRef} args={[undefined, undefined, COLONY_MAX]}>
        <cylinderGeometry args={[2.6, 2.8, 0.08, 20]} />
        <meshStandardMaterial color='#000000' emissive='#0e4a40' emissiveIntensity={0.8} wireframe />
      </instancedMesh>
      <instancedMesh ref={hullRef} args={[undefined, undefined, COLONY_MAX]}>
        <cylinderGeometry args={[1.15, 1.35, 3.4, 18]} />
        <meshStandardMaterial {...HOLO_HULL} />
      </instancedMesh>
      <instancedMesh ref={noseRef} args={[undefined, undefined, COLONY_MAX]}>
        <coneGeometry args={[1.15, 1.0, 18]} />
        <meshStandardMaterial {...HOLO_HULL} />
      </instancedMesh>
      <instancedMesh ref={petalRef} args={[undefined, undefined, COLONY_MAX * 6]}>
        <boxGeometry args={[2.6, 0.05, 1.1]} />
        <meshStandardMaterial color='#000000' emissive='#0d5a72' emissiveIntensity={0.8} />
      </instancedMesh>
      <instancedMesh ref={beaconRef} args={[undefined, undefined, COLONY_MAX]}>
        <sphereGeometry args={[0.08, 10, 10]} />
        <meshStandardMaterial ref={beaconMatRef} color='#ff3d8a' emissive='#ff3d8a' emissiveIntensity={1.6} />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Resupply: descent, touchdown, and cargo pods                        */
/* ------------------------------------------------------------------ */

/** Landing-zone slot for the n-th cargo pod, southeast of the work pad. */
function podSlot(index: number): { readonly x: number; readonly z: number } {
  return {
    x: 11 + (index % 3) * 2.8 + hash01(index * 7 + 0.2) * 0.9,
    z: -9 - Math.floor(index / 3) * 2.8 - hash01(index * 9 + 0.3) * 0.9,
  };
}

/** One landed cargo pod: squat hull, legs, an emissive cargo band, an antenna. */
function CargoPod({ index }: { readonly index: number }): React.ReactElement {
  const slot = podSlot(index);
  const y = terrainHeight(slot.x, slot.z);
  return (
    <group position={[slot.x, y, slot.z]} rotation={[0, hash01(index * 13) * Math.PI * 2, 0]}>
      <mesh position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.85, 1.0, 1.5, 14]} />
        <meshStandardMaterial {...HOLO_HULL} />
      </mesh>
      <mesh position={[0, 1.75, 0]}>
        <coneGeometry args={[0.85, 0.55, 14]} />
        <meshStandardMaterial {...HOLO_FRAME} />
      </mesh>
      {/* Cargo status band: still-powered avionics. */}
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[1.005, 1.005, 0.12, 14, 1, true]} />
        <meshStandardMaterial color='#03140c' emissive='#2bff9e' emissiveIntensity={0.9} side={THREE.DoubleSide} />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        return (
          <mesh key={`podleg-${i}`} position={[Math.cos(a) * 1.05, 0.35, Math.sin(a) * 1.05]} rotation={[0, -a, 0.5]}>
            <cylinderGeometry args={[0.05, 0.07, 1.0, 6]} />
            <meshStandardMaterial {...HOLO_FRAME} />
          </mesh>
        );
      })}
      <mesh position={[0, 2.2, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.5, 4]} />
        <meshStandardMaterial {...HOLO_ACCENT} />
      </mesh>
    </group>
  );
}

/** All cargo pods delivered so far, accumulating in the landing zone. */
function CargoPods({ view }: { readonly view: SceneView }): React.ReactElement {
  return (
    <group>
      {Array.from({ length: Math.min(9, view.resupplyCount) }, (_, i) => (
        <CargoPod key={`pod-${i}`} index={i} />
      ))}
    </group>
  );
}

/**
 * A resupply lander on final approach: it rides a retropropulsion flame down
 * to the next pod slot, kicking up a dust skirt in the last meters. The
 * flame is HDR so the bloom pass turns touchdown into an event.
 */
function ResupplyLander({ view }: { readonly view: SceneView }): React.ReactElement | null {
  const progress = view.resupplyDescent;
  if (progress === null) {
    return null;
  }
  const slot = podSlot(view.resupplyCount);
  const groundY = terrainHeight(slot.x, slot.z);
  const altitude = Math.pow(1 - progress, 1.7) * 55;
  const flame = Math.min(1, altitude / 6 + 0.35); // throttle down near the ground
  const dustSkirt = THREE.MathUtils.clamp(1 - altitude / 5, 0, 1);
  return (
    <group position={[slot.x + altitude * 0.12, groundY + altitude, slot.z - altitude * 0.08]}>
      {/* Airframe: same pod that will remain on the surface. */}
      <mesh position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.85, 1.0, 1.5, 14]} />
        <meshStandardMaterial {...HOLO_HULL} />
      </mesh>
      <mesh position={[0, 1.75, 0]}>
        <coneGeometry args={[0.85, 0.55, 14]} />
        <meshStandardMaterial {...HOLO_FRAME} />
      </mesh>
      {/* Retropropulsion: HDR flame cone + light. */}
      <mesh position={[0, -0.35, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.34 * flame, 1.6 * flame, 12, 1, true]} />
        <meshBasicMaterial
          color={new THREE.Color('#8ad9ff').multiplyScalar(4)}
          transparent
          opacity={0.85}
          toneMapped={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
      <pointLight position={[0, -0.6, 0]} intensity={30 * flame} distance={22} decay={1.7} color='#8ad9ff' />
      {/* Dust skirt blown out radially in the final meters. */}
      {dustSkirt > 0 ? (
        <mesh position={[0, -altitude + 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.6 + dustSkirt * 2.2, 1.4 + dustSkirt * 4.2, 24]} />
          <meshBasicMaterial color='#2bff9e' transparent opacity={0.22 * dustSkirt} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ) : null}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Camera, director mode, composition, and export                      */
/* ------------------------------------------------------------------ */

/** One director shot: where the camera should be, what it should look at, and its caption. */
interface DirectorShot {
  readonly label: string;
  readonly target: THREE.Vector3;
  readonly camera: THREE.Vector3;
}

/** Mutable per-session director bookkeeping (lives in a ref, not React state). */
interface DirectorMemory {
  /** Colony population last frame, to detect a fresh generation wake. */
  lastColonyCount: number;
  /** Scene-clock time until which the newest-seed shot holds, or -1. */
  colonyPulseUntil: number;
  /** Index of the colony seed being framed by the pulse shot. */
  colonyTargetIndex: number;
}

/**
 * The director's current caption, shared with the HUD overlay via a
 * module-scope mutable (the overlay polls it — writing store state from
 * useFrame at 60 Hz would be waste).
 */
const DIRECTOR_STATUS = { label: '' };

/** Seconds each shot of the idle rotation holds before the director cuts. */
const DIRECTOR_CUT_SECONDS = 14;

/**
 * Pick the shot the director wants this frame. Event coverage outranks the
 * idle rotation: a descending resupply lander, a waking child, or a freshly
 * onlined colony seed always takes the camera; otherwise the director cycles
 * through whichever standing shots currently have something to show.
 */
function computeAutoShot(view: SceneView, t: number, memory: DirectorMemory): DirectorShot {
  // Detect a new colony seed coming online and hold on it for a few seconds.
  if (memory.lastColonyCount === -1) {
    memory.lastColonyCount = view.colonyCount; // first frame in auto: no pulse
  } else if (view.colonyCount > memory.lastColonyCount) {
    memory.colonyTargetIndex = view.colonyCount - 1;
    memory.colonyPulseUntil = t + 7;
    memory.lastColonyCount = view.colonyCount;
  } else if (view.colonyCount < memory.lastColonyCount) {
    memory.lastColonyCount = view.colonyCount; // new game reset
    memory.colonyPulseUntil = -1;
  }

  // 1 — a resupply lander on final approach: track it all the way down.
  if (view.resupplyDescent !== null) {
    const slot = podSlot(view.resupplyCount);
    const ground = terrainHeight(slot.x, slot.z);
    const altitude = Math.pow(1 - view.resupplyDescent, 1.7) * 55;
    return {
      label: 'TRACKING · RESUPPLY LANDER',
      target: new THREE.Vector3(slot.x, ground + altitude * 0.55 + 1, slot.z),
      camera: new THREE.Vector3(slot.x + 13, ground + altitude * 0.35 + 7, slot.z + 13),
    };
  }

  // 2 — a woken child walking off to its own pad.
  if (view.childWalking) {
    return {
      label: 'TRACKING · GENERATION WAKE',
      target: new THREE.Vector3(21, 1.6, -3),
      camera: new THREE.Vector3(26, 4.5, 7),
    };
  }

  // 3 — a new colony seed just came online out on the plain.
  if (t < memory.colonyPulseUntil) {
    const site = colonySeedSite(memory.colonyTargetIndex);
    const y = terrainHeight(site.x, site.z);
    // Approach from beyond the seed, looking back toward the factory.
    const outward = Math.hypot(site.x, site.z);
    const ux = outward > 0.001 ? site.x / outward : 1;
    const uz = outward > 0.001 ? site.z / outward : 0;
    return {
      label: 'TRACKING · NEW SEED ONLINE',
      target: new THREE.Vector3(site.x, y + 2.4, site.z),
      camera: new THREE.Vector3(site.x + ux * 11 + 3, y + 6, site.z + uz * 11 - 3),
    };
  }

  // 4 — a serious storm: pull wide and watch the horizon close in.
  if (view.stormIntensity > 0.5) {
    const a = t * 0.03;
    return {
      label: 'MONITORING · DUST STORM',
      target: new THREE.Vector3(0, 4, 0),
      camera: new THREE.Vector3(Math.cos(a) * 34, 17, Math.sin(a) * 34),
    };
  }

  // Idle rotation: only shots with something on them are in the reel.
  const reel: DirectorShot[] = [];
  const orbit = t * 0.045;
  reel.push({
    label: 'FACTORY OVERWATCH',
    target: new THREE.Vector3(0, 2.2, 0),
    camera: new THREE.Vector3(Math.cos(orbit) * 24, 11, Math.sin(orbit) * 24),
  });
  if (view.kilnActive) {
    reel.push({
      label: 'PRINT YARD',
      target: new THREE.Vector3(6.5, 1.2, 4.5),
      camera: new THREE.Vector3(11.5, 4.5, 10.5),
    });
  }
  if (view.childCompletion > 0.02 && view.childCompletion < 0.999) {
    reel.push({
      label: 'CHILD ASSEMBLY',
      target: new THREE.Vector3(15, 1.8, -3),
      camera: new THREE.Vector3(20.5, 5, 3.5),
    });
  }
  if (view.colonyCount > 2) {
    reel.push({
      label: 'THE COLONY',
      target: new THREE.Vector3(5, 0, 0),
      camera: new THREE.Vector3(42, 34, 42),
    });
  }
  return reel[Math.floor(t / DIRECTOR_CUT_SECONDS) % reel.length];
}

/**
 * Frame one mission-reel beat. The scrubber has already jumped the scene to
 * the beat's sol, so the shot only has to point at the right subject: the
 * pad for the landing, the newest colony seed for a wake, the cargo zone for
 * a touchdown, wide for storms, high for doublings.
 */
function computeReelShot(beat: ReelBeat, view: SceneView, t: number): DirectorShot {
  const orbit = t * 0.06;
  switch (beat.kind) {
    case 'landing':
    case 'solar-deployed':
      // Close on the parent as it unfolds.
      return {
        label: beat.message,
        target: new THREE.Vector3(0, 2.5, 0),
        camera: new THREE.Vector3(Math.cos(orbit) * 14, 7, Math.sin(orbit) * 14),
      };
    case 'chassis-started':
      return {
        label: beat.message,
        target: new THREE.Vector3(15, 1.8, -3),
        camera: new THREE.Vector3(21, 5, 4),
      };
    case 'child-wake': {
      // At this snapshot the woken generation stands as the newest colony seed.
      const index = Math.max(0, view.colonyCount - 1);
      const site = colonySeedSite(index);
      const y = terrainHeight(site.x, site.z);
      const outward = Math.hypot(site.x, site.z);
      const ux = outward > 0.001 ? site.x / outward : 1;
      const uz = outward > 0.001 ? site.z / outward : 0;
      return {
        label: beat.message,
        target: new THREE.Vector3(site.x, y + 2.4, site.z),
        camera: new THREE.Vector3(site.x + ux * 11 + 3, y + 6, site.z + uz * 11 - 3),
      };
    }
    case 'storm-start':
    case 'storm-end':
      return {
        label: beat.message,
        target: new THREE.Vector3(0, 4, 0),
        camera: new THREE.Vector3(Math.cos(orbit * 0.5) * 34, 17, Math.sin(orbit * 0.5) * 34),
      };
    case 'resupply': {
      // Frame the cargo zone with whatever pods had landed by this sol.
      const slot = podSlot(Math.max(0, view.resupplyCount - 1));
      return {
        label: beat.message,
        target: new THREE.Vector3(slot.x, 1.2, slot.z),
        camera: new THREE.Vector3(slot.x + 8, 5.5, slot.z + 9),
      };
    }
    default:
      // Doublings, missed windows, anything else: the high overwatch.
      return {
        label: beat.message,
        target: new THREE.Vector3(0, 2.2, 0),
        camera: new THREE.Vector3(Math.cos(orbit * 0.6) * 26, 14, Math.sin(orbit * 0.6) * 26),
      };
  }
}

/**
 * Camera rig: eases the orbit target toward the focus selection, or — in
 * Auto — hands the camera to the director, which tracks events and otherwise
 * runs a slow rotation of standing shots. A running mission reel outranks
 * both. Manual orbiting is disabled while the machine has the camera.
 */
function CameraRig({ view }: { readonly view: SceneView }): React.ReactElement {
  const focus = useSimStore((s) => s.focus);
  const reelBeats = useSimStore((s) => s.reelBeats);
  const reelIndex = useSimStore((s) => s.reelIndex);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const memoryRef = useRef<DirectorMemory>({ lastColonyCount: -1, colonyPulseUntil: -1, colonyTargetIndex: 0 });
  useFrame(({ camera, clock }) => {
    const controls = controlsRef.current;
    if (controls === null) {
      return;
    }
    if (reelBeats !== null && reelIndex < reelBeats.length) {
      // Faster easing than the live director: reel cuts should feel like cuts.
      DIRECTOR_STATUS.label = ''; // the reel overlay carries the caption
      const shot = computeReelShot(reelBeats[reelIndex], view, clock.getElapsedTime());
      controls.target.lerp(shot.target, 0.06);
      camera.position.lerp(shot.camera, 0.045);
      controls.update();
      return;
    }
    if (focus === 'auto') {
      const shot = computeAutoShot(view, clock.getElapsedTime(), memoryRef.current);
      DIRECTOR_STATUS.label = shot.label;
      controls.target.lerp(shot.target, 0.035);
      camera.position.lerp(shot.camera, 0.02);
      controls.update();
      return;
    }
    DIRECTOR_STATUS.label = '';
    memoryRef.current.lastColonyCount = -1; // re-arm wake detection for next auto session
    const target =
      focus === 'child' ? new THREE.Vector3(15, 2, -3) : focus === 'field' ? new THREE.Vector3(6, 0, 0) : new THREE.Vector3(0, 2.2, 0);
    controls.target.lerp(target, 0.04);
    if (focus === 'field') {
      camera.position.lerp(new THREE.Vector3(40, 46, 40), 0.02);
    }
    controls.update();
  });
  return (
    <OrbitControls
      ref={controlsRef}
      enabled={focus !== 'auto' && reelBeats === null}
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={Math.PI * 0.49}
      minDistance={6}
      maxDistance={80}
    />
  );
}

/**
 * Letterbox + caption while the mission reel plays: cinematic bars, a beat
 * counter, and the sim's own event text as the subtitle. Clicking anywhere
 * on the overlay is not needed — the bottom-bar Reel button stops it.
 */
function ReelOverlay(): React.ReactElement | null {
  const reelBeats = useSimStore((s) => s.reelBeats);
  const reelIndex = useSimStore((s) => s.reelIndex);
  const siteId = useSimStore((s) => s.state.siteId);
  if (reelBeats === null || reelIndex >= reelBeats.length) {
    return null;
  }
  const beat = reelBeats[reelIndex];
  const unit = siteId === 'mars' ? 'Sol' : 'Day';
  return (
    <>
      {/* Cinematic bars. The scene background is near-black, so solid bars read as letterbox. */}
      <div className='pointer-events-none absolute inset-x-0 top-0 h-10 bg-background' aria-hidden='true' />
      <div className='pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-background' aria-hidden='true' />
      <div className='pointer-events-none absolute left-3 top-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-ice'>
        <span className='inline-block h-2 w-2 rounded-full bg-ice animate-pulse' aria-hidden='true' />
        Replay
      </div>
      <div className='pointer-events-none absolute inset-x-0 bottom-2 flex flex-col items-center gap-1 px-6 text-center'>
        <span className='text-[10px] uppercase tracking-[0.3em] text-ice'>
          Mission reel · {unit} {beat.sol} · {reelIndex + 1}/{reelBeats.length}
        </span>
        <span className='text-[12px] leading-tight text-foreground'>{beat.message}</span>
      </div>
    </>
  );
}

/** The "◉ TRACKING …" caption shown while the director has the camera. */
function DirectorCaption(): React.ReactElement | null {
  const focus = useSimStore((s) => s.focus);
  const [label, setLabel] = useState('');
  useEffect(() => {
    // Poll the module-scope status at 4 Hz — cheap, and captions don't need 60 fps.
    const id = window.setInterval(() => setLabel(DIRECTOR_STATUS.label), 250);
    return () => window.clearInterval(id);
  }, []);
  if (focus !== 'auto' || label === '') {
    return null;
  }
  return (
    <div className='pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-phos'>
      <span className='inline-block h-2 w-2 rounded-full bg-phos animate-pulse' aria-hidden='true' />
      {label}
    </div>
  );
}

/** Scene contents (inside Canvas). */
function SceneContents(): React.ReactElement {
  const state = useSimStore((s) => s.state);
  const scrubSol = useSimStore((s) => s.scrubSol);
  const view = useMemo(() => selectView(state, scrubSol), [state, scrubSol]);
  return (
    <>
      <color attach='background' args={['#010409']} />
      <Environment view={view} />
      <ParentSeed view={view} />
      <ScrapYard view={view} />
      <RobotSwarm view={view} />
      <ChildSeed view={view} />
      <Colony view={view} />
      <CargoPods view={view} />
      <ResupplyLander view={view} />
      <CameraRig view={view} />
      {/* Post pipeline: bloom lifts every hologram edge and HDR emissive
          (kiln plasma, arcs, embers, flame); scanlines + grain make the feed
          read as a CRT; the vignette frames the shot. */}
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.5} luminanceSmoothing={0.4} levels={7} />
        <Scanline density={1.1} opacity={0.05} />
        <Noise premultiply opacity={0.12} />
        <Vignette eskil={false} offset={0.16} darkness={0.75} />
      </EffectComposer>
    </>
  );
}

/** The exported center viewport, with a subtle HUD frame overlay. */
export function SeedScene(): React.ReactElement {
  return (
    <div className='relative flex-1 min-w-0'>
      <Canvas camera={{ position: [16, 12, 18], fov: 42 }} dpr={[1, 2]} gl={{ antialias: false }}>
        <SceneContents />
      </Canvas>
      {/* Non-interactive viewport dressing: phosphor corner brackets + vignette. */}
      <div className='pointer-events-none absolute inset-0 viewport-frame' aria-hidden='true' />
      <DirectorCaption />
      <ReelOverlay />
    </div>
  );
}
