import * as THREE from 'three'
import { PITCH } from './CameraRig'

/** Quad side in world units. The ring is inscribed in it. */
const RING_SIZE = 0.36
/** Ring radii in UV space, where 0.5 is the quad's half-extent. */
const OUTER_RADIUS = 0.46
const INNER_RADIUS = 0.29
/** Edge softening, in the same UV space. Fixed rather than derivative-based so no GL extension is needed. */
const EDGE = 0.02

const FILL_COLOR = 0xf2c464
const TRACK_COLOR = 0x10141a

export interface RingEntry {
  readonly worldX: number
  readonly worldZ: number
  /** World Y for the ring's centre — see BarView for why the caller owns this. */
  readonly anchorY: number
  /** 0 = just spawned/fired, 1 = ready. */
  readonly progress: number
}

const VERTEX = /* glsl */ `
attribute float aProgress;
varying float vProgress;
varying vec2 vUv;

void main() {
  vUv = uv;
  vProgress = aProgress;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`

/**
 * Sweeps clockwise from the top. Everything behind the sweep is filled, the
 * rest stays as unlit track, so the ring reads as a clock hand closing.
 */
const FRAGMENT = /* glsl */ `
precision mediump float;

uniform vec3 uFill;
uniform vec3 uTrack;
uniform float uOuter;
uniform float uInner;
uniform float uEdge;

varying float vProgress;
varying vec2 vUv;

void main() {
  vec2 p = vUv - 0.5;
  float r = length(p);

  // Soft annulus mask: inside the outer edge, outside the inner one.
  float mask = smoothstep(uOuter, uOuter - uEdge, r) * smoothstep(uInner - uEdge, uInner, r);
  if (mask <= 0.001) discard;

  // atan(x, y) puts 0 at straight up; fract maps it to 0..1 going clockwise.
  float angle = fract(atan(p.x, p.y) / 6.2831853);

  float filled = step(angle, vProgress);
  vec3 color = mix(uTrack, uFill, filled);
  float alpha = mix(0.5, 0.95, filled);

  gl_FragColor = vec4(color, alpha * mask);
}
`

/**
 * A radial charge-up ring floating above every Construct with a cooldown —
 * spawn timer for spawners, attack cooldown for turrets.
 *
 * Radial rather than a bar because the horizontal slot above a Construct now
 * belongs to its health bar, and because "how full is the clock" is a shape
 * players read without needing a legend. Per-instance progress rides an
 * `InstancedBufferAttribute` and the sweep is done in the fragment shader, so
 * the whole board costs **one** draw call — cheaper than the two the bar
 * needed, since track and fill share the same pixels here.
 *
 * The camera never rotates (see CameraRig), so facing it is a fixed tilt
 * baked in once rather than a per-frame billboard.
 */
export class CooldownRingView {
  private readonly mesh: THREE.InstancedMesh
  private readonly progress: THREE.InstancedBufferAttribute
  private readonly matrix = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly quaternion: THREE.Quaternion
  private readonly scale = new THREE.Vector3(1, 1, 1)

  constructor(scene: THREE.Scene, capacity: number) {
    const geometry = new THREE.PlaneGeometry(RING_SIZE, RING_SIZE)
    this.progress = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
    this.progress.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aProgress', this.progress)

    this.quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-PITCH, 0, 0))

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uFill: { value: new THREE.Color(FILL_COLOR) },
        uTrack: { value: new THREE.Color(TRACK_COLOR) },
        uOuter: { value: OUTER_RADIUS },
        uInner: { value: INNER_RADIUS },
        uEdge: { value: EDGE },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })

    this.mesh = new THREE.InstancedMesh(geometry, material, capacity)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.visible = false
    this.mesh.renderOrder = 7
    scene.add(this.mesh)
  }

  sync(entries: readonly RingEntry[]): void {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!
      this.position.set(entry.worldX, entry.anchorY, entry.worldZ)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      this.mesh.setMatrixAt(i, this.matrix)
      this.progress.setX(i, Math.max(0, Math.min(1, entry.progress)))
    }

    this.mesh.count = entries.length
    this.mesh.visible = entries.length > 0
    if (entries.length > 0) {
      this.mesh.instanceMatrix.needsUpdate = true
      this.progress.needsUpdate = true
    }
  }
}
