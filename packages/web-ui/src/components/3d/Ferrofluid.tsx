/**
 * Ferrofluid — Audio-reactive 3D visualization with multiple style options.
 *
 * Uses raw Three.js (no R3F) for maximum bundler compatibility.
 * Supports 4 rendering styles: Matte, Frosted Glass, Wireframe, Metallic (ferrofluid).
 */

import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import type { AudioBands } from '../../hooks/useAudioAnalysis';

// ─── Types ────────────────────────────────────────────────────────

export type OrbStyle = 'matte' | 'frosted' | 'wireframe' | 'ferrofluid';

type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface FerrofluidProps {
  state: AgentState;
  micBands: React.RefObject<AudioBands>;
  speakerBands: React.RefObject<AudioBands>;
  style?: OrbStyle;
  width?: number;
  height?: number;
}

// ─── Animation Configs (shared across styles) ────────────────────

interface StateConfig {
  baseAmplitude: number;
  noiseFreq: number;
  rotationSpeed: number;
  volumeSpeedScale: number;
  baseSpeed: number;
}

const STATE_CONFIGS: Record<AgentState, StateConfig> = {
  idle: {
    baseAmplitude: 0.03,
    noiseFreq: 1.5,
    rotationSpeed: 0.15,
    volumeSpeedScale: 0.5,
    baseSpeed: 0.4,
  },
  listening: {
    baseAmplitude: 0.06,
    noiseFreq: 2.0,
    rotationSpeed: 0.3,
    volumeSpeedScale: 1.5,
    baseSpeed: 0.6,
  },
  speaking: {
    baseAmplitude: 0.15,
    noiseFreq: 2.5,
    rotationSpeed: 0.5,
    volumeSpeedScale: 2.0,
    baseSpeed: 0.8,
  },
  thinking: {
    baseAmplitude: 0.07,
    noiseFreq: 3.0,
    rotationSpeed: 0.8,
    volumeSpeedScale: 0.3,
    baseSpeed: 0.7,
  },
};

// ─── Style-specific colors per state ─────────────────────────────

const STYLE_COLORS: Record<OrbStyle, Record<AgentState, [number, number, number]>> = {
  matte: {
    idle:      [0.52, 0.54, 0.58],
    listening: [0.22, 0.50, 0.92],
    speaking:  [0.20, 0.72, 0.40],
    thinking:  [0.58, 0.35, 0.80],
  },
  frosted: {
    idle:      [0.72, 0.74, 0.80],
    listening: [0.40, 0.68, 1.0],
    speaking:  [0.30, 0.82, 0.52],
    thinking:  [0.65, 0.48, 0.88],
  },
  wireframe: {
    idle:      [0.50, 0.52, 0.58],
    listening: [0.04, 0.48, 1.0],
    speaking:  [0.20, 0.78, 0.35],
    thinking:  [0.69, 0.32, 0.87],
  },
  ferrofluid: {
    idle:      [0.7, 0.72, 0.75],
    listening: [0.4, 0.65, 1.0],
    speaking:  [0.35, 0.9, 0.6],
    thinking:  [0.65, 0.45, 0.9],
  },
};

// ─── Style rendering configuration ──────────────────────────────

interface StyleRenderConfig {
  detail: number;
  wireframe: boolean;
  transparent: boolean;
  amplitudeScale: number;
  depthWrite: boolean;
}

const STYLE_RENDER: Record<OrbStyle, StyleRenderConfig> = {
  matte:      { detail: 32, wireframe: false, transparent: false, amplitudeScale: 0.9,  depthWrite: true },
  frosted:    { detail: 32, wireframe: false, transparent: true,  amplitudeScale: 0.85, depthWrite: false },
  wireframe:  { detail: 2,  wireframe: true,  transparent: false, amplitudeScale: 0.7,  depthWrite: true },
  ferrofluid: { detail: 48, wireframe: false, transparent: false, amplitudeScale: 1.0,  depthWrite: true },
};

// ─── GLSL: Shared Vertex Shader ──────────────────────────────────

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform float uVolume;
  uniform float uBaseAmplitude;
  uniform float uNoiseFreq;

  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vDisplacement;

  // Simplex 3D noise (Ashima Arts / Stefan Gustavson)
  vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 1.0 / 7.0;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    vec3 pos = position;
    vec3 norm = normal;

    float noiseFreq = uNoiseFreq + uTreble * 3.0;
    float t = uTime;

    float n1 = snoise(pos * noiseFreq + t * 0.3);
    float n2 = snoise(pos * noiseFreq * 2.0 + t * 0.5) * 0.5;
    float n3 = snoise(pos * noiseFreq * 4.0 + t * 0.8) * 0.25;

    float noise = n1 + n2 * (0.3 + uMid * 0.7) + n3 * (0.2 + uTreble * 0.8);

    float amplitude = uBaseAmplitude
      + uBass * 0.25
      + uMid * 0.12
      + uVolume * 0.08;

    float displacement = noise * amplitude;
    vDisplacement = displacement;

    vec3 displaced = pos + norm * displacement;

    // Approximate displaced normal
    float eps = 0.01;
    vec3 tangent = normalize(cross(norm, vec3(0.0, 1.0, 0.0)));
    if (length(cross(norm, vec3(0.0, 1.0, 0.0))) < 0.001) {
      tangent = normalize(cross(norm, vec3(1.0, 0.0, 0.0)));
    }
    vec3 bitangent = normalize(cross(norm, tangent));

    vec3 neighbour1 = pos + tangent * eps;
    vec3 neighbour2 = pos + bitangent * eps;

    float d1 = snoise(neighbour1 * noiseFreq + t * 0.3)
      + snoise(neighbour1 * noiseFreq * 2.0 + t * 0.5) * 0.5 * (0.3 + uMid * 0.7)
      + snoise(neighbour1 * noiseFreq * 4.0 + t * 0.8) * 0.25 * (0.2 + uTreble * 0.8);
    float d2 = snoise(neighbour2 * noiseFreq + t * 0.3)
      + snoise(neighbour2 * noiseFreq * 2.0 + t * 0.5) * 0.5 * (0.3 + uMid * 0.7)
      + snoise(neighbour2 * noiseFreq * 4.0 + t * 0.8) * 0.25 * (0.2 + uTreble * 0.8);

    vec3 displacedNeighbour1 = neighbour1 + normalize(neighbour1) * d1 * amplitude;
    vec3 displacedNeighbour2 = neighbour2 + normalize(neighbour2) * d2 * amplitude;

    vNormal = normalize(cross(
      displacedNeighbour1 - displaced,
      displacedNeighbour2 - displaced
    ));

    vWorldPosition = (modelMatrix * vec4(displaced, 1.0)).xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

// ─── GLSL: Style Fragment Shaders ────────────────────────────────

const FRAGMENT_SHADERS: Record<OrbStyle, string> = {
  // ── Matte: soft clay/silicone, no reflections ──
  matte: /* glsl */ `
    uniform vec3 uStateColor;
    uniform float uVolume;

    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying float vDisplacement;

    void main() {
      vec3 normal = normalize(vNormal);

      // Half-lambert diffuse (soft wrap-around lighting)
      vec3 lightDir = normalize(vec3(0.2, 1.0, 0.4));
      float NdotL = dot(normal, lightDir) * 0.5 + 0.5;

      // Vertical gradient for depth
      float yGrad = normal.y * 0.5 + 0.5;
      vec3 lightVariant = uStateColor + vec3(0.12);
      vec3 darkVariant = uStateColor * 0.55;
      vec3 color = mix(darkVariant, lightVariant, yGrad);

      // Apply soft diffuse
      color *= 0.55 + NdotL * 0.45;

      // Fake AO from displacement (crevices darken)
      float ao = smoothstep(-0.08, 0.04, vDisplacement);
      color *= 0.72 + ao * 0.28;

      // Very subtle view-dependent rim (just enough to read the shape)
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      float rim = 1.0 - max(dot(viewDir, normal), 0.0);
      color += uStateColor * rim * rim * 0.08;

      color *= 1.0 + uVolume * 0.08;

      gl_FragColor = vec4(color, 1.0);
    }
  `,

  // ── Frosted Glass: translucent, ethereal ──
  frosted: /* glsl */ `
    uniform vec3 uStateColor;
    uniform float uVolume;

    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying float vDisplacement;

    void main() {
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      vec3 normal = normalize(vNormal);

      float NdotV = max(dot(viewDir, normal), 0.0);
      float edgeFactor = 1.0 - NdotV;

      // Frosted glass base: light neutral with state color tint
      vec3 glassBase = vec3(0.82, 0.84, 0.88);
      vec3 tinted = mix(glassBase, uStateColor, 0.2);

      // Soft top-down lighting
      vec3 lightDir = normalize(vec3(0.0, 1.0, 0.3));
      float diffuse = dot(normal, lightDir) * 0.5 + 0.5;

      vec3 color = tinted * (0.65 + diffuse * 0.35);

      // Internal scattering: thinner parts (facing camera) are brighter
      color += glassBase * NdotV * 0.15;

      // Edge rim with state color
      float rim = pow(edgeFactor, 2.5);
      color += uStateColor * rim * 0.25;

      // Displacement highlight on peaks
      float dispGlow = smoothstep(0.0, 0.08, vDisplacement);
      color += uStateColor * dispGlow * 0.08;

      color *= 1.0 + uVolume * 0.1;

      // Alpha: more opaque at edges (glass thickness), transparent facing camera
      float alpha = mix(0.35, 0.72, edgeFactor);

      gl_FragColor = vec4(color, alpha);
    }
  `,

  // ── Wireframe: clean geometric lines ──
  wireframe: /* glsl */ `
    uniform vec3 uStateColor;
    uniform float uVolume;

    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying float vDisplacement;

    void main() {
      vec3 color = uStateColor;

      // Slight depth variation
      float brightness = 0.65 + smoothstep(-0.06, 0.1, vDisplacement) * 0.35;
      color *= brightness;

      // Volume pulse
      color *= 1.0 + uVolume * 0.25;

      gl_FragColor = vec4(color, 0.9);
    }
  `,

  // ── Ferrofluid: original metallic liquid ──
  ferrofluid: /* glsl */ `
    uniform vec3 uStateColor;
    uniform float uVolume;

    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying float vDisplacement;

    vec3 sampleEnv(vec3 dir) {
      float y = dir.y * 0.5 + 0.5;
      vec3 dark = vec3(0.02, 0.03, 0.08);
      vec3 mid = vec3(0.15, 0.25, 0.45);
      vec3 bright = vec3(0.85, 0.9, 1.0);
      float h = abs(dir.x) * 0.3 + abs(dir.z) * 0.2;
      vec3 color = mix(dark, mid, smoothstep(0.0, 0.4, y));
      color = mix(color, bright, smoothstep(0.5, 1.0, y + h));
      return color;
    }

    void main() {
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      vec3 normal = normalize(vNormal);

      vec3 reflectDir = reflect(-viewDir, normal);
      vec3 envColor = sampleEnv(reflectDir);

      float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);

      vec3 baseColor = vec3(0.04, 0.04, 0.06);
      vec3 color = mix(baseColor, envColor, 0.85);
      color *= mix(vec3(1.0), uStateColor, 0.3);

      vec3 rimColor = mix(uStateColor, vec3(1.0), 0.5);
      color += rimColor * fresnel * 0.6;

      float peakGlow = smoothstep(0.02, 0.12, abs(vDisplacement));
      color += envColor * peakGlow * 0.3 * (0.5 + uVolume);

      color *= 1.0 + uVolume * 0.15;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

// ─── Helpers ─────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function makeUniforms(style: OrbStyle, state: AgentState) {
  const config = STATE_CONFIGS[state];
  const styleRender = STYLE_RENDER[style];
  const colors = STYLE_COLORS[style][state];
  return {
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uTreble: { value: 0 },
    uVolume: { value: 0 },
    uBaseAmplitude: { value: config.baseAmplitude * styleRender.amplitudeScale },
    uNoiseFreq: { value: config.noiseFreq },
    uStateColor: { value: new THREE.Vector3(...colors) },
  };
}

// ─── Three.js Scene Manager ──────────────────────────────────────

class FerrofluidScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private mesh!: THREE.Mesh;
  private material!: THREE.ShaderMaterial;
  private clock = new THREE.Clock();
  private animTime = 0;
  private rafId: number | null = null;

  // Smoothed values
  private smoothedAmplitude: number;
  private smoothedNoiseFreq: number;
  private smoothedColor: THREE.Vector3;

  // External data
  private state: AgentState = 'idle';
  private style: OrbStyle;
  private micBands: React.RefObject<AudioBands>;
  private speakerBands: React.RefObject<AudioBands>;

  constructor(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    micBands: React.RefObject<AudioBands>,
    speakerBands: React.RefObject<AudioBands>,
    style: OrbStyle = 'matte',
  ) {
    this.micBands = micBands;
    this.speakerBands = speakerBands;
    this.style = style;

    const config = STATE_CONFIGS.idle;
    const styleRender = STYLE_RENDER[style];
    const colors = STYLE_COLORS[style].idle;
    this.smoothedAmplitude = config.baseAmplitude * styleRender.amplitudeScale;
    this.smoothedNoiseFreq = config.noiseFreq;
    this.smoothedColor = new THREE.Vector3(...colors);

    // Renderer
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.debug.checkShaderErrors = true;

    // Scene + Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    this.camera.position.set(0, 0, 3.5);

    // Build initial mesh
    this.buildMesh();
  }

  private buildMesh() {
    const styleRender = STYLE_RENDER[this.style];

    const geometry = new THREE.IcosahedronGeometry(1, styleRender.detail);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: FRAGMENT_SHADERS[this.style],
      wireframe: styleRender.wireframe,
      transparent: styleRender.transparent,
      depthWrite: styleRender.depthWrite,
      uniforms: makeUniforms(this.style, this.state),
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.scene.add(this.mesh);
  }

  setState(state: AgentState) {
    this.state = state;
  }

  setStyle(style: OrbStyle) {
    if (this.style === style) return;
    this.style = style;

    // Tear down old mesh
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();

    // Rebuild with new style
    this.buildMesh();

    // Reset smoothed values to current targets for snappy transition
    const config = STATE_CONFIGS[this.state];
    const styleRender = STYLE_RENDER[style];
    const colors = STYLE_COLORS[style][this.state];
    this.smoothedAmplitude = config.baseAmplitude * styleRender.amplitudeScale;
    this.smoothedNoiseFreq = config.noiseFreq;
    this.smoothedColor.set(...colors);
  }

  start() {
    if (this.rafId !== null) return;
    this.clock.start();
    const animate = () => {
      this.rafId = requestAnimationFrame(animate);
      this.update();
    };
    animate();
  }

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.clock.stop();
  }

  dispose() {
    this.stop();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }

  private update() {
    const delta = this.clock.getDelta();
    const config = STATE_CONFIGS[this.state];
    const styleRender = STYLE_RENDER[this.style];
    const u = this.material.uniforms;

    // Pick audio source
    let bands: AudioBands;
    if (this.state === 'speaking') {
      bands = this.speakerBands.current;
    } else if (this.state === 'listening') {
      bands = this.micBands.current;
    } else if (this.state === 'thinking') {
      const pulse = (Math.sin(this.animTime * 4) + 1) * 0.5;
      bands = {
        bass: pulse * 0.4,
        lowMid: pulse * 0.3,
        mid: pulse * 0.25,
        treble: pulse * 0.15,
        volume: pulse * 0.3,
      };
    } else {
      const breath = (Math.sin(this.animTime * 0.5) + 1) * 0.5;
      bands = {
        bass: breath * 0.05,
        lowMid: breath * 0.03,
        mid: breath * 0.02,
        treble: breath * 0.01,
        volume: breath * 0.03,
      };
    }

    // Advance time
    const speed = config.baseSpeed + bands.volume * config.volumeSpeedScale;
    this.animTime += delta * speed;
    u.uTime.value = this.animTime;

    // Audio uniforms
    u.uBass.value = bands.bass;
    u.uMid.value = bands.mid;
    u.uTreble.value = bands.treble;
    u.uVolume.value = bands.volume;

    // Smooth state transitions
    const lf = 1 - Math.pow(0.05, delta);
    const targetAmp = config.baseAmplitude * styleRender.amplitudeScale;
    this.smoothedAmplitude = lerp(this.smoothedAmplitude, targetAmp, lf);
    this.smoothedNoiseFreq = lerp(this.smoothedNoiseFreq, config.noiseFreq, lf);

    const targetColor = STYLE_COLORS[this.style][this.state];
    this.smoothedColor.lerp(new THREE.Vector3(...targetColor), lf);

    u.uBaseAmplitude.value = this.smoothedAmplitude;
    u.uNoiseFreq.value = this.smoothedNoiseFreq;
    (u.uStateColor.value as THREE.Vector3).copy(this.smoothedColor);

    // Auto-rotation
    this.mesh.rotation.y += delta * config.rotationSpeed;
    this.mesh.rotation.x = Math.sin(this.animTime * 0.2) * 0.1;

    this.renderer.render(this.scene, this.camera);
  }
}

// ─── React Component ──────────────────────────────────────────────

export function Ferrofluid({
  state,
  micBands,
  speakerBands,
  style = 'matte',
  width = 200,
  height = 200,
}: FerrofluidProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<FerrofluidScene | null>(null);

  // Initialize scene
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new FerrofluidScene(canvas, width, height, micBands, speakerBands, style);
    sceneRef.current = scene;
    scene.start();

    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // Update state
  useEffect(() => {
    sceneRef.current?.setState(state);
  }, [state]);

  // Update style
  useEffect(() => {
    sceneRef.current?.setStyle(style);
  }, [style]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width, height, background: 'transparent' }}
    />
  );
}
