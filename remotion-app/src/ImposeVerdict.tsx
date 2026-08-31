import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
import { FontLoader, type Font } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import {
  AbsoluteFill,
  Easing,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * ImposeVerdict — "$800,000,000,000" slams onto the frame as a single hard
 * impact, not a count-up. A real extruded Three.js numeral (single studio
 * key light, contact shadow, dark blood-red edge-only underglow) carries the
 * weight; CSS handles the atmosphere (near-black ground, a slow dark-grey
 * haze, vignette, grain) around it. Silent -- SFX/music land later in edit.
 *
 * Palette is deliberately closed: near-black / bone-cream / dark blood-red /
 * dark grey. No other hues appear anywhere in this file, including the
 * chromatic-split shimmer (kept to blood-red + bone-cream, not red/cyan).
 */

// ---------- deterministic PRNG (no Math.random / Date.now anywhere) ----------
const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

const BONE = "#ede8dd";
const BLOOD = "#7a160e";
const NEAR_BLACK = "#0b0b0c";
const DARK_GREY = "#5a5a60";

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch' seed='7'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>\")";

// the impact-settle curve every "camera absorbed the hit" beat shares --
// a named, explicit bezier, not a bare default ease
const IMPACT_SETTLE = Easing.bezier(0.16, 1.0, 0.3, 1.0);

// ---------- load the typeface once, synchronously from the parsed JSON ----------
function useTypefaceFont(url: string): Font | null {
  const [font, setFont] = useState<Font | null>(null);
  const [handle] = useState(() => delayRender("Loading numeral typeface"));

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setFont(new FontLoader().parse(json));
        continueRender(handle);
      })
      .catch((err) => {
        continueRender(handle);
        console.error(err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return font;
}

// ---------- numeral geometry ----------
const TEXT = "$800,000,000,000";
const SIZE = 0.62;
const DEPTH = 0.22;
const TRACK = 0.03;
const FOV = 15;
const CAM_Z = 9;
const TARGET_WIDTH_FRACTION = 0.66;

const frustumWidthAt = (z: number) => {
  const dist = CAM_Z - z;
  const vFov = (FOV * Math.PI) / 180;
  const height = 2 * Math.tan(vFov / 2) * dist;
  return height * (1920 / 1080);
};

// `three` at this pinned version ships no .d.ts (see three-addons.d.ts), so
// its own classes are untyped here -- these two aliases just name that gap.
type Geometry = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type BufferAttr = any; // eslint-disable-line @typescript-eslint/no-explicit-any

type Metric = { geo: Geometry; x: number };

function buildGlyphs(font: Font): { metrics: Metric[]; shift: number } {
  // a single shared baseline (from digit "0"), so punctuation with a tiny
  // own bounding box -- the comma's descender-only mark -- sits on the same
  // line instead of being centered on itself and floating mid-height
  let digitAdvance = 0;
  let refCenterY = 0;
  let refCenterZ = 0;
  for (const d of "0123456789") {
    const g = new TextGeometry(d, {
      font,
      size: SIZE,
      height: DEPTH,
      curveSegments: 5,
      bevelEnabled: true,
      bevelThickness: 0.017,
      bevelSize: 0.011,
      bevelSegments: 2,
    });
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const w = bb.max.x - bb.min.x;
    if (w > digitAdvance) digitAdvance = w;
    if (d === "0") {
      refCenterY = (bb.max.y + bb.min.y) / 2;
      refCenterZ = (bb.max.z + bb.min.z) / 2;
    }
    g.dispose();
  }

  const metrics: Metric[] = [];
  let cursor = 0;
  for (const ch of TEXT) {
    const geo = new TextGeometry(ch, {
      font,
      size: SIZE,
      height: DEPTH,
      curveSegments: 5,
      bevelEnabled: true,
      bevelThickness: 0.017,
      bevelSize: 0.011,
      bevelSegments: 2,
    });
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const rawW = bb.max.x - bb.min.x || SIZE * 0.2;
    geo.translate(-bb.min.x, -refCenterY, -refCenterZ);
    geo.computeVertexNormals();
    const isDigit = ch >= "0" && ch <= "9";
    const adv = (isDigit ? digitAdvance : rawW) + TRACK;
    metrics.push({ geo, x: cursor });
    cursor += adv;
  }
  const total = cursor - TRACK;
  return { metrics, shift: -total / 2 };
}

const HALO_LAYERS = [
  { s: 1.025, o: 0.55 },
  { s: 1.06, o: 0.34 },
  { s: 1.11, o: 0.2 },
  { s: 1.18, o: 0.1 },
];

// ---------- one-time renderer/environment setup ----------
const SceneSetup: React.FC = () => {
  const { gl, scene } = useThree();
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.1;
    gl.outputColorSpace = THREE.SRGBColorSpace;

    // dim neutral env so the metal has something to reflect (no added hue)
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.0, "#8a8681");
    g.addColorStop(0.4, "#3f3c3a");
    g.addColorStop(0.66, "#161514");
    g.addColorStop(1.0, "#0a0a09");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 256);
    const s = ctx.createLinearGradient(150, 0, 370, 0);
    s.addColorStop(0, "rgba(230,225,215,0)");
    s.addColorStop(0.5, "rgba(230,225,215,0.85)");
    s.addColorStop(1, "rgba(230,225,215,0)");
    ctx.fillStyle = s;
    ctx.fillRect(150, 0, 220, 165);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();
    const envTex = pmrem.fromEquirectangular(tex).texture;
    scene.environment = envTex;
    tex.dispose();

    return () => {
      envTex.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
};

// ---------- dust: thrown outward on impact, then a bounded ambient wiggle ----------
const DUST_N = 130;
const DUST_Z = 2.4;

const Dust: React.FC<{ frame: number; fps: number; burstT: number; wiggleEnv: number }> = ({
  frame,
  fps,
  burstT,
  wiggleEnv,
}) => {
  const seed = useMemo(() => {
    const r = mulberry32(0x8b0d057);
    const spreadW = frustumWidthAt(DUST_Z);
    const base = new Float32Array(DUST_N * 3);
    const dir = new Float32Array(DUST_N * 3);
    for (let i = 0; i < DUST_N; i++) {
      const ang = i * 2.399963; // golden-angle deterministic spread
      const rad = 0.06 + (i % 7) * 0.012;
      const x = Math.cos(ang) * rad * spreadW * 0.5;
      const y = Math.sin(ang) * rad * spreadW * 0.32 + (r() - 0.5) * 0.15;
      const z = DUST_Z + (r() - 0.5) * 1.4;
      base[i * 3] = x;
      base[i * 3 + 1] = y;
      base[i * 3 + 2] = z;
      dir[i * 3] = Math.cos(ang);
      dir[i * 3 + 1] = Math.sin(ang) * 0.6;
      dir[i * 3 + 2] = (r() - 0.5) * 0.3;
    }
    return { base, dir };
  }, []);

  const positions = useMemo(() => new Float32Array(seed.base), [seed]);
  const geoRef = useRef<Geometry>(null);

  const amplitude = 0.08 * frustumWidthAt(DUST_Z); // 8% of frame width, at dust depth
  const burst = 1 - Math.pow(1 - clamp01(burstT), 4); // power4.out
  const now = frame / fps;

  for (let i = 0; i < DUST_N; i++) {
    const bx = seed.base[i * 3];
    const by = seed.base[i * 3 + 1];
    const bz = seed.base[i * 3 + 2];
    const dx = seed.dir[i * 3];
    const dy = seed.dir[i * 3 + 1];
    const dz = seed.dir[i * 3 + 2];
    const phase = i * 0.61803399; // deterministic per-particle phase
    const wiggle = wiggleEnv * 0.035 * Math.sin(now * 1.4 + phase);
    positions[i * 3] = bx + dx * amplitude * burst + dx * wiggle;
    positions[i * 3 + 1] = by + dy * amplitude * burst + dy * wiggle;
    positions[i * 3 + 2] = bz + dz * amplitude * 0.4 * burst;
  }
  if (geoRef.current) {
    (geoRef.current.attributes.position as BufferAttr).needsUpdate = true;
  }

  return (
    <points>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={BONE} size={0.024} sizeAttenuation transparent opacity={0.5} depthWrite={false} />
    </points>
  );
};

// ---------- the numeral: bone face + blood-red edge underglow + fringe flash ----------
const Numeral: React.FC<{ font: Font; underglowT: number; fringeT: number }> = ({
  font,
  underglowT,
  fringeT,
}) => {
  const { metrics, shift } = useMemo(() => buildGlyphs(font), [font]);

  const fitScale = useMemo(() => {
    const box = new THREE.Box3();
    for (const m of metrics) {
      const g = m.geo.clone().translate(m.x + shift, 0, 0);
      g.computeBoundingBox();
      box.union(new THREE.Box3().setFromObject(new THREE.Mesh(g)));
    }
    const rawWidth = box.max.x - box.min.x;
    const targetWidth = TARGET_WIDTH_FRACTION * frustumWidthAt(0);
    return targetWidth / rawWidth;
  }, [metrics, shift]);

  const metalMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: BONE, metalness: 0.42, roughness: 0.34, envMapIntensity: 1.6 }),
    [],
  );
  const fringeRMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#9c1f11",
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const fringeCMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BONE,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const haloMats = useMemo(
    () =>
      HALO_LAYERS.map(
        () =>
          new THREE.MeshBasicMaterial({
            color: BLOOD,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          }),
      ),
    [],
  );

  fringeRMat.opacity = fringeT * 0.85;
  fringeCMat.opacity = fringeT * 0.85;
  haloMats.forEach((m, i) => {
    m.opacity = HALO_LAYERS[i].o * underglowT;
  });

  const fringeOffset = (4 / 1920) * frustumWidthAt(0); // ~4px, in world units at z=0

  return (
    <>
      {/* blood-red edge underglow: concentric silhouettes bleeding from behind */}
      {haloMats.map((mat, i) => (
        <group key={i} scale={fitScale * HALO_LAYERS[i].s} position={[0, 0, -0.05]}>
          {metrics.map((m, gi) => (
            <mesh key={gi} geometry={m.geo} material={mat} position={[m.x + shift, 0, 0]} />
          ))}
        </group>
      ))}

      {/* chromatic-split fringe -- blood-red / bone-cream only, no cyan */}
      <group scale={fitScale} position={[fringeOffset * fringeT, 0, 0]}>
        {metrics.map((m, gi) => (
          <mesh key={gi} geometry={m.geo} material={fringeRMat} position={[m.x + shift, 0, 0]} />
        ))}
      </group>
      <group scale={fitScale} position={[-fringeOffset * fringeT, 0, 0]}>
        {metrics.map((m, gi) => (
          <mesh key={gi} geometry={m.geo} material={fringeCMat} position={[m.x + shift, 0, 0]} />
        ))}
      </group>

      {/* the bone-metal face itself */}
      <group scale={fitScale}>
        {metrics.map((m, gi) => (
          <mesh key={gi} geometry={m.geo} material={metalMat} position={[m.x + shift, 0, 0]} castShadow receiveShadow />
        ))}
      </group>

      {/* contact shadow */}
      <mesh position={[0, -0.55, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 12]} />
        <shadowMaterial opacity={0.55} />
      </mesh>
    </>
  );
};

const Scene: React.FC<{ font: Font; frame: number; fps: number }> = ({ font, frame, fps }) => {
  const s = (sec: number) => sec * fps;

  // CAMERA LAYER -- flinched from the impact: starts zoomed in, settles under 1s
  const camScale = interpolate(frame, [0, s(0.83)], [1.055, 1.0], {
    easing: IMPACT_SETTLE,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // COLOUR/LIGHT LAYER -- the blood-red glow burns in on impact
  const underglowT = interpolate(frame, [0, s(0.42)], [0, 1], {
    easing: Easing.out(Easing.exp),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // dust burst outward on landing, then a low continuous wiggle (never fully still)
  const burstT = interpolate(frame, [0, s(0.25)], [0, 1], {
    easing: Easing.out(Easing.poly(4)),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const wiggleEnv = interpolate(frame, [0, s(0.83)], [0, 1], {
    easing: IMPACT_SETTLE,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // ONE shader moment: a quick color-fringe shimmer right after landing, then gone
  const fringeT = interpolate(
    frame,
    [s(0.5), s(0.58), s(0.66)],
    [0, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <>
      <SceneSetup />
      <ambientLight intensity={0.12} color="#201d1a" />
      <hemisphereLight args={["#242220", "#050505", 0.22]} />
      <directionalLight position={[3.6, 1.0, 2.6]} intensity={0.3} color="#8892a0" />
      {/* the single studio key light */}
      <spotLight
        position={[-3.4, 4.6, 4.4]}
        angle={0.55}
        penumbra={0.32}
        intensity={13}
        color="#fff2e6"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0015}
      />
      <group scale={camScale}>
        <Numeral font={font} underglowT={underglowT} fringeT={fringeT} />
        <Dust frame={frame} fps={fps} burstT={burstT} wiggleEnv={wiggleEnv} />
      </group>
    </>
  );
};

export const ImposeVerdict: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const font = useTypefaceFont(staticFile("helvetiker_bold.typeface.json"));

  // ATMOSPHERIC LAYER -- dark-grey haze drifts the WHOLE shot (never resolves,
  // including the final still second where it and the dust are the only
  // things still quietly moving)
  const hazeIn = interpolate(frame, [0, fps * 0.6], [0, 1], {
    easing: Easing.inOut(Easing.sin),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const now = frame / fps;
  const hazeOpacity = hazeIn * (0.1 + 0.05 * Math.sin(now * 0.9 + 2.0));
  const hazeX = 50 + 3 * Math.sin(now * 0.55 + 0.6);
  const hazeY = 46 + 2 * Math.sin(now * 0.4 + 2.1);

  return (
    <AbsoluteFill style={{ backgroundColor: NEAR_BLACK }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(70% 66% at 50% 46%, #141416 0%, ${NEAR_BLACK} 60%, #040404 100%)`,
        }}
      />

      {/* dark-grey haze, drifting slowly, the whole shot */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(38% 32% at ${hazeX}% ${hazeY}%, ${DARK_GREY} 0%, transparent 72%)`,
          opacity: hazeOpacity,
          filter: "blur(18px)",
          pointerEvents: "none",
        }}
      />

      {font && (
        <ThreeCanvas
          width={1920}
          height={1080}
          shadows
          gl={{ antialias: true, alpha: true }}
          camera={{ position: [0, 0, CAM_Z], fov: FOV, near: 0.1, far: 100 }}
        >
          <Scene font={font} frame={frame} fps={fps} />
        </ThreeCanvas>
      )}

      <AbsoluteFill
        style={{
          background:
            "radial-gradient(70% 62% at 50% 47%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.74) 100%)",
          pointerEvents: "none",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: GRAIN,
          backgroundSize: "320px 320px",
          opacity: 0.075,
          mixBlendMode: "overlay",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};


export const IMPOSE_VERDICT_DURATION_FRAMES = 144;
