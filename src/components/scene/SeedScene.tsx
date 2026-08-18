/**
 * The center 3D view: an orbitable cinematic cutaway of the living seed.
 *
 * Everything visible is driven by sim state — printers print printer parts,
 * rovers shuttle ore, the kiln mouth breathes orange, scrap piles up as
 * visible shame, and the child seed rises on the neighbouring pad until it
 * unfolds like a stainless flower and walks. Mars stays red. Earth stays Earth.
 *
 * Rendering approach: honest low-poly industrial geometry, procedural
 * deterministic terrain, HDR emissives picked up by a bloom pass, and a
 * handful of carefully-budgeted lights. No textures are fetched — the solar
 * cell grid is painted onto a CanvasTexture at mount.
 */

'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Billboard } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useSimStore } from '@/store/useSimStore';
import { selectView } from '@/components/view';
import type { SceneView } from '@/components/view';

/* ------------------------------------------------------------------ */
/* Shared materials & deterministic noise                              */
/* ------------------------------------------------------------------ */

/** Stainless material props shared across factory geometry. */
const STAINLESS = { color: '#aab3bc', metalness: 0.92, roughness: 0.28 };
/** Darker structural steel. */
const DARK_STEEL = { color: '#454c55', metalness: 0.75, roughness: 0.45 };
/** Anodized accent used on masts and toolheads. */
const ANODIZED = { color: '#2b3742', metalness: 0.6, roughness: 0.35 };

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

/** Paint a photovoltaic cell grid onto a CanvasTexture (client only). */
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
  // Deep-blue cell field with a faint diagonal sheen.
  const grad = ctx.createLinearGradient(0, 0, 256, 128);
  grad.addColorStop(0, '#101a30');
  grad.addColorStop(0.5, '#1a2a4a');
  grad.addColorStop(1, '#0d1526');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 128);
  // Cell grid lines.
  ctx.strokeStyle = 'rgba(150,180,230,0.35)';
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
  ctx.strokeStyle = 'rgba(150,180,230,0.12)';
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
/* Terrain, sky, and weather                                           */
/* ------------------------------------------------------------------ */

/** Procedurally displaced regolith with vertex-colored dunes and a compacted pad. */
function Terrain({ isMars }: { readonly isMars: boolean }): React.ReactElement {
  const geometry = useMemo(() => {
    const size = 260;
    const segments = 128;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const base = isMars ? new THREE.Color('#6b3a20') : new THREE.Color('#41463b');
    const high = isMars ? new THREE.Color('#9c5a30') : new THREE.Color('#5a6050');
    const low = isMars ? new THREE.Color('#3c1f10') : new THREE.Color('#2b2f27');
    const pad = isMars ? new THREE.Color('#4d2c18') : new THREE.Color('#33372e');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const dist = Math.hypot(x, z);
      // Flatten the working pad; dunes rise beyond it.
      const padMask = THREE.MathUtils.smoothstep(dist, 16, 44);
      const n = terrainNoise(x, z);
      const y = n * 3.4 * padMask + Math.max(0, dist - 90) * 0.055;
      pos.setY(i, y);
      // Color by height with a hint of per-vertex grain.
      const t = THREE.MathUtils.clamp(0.5 + n * 0.55, 0, 1);
      c.copy(low).lerp(high, t);
      c.lerp(base, 0.35);
      c.lerp(pad, 1 - padMask);
      const grain = 0.94 + hash01(i) * 0.12;
      colors[i * 3] = c.r * grain;
      colors[i * 3 + 1] = c.g * grain;
      colors[i * 3 + 2] = c.b * grain;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, [isMars]);

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors roughness={1} metalness={0} />
    </mesh>
  );
}

/** Distant mesas / hills fading into the atmospheric haze. */
function DistantRelief({ isMars }: { readonly isMars: boolean }): React.ReactElement {
  const color = isMars ? '#54290f' : '#2e332b';
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
            <meshStandardMaterial color={color} roughness={1} flatShading />
          </mesh>
        );
      })}
    </group>
  );
}

/** Wind-borne dust: a drifting particle field whose density tracks the storm. */
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
    // Baseline haze on Mars even on quiet sols; ramps hard in a storm.
    const baseline = view.siteId === 'mars' ? 0.06 : 0.02;
    material.opacity = THREE.MathUtils.lerp(material.opacity, baseline + storm * 0.5, 0.05);
    material.size = 0.16 + storm * 0.22;
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
        color={view.siteId === 'mars' ? '#c4805a' : '#9aa08e'}
        size={0.18}
        transparent
        opacity={0}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

/** The visible sun disc: an HDR-bright billboard that bloom turns into a glare. */
function SunDisc({
  sunDirection,
  sunHeight,
  storm,
  isMars,
}: {
  readonly sunDirection: THREE.Vector3;
  readonly sunHeight: number;
  readonly storm: number;
  readonly isMars: boolean;
}): React.ReactElement | null {
  if (sunHeight <= 0.01) {
    return null;
  }
  const position = sunDirection.clone().multiplyScalar(150);
  // On Mars the sun is visually ~2/3 the size it is from Earth.
  const radius = isMars ? 4.2 : 6.2;
  const brightness = Math.max(0.2, (1 - storm * 0.85) * 5);
  return (
    <Billboard position={[position.x, position.y, position.z]}>
      <mesh>
        <circleGeometry args={[radius, 32]} />
        <meshBasicMaterial color={new THREE.Color('#fff3dd').multiplyScalar(brightness)} fog={false} toneMapped={false} />
      </mesh>
      <mesh>
        <circleGeometry args={[radius * 2.6, 32]} />
        <meshBasicMaterial color={isMars ? '#d9a06a' : '#f4e0b8'} transparent opacity={0.16 * (1 - storm)} fog={false} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}

/** Terrain + atmosphere + sun + stars, driven by site, time of sol, and storm. */
function Environment({ view }: { readonly view: SceneView }): React.ReactElement {
  const isMars = view.siteId === 'mars';
  const dayFrac = view.hourOfSol / view.solLengthHours;
  const sunAngle = (dayFrac - 0.25) * Math.PI * 2; // noon overhead
  const sunHeight = Math.sin(sunAngle);
  const storm = view.stormIntensity;
  const sunDirection = useMemo(
    () => new THREE.Vector3(Math.cos(sunAngle), Math.max(0.04, sunHeight), 0.38).normalize(),
    [sunAngle, sunHeight],
  );
  const sunIntensity = Math.max(0, sunHeight) * (1 - storm * 0.9) * (isMars ? 2.4 : 3.4);

  // Sky blends: day tint → dusk band near the horizon → deep night, all dimmed by storm.
  const duskAmount = THREE.MathUtils.clamp(1 - Math.abs(sunHeight) * 4, 0, 1);
  const nightAmount = THREE.MathUtils.clamp(-sunHeight * 5, 0, 1);
  const skyColor = useMemo(() => {
    const day = isMars ? new THREE.Color('#c07a48') : new THREE.Color('#8fb2d4');
    const dusk = isMars ? new THREE.Color('#5a5f8a') : new THREE.Color('#d47a4a');
    const night = isMars ? new THREE.Color('#0a0504') : new THREE.Color('#04070e');
    const stormTint = isMars ? new THREE.Color('#7a4426') : new THREE.Color('#4a4d42');
    const c = day.clone().lerp(dusk, duskAmount * 0.7).lerp(night, nightAmount);
    c.lerp(stormTint, storm * (1 - nightAmount) * 0.75);
    return c;
  }, [isMars, duskAmount, nightAmount, storm]);
  const fogDistance = 130 - storm * 95;

  return (
    <group>
      <color attach='background' args={[skyColor]} />
      <fog attach='fog' args={[skyColor, 12, Math.max(24, fogDistance)]} />
      {/* Stars pierce through on clear nights only. */}
      <group visible={nightAmount > 0.5 && storm < 0.4}>
        <Stars radius={160} depth={50} count={3500} factor={3.2} saturation={0} fade speed={0.4} />
      </group>
      <SunDisc sunDirection={sunDirection} sunHeight={sunHeight} storm={storm} isMars={isMars} />
      {/* Key light: the sun, with a tight shadow frustum over the pad. */}
      <directionalLight
        position={[sunDirection.x * 40, sunDirection.y * 40, sunDirection.z * 40]}
        intensity={sunIntensity}
        color={isMars ? '#ffd9b3' : '#fff4e0'}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-32}
        shadow-camera-right={32}
        shadow-camera-top={32}
        shadow-camera-bottom={-32}
        shadow-camera-near={2}
        shadow-camera-far={110}
        shadow-bias={-0.0004}
      />
      {/* Sky/ground bounce fill. */}
      <hemisphereLight
        args={[isMars ? '#b07044' : '#9db4cc', isMars ? '#3c1f10' : '#23261f', view.isNight ? 0.06 : 0.35 * (1 - storm * 0.6)]}
      />
      <ambientLight intensity={view.isNight ? 0.05 : 0.1} color={isMars ? '#c98a5e' : '#a8b6c8'} />
      {/* Night shift: mast work lights with visible beam cones. */}
      <group visible={view.isNight}>
        <WorkMast position={[5, 0, 3.5]} />
        <WorkMast position={[-6, 0, -3]} />
      </group>
      <Terrain isMars={isMars} />
      <DistantRelief isMars={isMars} />
      <StormDust view={view} />
      {/* Scattered boulders on the pad fringe. */}
      {Array.from({ length: 30 }, (_, i) => {
        const r = 16 + hash01(i) * 55;
        const a = i * 2.4;
        return (
          <mesh key={`rock-${i}`} position={[Math.cos(a) * r, 0.12 + hash01(i * 7) * 0.1, Math.sin(a) * r]} rotation={[hash01(i * 3) * 3, hash01(i * 5) * 3, 0]} castShadow>
            <dodecahedronGeometry args={[0.18 + hash01(i * 7) * 0.55, 0]} />
            <meshStandardMaterial color={isMars ? '#4a2413' : '#2e3229'} roughness={1} flatShading />
          </mesh>
        );
      })}
    </group>
  );
}

/** A floodlight mast with an emissive head, a real light, and a fake volumetric cone. */
function WorkMast({ position }: { readonly position: readonly [number, number, number] }): React.ReactElement {
  return (
    <group position={[position[0], position[1], position[2]]}>
      <mesh position={[0, 3.4, 0]}>
        <cylinderGeometry args={[0.06, 0.1, 6.8, 8]} />
        <meshStandardMaterial {...ANODIZED} />
      </mesh>
      <mesh position={[0, 6.8, 0]}>
        <boxGeometry args={[0.55, 0.22, 0.3]} />
        <meshStandardMaterial color='#e8f0ff' emissive='#dfeaff' emissiveIntensity={4} />
      </mesh>
      <pointLight position={[0, 6.6, 0]} intensity={26} distance={26} decay={1.6} color='#dfeaff' />
      {/* Fake light cone (additive, non-writing). */}
      <mesh position={[0, 3.5, 0]}>
        <coneGeometry args={[3.4, 6.6, 20, 1, true]} />
        <meshBasicMaterial color='#aac4ff' transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* The factory                                                         */
/* ------------------------------------------------------------------ */

/** One unfolding solar wing with a painted cell texture. */
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
        <mesh position={[length / 2, 0.03, 0]} receiveShadow castShadow>
          <boxGeometry args={[length, 0.06, width]} />
          {texture !== null ? (
            <meshStandardMaterial map={texture} metalness={0.55} roughness={0.3} emissive='#16244a' emissiveIntensity={0.25} />
          ) : (
            <meshStandardMaterial color='#1a2a4a' metalness={0.55} roughness={0.3} emissive='#16244a' emissiveIntensity={0.25} />
          )}
        </mesh>
        {/* Spine truss under the wing. */}
        <mesh position={[length / 2, -0.06, 0]}>
          <boxGeometry args={[length, 0.05, 0.12]} />
          <meshStandardMaterial {...DARK_STEEL} />
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
      {/* Scorched landing ring under the hull. */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[4.6, 40]} />
        <meshStandardMaterial color='#17120d' roughness={1} />
      </mesh>
      {/* Core: the landed pressure hull with ring stiffeners. */}
      <mesh position={[0, 2.3, 0]} castShadow>
        <cylinderGeometry args={[1.6, 1.9, 4.4, 28]} />
        <meshStandardMaterial {...STAINLESS} />
      </mesh>
      {[1.1, 2.3, 3.5].map((y) => (
        <mesh key={`ring-${y}`} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.62 + (2.3 - y) * 0.055, 0.05, 8, 32]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
      ))}
      <mesh position={[0, 4.9, 0]} castShadow>
        <coneGeometry args={[1.6, 1.3, 28]} />
        <meshStandardMaterial {...STAINLESS} />
      </mesh>
      {/* Nav beacon at the tip — always breathing so the seed reads alive. */}
      <mesh position={[0, 5.7, 0]}>
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshStandardMaterial color='#ff3b30' emissive='#ff3b30' emissiveIntensity={2.6} />
      </mesh>
      {/* Comms dish tracking Earthward. */}
      <group position={[0.9, 4.4, 0.9]} rotation={[0.5, 0.8, 0]}>
        <mesh>
          <sphereGeometry args={[0.5, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.4]} />
          <meshStandardMaterial {...STAINLESS} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.5, 6]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
      </group>
      {/* Airlock hatch with a lit porthole. */}
      <mesh position={[0, 1.4, 1.82]} rotation={[0.06, 0, 0]}>
        <boxGeometry args={[0.8, 1.1, 0.12]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      <mesh position={[0, 1.55, 1.9]}>
        <circleGeometry args={[0.14, 16]} />
        <meshStandardMaterial color='#ffd9a0' emissive='#ffc873' emissiveIntensity={1.8} />
      </mesh>
      {/* Landing legs with foot pads. */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        return (
          <group key={`leg-${i}`} rotation={[0, a, 0]}>
            <mesh position={[2, 0.85, 0]} rotation={[0, 0, 0.55]} castShadow>
              <cylinderGeometry args={[0.08, 0.11, 2.3, 8]} />
              <meshStandardMaterial {...DARK_STEEL} />
            </mesh>
            <mesh position={[2.55, 0.08, 0]}>
              <cylinderGeometry args={[0.42, 0.5, 0.14, 12]} />
              <meshStandardMaterial {...ANODIZED} />
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
      {/* Kiln / print yard: glows kiln-orange when powered. */}
      <group position={[6.5, 0, 4.5]}>
        <mesh position={[0, 0.95, 0]} castShadow>
          <boxGeometry args={[3.4, 1.9, 2.3]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
        {/* Roof pipework. */}
        {[-0.9, 0, 0.9].map((x) => (
          <mesh key={`pipe-${x}`} position={[x, 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 2.1, 8]} />
            <meshStandardMaterial {...STAINLESS} />
          </mesh>
        ))}
        {/* The glowing mouth. */}
        <mesh position={[0, 0.8, 1.17]}>
          <planeGeometry args={[2.7, 1.05]} />
          <meshStandardMaterial ref={kilnRef} color='#180a02' emissive='#ff7a1a' emissiveIntensity={0.04} toneMapped={false} />
        </mesh>
        <pointLight ref={kilnLightRef} position={[0, 1, 1.9]} intensity={0} distance={12} decay={1.8} color='#ff7a1a' />
        {/* Stack with a hot collar. */}
        <mesh position={[1.25, 2.7, -0.6]}>
          <cylinderGeometry args={[0.12, 0.17, 1.6, 10]} />
          <meshStandardMaterial {...STAINLESS} />
        </mesh>
        <mesh position={[1.25, 2.05, -0.6]}>
          <cylinderGeometry args={[0.15, 0.15, 0.2, 10]} />
          <meshStandardMaterial color='#31150a' emissive='#c2410c' emissiveIntensity={view.kilnActive ? 1.6 : 0.05} />
        </mesh>
        <KilnSmoke active={view.kilnActive} />
      </group>
      {/* Machining bay with arc-weld flashes. */}
      <group position={[-6, 0, 4]}>
        <mesh position={[0, 0.75, 0]} castShadow>
          <boxGeometry args={[2.6, 1.5, 1.9]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
        <mesh position={[0, 1.62, 0]} rotation={[0, 0, 0.12]}>
          <boxGeometry args={[2.9, 0.08, 2.1]} />
          <meshStandardMaterial {...ANODIZED} />
        </mesh>
        <ArcWelder active={view.kilnActive} />
      </group>
      {/* Cable harness runs from core to yards. */}
      <mesh position={[3.2, 0.06, 2.2]} rotation={[0, -0.6, 0.01]}>
        <boxGeometry args={[6.5, 0.08, 0.2]} />
        <meshStandardMaterial color='#26190f' roughness={0.95} />
      </mesh>
      <mesh position={[-3.1, 0.06, 2]} rotation={[0, 0.55, -0.01]}>
        <boxGeometry args={[6, 0.08, 0.2]} />
        <meshStandardMaterial color='#26190f' roughness={0.95} />
      </mesh>
    </group>
  );
}

/** Faint hot exhaust rising from the kiln stack when it runs. */
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
      <pointsMaterial color='#8a7a6a' size={0.3} transparent opacity={0.25} depthWrite={false} sizeAttenuation />
    </points>
  );
}

/** Intermittent arc-weld flash on the machining deck: HDR white for the bloom pass. */
function ArcWelder({ active }: { readonly active: boolean }): React.ReactElement {
  const flashRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
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
  });
  return (
    <group position={[0.4, 1.75, 0.3]}>
      <mesh ref={flashRef} visible={false}>
        <sphereGeometry args={[0.09, 8, 8]} />
        <meshBasicMaterial color={new THREE.Color('#dfe9ff').multiplyScalar(9)} toneMapped={false} />
      </mesh>
      <pointLight ref={lightRef} intensity={0} distance={9} decay={2} color='#cfe0ff' />
    </group>
  );
}

/** Scrap heap + junk pallets: rejected parts are visible shame. */
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
          castShadow
        >
          <dodecahedronGeometry args={[scrapScale * (0.35 + hash01(i * 9) * 0.4), 0]} />
          <meshStandardMaterial color='#5b524a' metalness={0.6} roughness={0.8} flatShading />
        </mesh>
      ))}
      {Array.from({ length: palletCount }, (_, i) => (
        <mesh key={`pallet-${i}`} position={[2.4 + (i % 4) * 1.15, 0.19, Math.floor(i / 4) * 1.15]} rotation={[0, (hash01(i * 17) - 0.5) * 0.3, 0]} castShadow>
          <boxGeometry args={[0.9, 0.38, 0.9]} />
          <meshStandardMaterial color='#6e5843' roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** One worker rover: chassis, four wheels, sensor mast with a glowing eye strip. */
function Rover({ seed, isNight }: { readonly seed: number; readonly isNight: boolean }): React.ReactElement {
  const tint = 0.85 + hash01(seed * 29) * 0.3;
  return (
    <group>
      <mesh position={[0, 0.42, 0]} castShadow>
        <boxGeometry args={[0.55, 0.26, 0.8]} />
        <meshStandardMaterial color={new THREE.Color(STAINLESS.color).multiplyScalar(tint)} metalness={0.85} roughness={0.35} />
      </mesh>
      {/* Cargo bin on the back. */}
      <mesh position={[0, 0.6, -0.22]}>
        <boxGeometry args={[0.46, 0.14, 0.32]} />
        <meshStandardMaterial {...ANODIZED} />
      </mesh>
      {/* Wheels. */}
      {[-0.32, 0.32].map((x) =>
        [-0.26, 0.26].map((z) => (
          <mesh key={`wheel-${x}-${z}`} position={[x, 0.16, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.15, 0.15, 0.1, 12]} />
            <meshStandardMaterial color='#1c1c1e' roughness={0.9} />
          </mesh>
        )),
      )}
      {/* Sensor mast + eye strip. */}
      <mesh position={[0, 0.72, 0.24]}>
        <cylinderGeometry args={[0.03, 0.04, 0.34, 6]} />
        <meshStandardMaterial {...ANODIZED} />
      </mesh>
      <mesh position={[0, 0.92, 0.24]}>
        <boxGeometry args={[0.22, 0.09, 0.14]} />
        <meshStandardMaterial color='#101418' metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.92, 0.32]}>
        <planeGeometry args={[0.16, 0.03]} />
        <meshStandardMaterial color='#7fd1ff' emissive='#7fd1ff' emissiveIntensity={2.2} />
      </mesh>
      {/* Headlight glow at night (emissive only — real lights are budgeted). */}
      <mesh position={[0, 0.42, 0.42]} visible={isNight}>
        <planeGeometry args={[0.3, 0.08]} />
        <meshStandardMaterial color='#fff6d8' emissive='#fff6d8' emissiveIntensity={3} />
      </mesh>
    </group>
  );
}

/** Worker rovers shuttling between their own dig sites and the kiln yard. */
function RobotSwarm({ view }: { readonly view: SceneView }): React.ReactElement {
  const groupRef = useRef<THREE.Group>(null);
  const count = Math.min(40, view.workingRobots);
  const brokenCount = Math.min(8, view.brokenRobots);

  useFrame(({ clock }) => {
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
      {/* Broken rovers lie where they fell, near the repair bay, eye strips dark. */}
      {Array.from({ length: brokenCount }, (_, i) => (
        <group key={`down-${i}`} position={[-7 + hash01(i * 11) * 2.5, 0.12, 6 + hash01(i * 13) * 2.5]} rotation={[0.35 + hash01(i) * 0.4, hash01(i * 3) * 6, 0.5]}>
          <mesh castShadow>
            <boxGeometry args={[0.55, 0.26, 0.8]} />
            <meshStandardMaterial color='#54483e' metalness={0.4} roughness={0.85} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** The child seed rising on its own pad: a stainless flower, petal by petal. */
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
      {/* Pad. */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[3.6, 28]} />
        <meshStandardMaterial color='#26292d' roughness={0.95} />
      </mesh>
      {/* Growing hull, faintly hot at the build line. */}
      <mesh position={[0, height / 2 + 0.1, 0]} castShadow>
        <cylinderGeometry args={[1.3, 1.55, height, 22]} />
        <meshStandardMaterial {...STAINLESS} />
      </mesh>
      {/* Fresh print line: a glowing hoop at the top of the growing hull. */}
      {underConstruction ? (
        <mesh position={[0, height + 0.08, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.3 + (1.55 - 1.3) * (1 - completion) * 0.4, 0.045, 8, 36]} />
          <meshStandardMaterial color='#31150a' emissive='#ff7a1a' emissiveIntensity={view.kilnActive ? 2.8 : 0.3} toneMapped={false} />
        </mesh>
      ) : null}
      {/* Nose cone appears near the end. */}
      {completion > 0.9 ? (
        <mesh position={[0, height + 0.65, 0]} castShadow>
          <coneGeometry args={[1.3, 1.1, 22]} />
          <meshStandardMaterial {...STAINLESS} />
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
                <meshStandardMaterial {...DARK_STEEL} />
              </mesh>
            );
          })}
          <mesh position={[0, 4.85, 0]} rotation={[0, Math.PI / 4, 0]}>
            <boxGeometry args={[6.4, 0.09, 0.09]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
          <mesh position={[1.1, 4.5, 1.1]} rotation={[0, -Math.PI / 4, 0.5]}>
            <boxGeometry args={[2.6, 0.08, 0.08]} />
            <meshStandardMaterial {...ANODIZED} />
          </mesh>
        </group>
      ) : null}
      {/* Wake glow: the child breathes once alive. */}
      {view.childWalking ? (
        <mesh position={[0, height + 1.4, 0]}>
          <sphereGeometry args={[0.09, 12, 12]} />
          <meshStandardMaterial color='#7fd15f' emissive='#7fd15f' emissiveIntensity={3} />
        </mesh>
      ) : null}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Camera, composition, and export                                     */
/* ------------------------------------------------------------------ */

/** Camera rig: eases the orbit target toward the focus selection. */
function CameraRig(): React.ReactElement {
  const focus = useSimStore((s) => s.focus);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  useFrame(({ camera }) => {
    const controls = controlsRef.current;
    if (controls === null) {
      return;
    }
    const target =
      focus === 'child' ? new THREE.Vector3(15, 2, -3) : focus === 'field' ? new THREE.Vector3(6, 0, 0) : new THREE.Vector3(0, 2.2, 0);
    controls.target.lerp(target, 0.04);
    if (focus === 'field') {
      camera.position.lerp(new THREE.Vector3(30, 34, 30), 0.02);
    }
    controls.update();
  });
  return <OrbitControls ref={controlsRef} enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI * 0.49} minDistance={6} maxDistance={80} />;
}

/** Scene contents (inside Canvas). */
function SceneContents(): React.ReactElement {
  const state = useSimStore((s) => s.state);
  const scrubSol = useSimStore((s) => s.scrubSol);
  const view = useMemo(() => selectView(state, scrubSol), [state, scrubSol]);
  return (
    <>
      <Environment view={view} />
      <ParentSeed view={view} />
      <ScrapYard view={view} />
      <RobotSwarm view={view} />
      <ChildSeed view={view} />
      <CameraRig />
      {/* Post pipeline: bloom lifts HDR emissives (kiln, arcs, sun); vignette frames the shot. */}
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.85} luminanceThreshold={1.1} luminanceSmoothing={0.3} levels={7} />
        <Vignette eskil={false} offset={0.18} darkness={0.68} />
      </EffectComposer>
    </>
  );
}

/** The exported center viewport, with a subtle HUD frame overlay. */
export function SeedScene(): React.ReactElement {
  return (
    <div className='relative flex-1 min-w-0'>
      <Canvas shadows camera={{ position: [16, 12, 18], fov: 42 }} dpr={[1, 2]} gl={{ antialias: false }}>
        <SceneContents />
      </Canvas>
      {/* Non-interactive viewport dressing: corner ticks + top gradient. */}
      <div className='pointer-events-none absolute inset-0 viewport-frame' aria-hidden='true' />
    </div>
  );
}
