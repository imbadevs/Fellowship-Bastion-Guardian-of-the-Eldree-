import * as THREE from 'three'
import { PITCH } from './CameraRig'

/** Bar footprint, in world units — narrower than a tile so it reads as an overlay, not a floor tile. */
const BAR_WIDTH = 0.62
const BAR_HEIGHT = 0.09
/** A sliver stays visible at 0% so the bar reads as "empty", not "absent". */
const MIN_FILL = 0.03

const TRACK_COLOR = 0x10141a
const FILL_COLOR = 0xf2c464

export interface CooldownEntry {
  readonly worldX: number
  readonly worldZ: number
  /**
   * World Y for the bar's centre — the caller's job, not this view's: it
   * depends on the specific building's measured height (`buildingHeight`),
   * which this class has no reason to know about.
   */
  readonly anchorY: number
  /** 0 = just spawned/fired, 1 = ready. */
  readonly progress: number
}

/**
 * A charge-up bar floating above every Construct with a cooldown — spawn
 * timer for spawners, attack cooldown for turrets. Structures with neither
 * (Palisade, Healing Shrine) simply never appear in the synced list.
 *
 * Buildings top out around 60 on this board, so a per-instance draw is not a
 * budget concern the way it would be for the hundreds of units the project
 * deliberately avoided floating health bars for (tint carries that instead).
 * Cooldown timing has no other visual representation at all, so this fills a
 * real gap rather than duplicating one.
 *
 * The camera never rotates (see CameraRig), so "face the camera" is a single
 * fixed tilt baked into the geometry once, not a per-frame billboard — and
 * the fill geometry's local origin sits at its own left edge, so scaling
 * `scale.x` by `progress` grows it rightward from a fixed anchor instead of
 * requiring a matching position offset every frame.
 */
export class CooldownBarView {
  private readonly track: THREE.InstancedMesh
  private readonly fill: THREE.InstancedMesh
  private readonly matrix = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly quaternion: THREE.Quaternion
  private readonly scale = new THREE.Vector3(1, 1, 1)

  constructor(scene: THREE.Scene, capacity: number) {
    const trackGeo = new THREE.PlaneGeometry(BAR_WIDTH, BAR_HEIGHT)
    // Left-pivoted: local x spans [0, BAR_WIDTH] instead of the default
    // [-BAR_WIDTH/2, BAR_WIDTH/2], so scaling by `progress` grows the fill
    // from its own left edge rather than from the centre.
    const fillGeo = new THREE.PlaneGeometry(BAR_WIDTH, BAR_HEIGHT)
    fillGeo.translate(BAR_WIDTH / 2, 0, 0)

    // Tilts the plane's normal to face the camera's fixed viewing angle.
    // Rotating around X leaves the X axis itself untouched, which is what
    // keeps the fill-offset math below a plain world-space subtraction.
    const euler = new THREE.Euler(-PITCH, 0, 0)
    this.quaternion = new THREE.Quaternion().setFromEuler(euler)

    const trackMat = new THREE.MeshBasicMaterial({
      color: TRACK_COLOR,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
    })
    const fillMat = new THREE.MeshBasicMaterial({
      color: FILL_COLOR,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    })

    this.track = new THREE.InstancedMesh(trackGeo, trackMat, capacity)
    this.fill = new THREE.InstancedMesh(fillGeo, fillMat, capacity)
    for (const mesh of [this.track, this.fill]) {
      mesh.frustumCulled = false
      mesh.count = 0
      mesh.visible = false
      mesh.renderOrder = 6
    }
    this.fill.renderOrder = 7

    scene.add(this.track, this.fill)
  }

  sync(entries: readonly CooldownEntry[]): void {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!

      this.position.set(entry.worldX, entry.anchorY, entry.worldZ)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      this.track.setMatrixAt(i, this.matrix)

      const progress = Math.max(MIN_FILL, Math.min(1, entry.progress))
      this.position.set(entry.worldX - BAR_WIDTH / 2, entry.anchorY, entry.worldZ)
      this.scale.set(progress, 1, 1)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      this.fill.setMatrixAt(i, this.matrix)
      this.scale.set(1, 1, 1)
    }

    this.track.count = entries.length
    this.fill.count = entries.length
    this.track.visible = entries.length > 0
    this.fill.visible = entries.length > 0
    if (entries.length > 0) {
      this.track.instanceMatrix.needsUpdate = true
      this.fill.instanceMatrix.needsUpdate = true
    }
  }
}
