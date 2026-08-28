import * as THREE from 'three'
import { bake, cyl, gem, type PartSpec } from './MeshKit'

/**
 * Slightly larger than its tile at the starting ring 2 — enough to read as
 * the board's focal point without its canopy swallowing the neighbouring
 * build slots.
 */
const BASE_SCALE = 0.98
/** Extra scale per ring beyond the starting one, once a wave unlocks it. */
const SCALE_PER_RING = 0.22
/** Ring the board opens at, before any expansion — scale growth starts past this. */
const BASE_RING = 2

/**
 * Placeholder Eldree — the Sacred Tree at ring 0, and the thing losing the run
 * means losing. Procedural primitives, replaced by authored glTF in M7.
 *
 * Trunk and canopy are two merged meshes rather than one, because the canopy
 * animates independently; the four leaf blobs collapse into a single draw.
 *
 * The point-light is the only dynamic light besides the two global ones. It
 * exists so the centre reads as the source of the board's warmth, and so
 * M3's damage flashes have somewhere to live.
 */
export class Eldree {
  readonly group = new THREE.Group()
  private readonly canopy: THREE.Mesh
  private readonly glow: THREE.PointLight
  private time = 0
  private hurt = 0
  private scale = BASE_SCALE
  private targetScale = BASE_SCALE

  constructor(surfaceY: number) {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })

    const trunk = new THREE.Mesh(
      bake([{ geo: cyl(0.16, 0.3, 1.5, 7), color: 0x6b5138, pos: [0, 0.75, 0] }]),
      material,
    )
    this.group.add(trunk)

    const leafColors = [0x7fc46b, 0x6bb058, 0x8fd67a]
    const blobs: Array<[number, number, number, number]> = [
      [0, 1.82, 0, 0.6],
      [-0.46, 1.56, 0.18, 0.42],
      [0.44, 1.58, -0.16, 0.44],
      [0.02, 2.24, 0.04, 0.34],
    ]
    const parts: PartSpec[] = blobs.map(([x, y, z, r], i) => ({
      geo: gem(r),
      color: leafColors[i % leafColors.length]!,
      pos: [x, y, z],
      rot: [i * 0.7, i * 1.3, i * 0.4],
    }))
    this.canopy = new THREE.Mesh(bake(parts), material)
    this.group.add(this.canopy)

    this.glow = new THREE.PointLight(0xffe9a8, 6, 7, 2)
    this.glow.position.set(0, 1.4, 0)
    this.group.add(this.glow)

    this.group.position.y = surfaceY
    this.group.scale.setScalar(this.scale)
  }

  /** Flashes the canopy light. Called when the Eldree is struck. */
  flash(): void {
    this.hurt = 1
  }

  /**
   * Grows the Eldree to match the board's outermost unlocked ring — the
   * bastion's expansion is the Eldree's own growth, not just more tiles
   * around it. `animate` mirrors `CameraRig.fitBoard`'s: false snaps
   * immediately (a run restart dropping back to the starting ring), true
   * eases toward it in `update` the way a mid-run ring unlock should.
   */
  growForRing(ring: number, animate = true): void {
    this.targetScale = BASE_SCALE + Math.max(0, ring - BASE_RING) * SCALE_PER_RING
    if (!animate) {
      this.scale = this.targetScale
      this.group.scale.setScalar(this.scale)
    }
  }

  /** Driven by wall time, not sim time — idle motion must not affect combat. */
  update(dt: number): void {
    this.time += dt
    this.canopy.rotation.y = Math.sin(this.time * 0.35) * 0.06
    this.canopy.position.y = Math.sin(this.time * 0.9) * 0.035

    this.hurt = Math.max(0, this.hurt - dt * 3.5)
    this.glow.intensity = 6 + Math.sin(this.time * 1.7) * 0.9 + this.hurt * 22
    this.glow.color.setHex(this.hurt > 0.02 ? 0xff6a4a : 0xffe9a8)
    // A struck tree shudders; the shake decays with the flash.
    this.canopy.rotation.z = this.hurt * Math.sin(this.time * 40) * 0.06

    if (Math.abs(this.targetScale - this.scale) > 0.0005) {
      // Same frame-rate-independent exponential ease CameraRig uses for its
      // own board-expansion pull-back, so the two reads as one animation.
      const k = 1 - Math.exp(-dt * 5)
      this.scale += (this.targetScale - this.scale) * k
      this.group.scale.setScalar(this.scale)
    }
  }
}
