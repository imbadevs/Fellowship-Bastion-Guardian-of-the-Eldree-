import * as THREE from 'three'

/**
 * Downward tilt from the horizon.
 *
 * 62 degrees, not the 52 that reads best in landscape. In portrait the board's
 * horizontal extent is what binds the fit, so vertical screen space is free —
 * and a steeper tilt spends it, projecting the board taller without pushing the
 * camera back. Going fully top-down would recover the rest but flatten the
 * buildings and units, which need visible silhouettes.
 *
 * Exported because it never changes at runtime (the camera never rotates) and
 * any world-space UI meant to face the camera head-on — a cooldown bar, say —
 * needs this exact angle to tilt correctly. Redefining it locally would risk
 * silent drift if PITCH is ever retuned.
 */
export const PITCH = THREE.MathUtils.degToRad(62)

const ZOOM_IN_LIMIT = 0.42
const ZOOM_OUT_LIMIT = 1.12
/** Fraction of the board radius the camera target may stray from centre. */
const PAN_LIMIT = 0.5
/** Slack so the board does not touch the screen edges. */
const FIT_PADDING = 1.06

/**
 * Extra world-radius folded into the fit distance, beyond the board's own
 * edge, so nearby spawns read as on-screen rather than only becoming visible
 * once they have closed some distance. Loosely matches the sim's own spawn
 * margin (`SPAWN_MARGIN` + jitter in Sim.ts) — the two are independent by
 * design (view shouldn't import sim internals just for this), but tuned to
 * the same ballpark on purpose.
 *
 * The horde now attacks from every direction at once (see Sim.ts), so no
 * framing can keep the *entire* spawn ring on screen simultaneously the way
 * a single-approach design could — this only buys margin, not full coverage.
 */
const APPROACH_VISIBILITY = 2.4

/**
 * Nudges the framed board up-screen, as a fraction of board radius, to leave
 * room for the bottom-docked shop. Modest, and roughly symmetric top-to-
 * bottom on purpose — with the horde attacking from every direction, the
 * board itself has no "front" the framing should favour.
 */
const FRAME_BIAS = 0.16

/**
 * Orbit-free camera rig for a portrait board view.
 *
 * The camera keeps a fixed pitch and yaw and only pans over the ground plane
 * and dollies in/out. There is no rotation: on a phone, a rotatable board makes
 * "which side is the enemy coming from" harder to read, and costs a gesture.
 */
export class CameraRig {
  /** Point on the ground the camera is centred on. */
  readonly target = new THREE.Vector3()

  private fitDistance = 20
  private distance = 20
  private targetDistance = 20
  private boardRadius = 6
  private targetBoardRadius = 6

  private readonly offset = new THREE.Vector3()
  private readonly lookAt = new THREE.Vector3()
  private readonly raycaster = new THREE.Raycaster()
  // Sits at mean tile-surface height rather than y=0, so the plane fallback
  // lands within a few centimetres of where the tile tops actually are.
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.2)
  private readonly ndc = new THREE.Vector2()

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /**
   * Recomputes the distance at which the whole board fits the current viewport.
   *
   * `animate` eases the pull-back instead of snapping: a ring unlock is a
   * moment worth showing, and a hard cut to a wider view reads as a glitch.
   */
  fitBoard(boardRadius: number, animate = false): void {
    this.targetBoardRadius = boardRadius
    if (!animate) this.boardRadius = boardRadius
    const vFov = THREE.MathUtils.degToRad(this.camera.fov)
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect)

    // Fit against the board plus its approach margin, not the board alone —
    // `this.boardRadius` itself stays the true radius (fog and pan-limit
    // still key off that), this only widens the shot.
    const visibleRadius = boardRadius + APPROACH_VISIBILITY

    // Horizontal is the binding constraint in portrait; vertical extent is
    // foreshortened by the tilt, hence the sin(PITCH) term.
    const distH = visibleRadius / Math.tan(hFov / 2)
    const distV = (visibleRadius * Math.sin(PITCH)) / Math.tan(vFov / 2)

    const previousZoom = this.fitDistance > 0 ? this.targetDistance / this.fitDistance : 1
    this.fitDistance = Math.max(distH, distV) * FIT_PADDING
    this.targetDistance =
      this.fitDistance * THREE.MathUtils.clamp(previousZoom, ZOOM_IN_LIMIT, ZOOM_OUT_LIMIT)
    if (!animate) this.distance = this.targetDistance
    this.update()
  }

  /** Eases an animated fit toward its target. Driven by wall time, not sim time. */
  tick(dt: number): void {
    const settled =
      Math.abs(this.targetDistance - this.distance) < 0.002 &&
      Math.abs(this.targetBoardRadius - this.boardRadius) < 0.002
    if (settled) return

    // Frame-rate independent exponential ease.
    const k = 1 - Math.exp(-dt * 5)
    this.distance += (this.targetDistance - this.distance) * k
    this.boardRadius += (this.targetBoardRadius - this.boardRadius) * k
    this.update()
  }

  /** Radius the camera is currently framing. Fog tracks this, not the grid. */
  get framedRadius(): number {
    return this.boardRadius
  }

  /** Frames the whole board. */
  reset(): void {
    this.target.set(0, 0, 0)
    this.distance = this.fitDistance
    this.targetDistance = this.fitDistance
    this.update()
  }

  /** Current dolly distance from the target. Fog and LOD key off this. */
  get cameraDistance(): number {
    return this.distance
  }

  /** 0 = fully zoomed in, 1 = fully zoomed out. */
  get zoom01(): number {
    return THREE.MathUtils.inverseLerp(
      this.fitDistance * ZOOM_IN_LIMIT,
      this.fitDistance * ZOOM_OUT_LIMIT,
      this.distance,
    )
  }

  zoomBy(factor: number): void {
    // Pinch stays 1:1 with the fingers; easing it would feel like lag.
    this.distance = THREE.MathUtils.clamp(
      this.distance / factor,
      this.fitDistance * ZOOM_IN_LIMIT,
      this.fitDistance * ZOOM_OUT_LIMIT,
    )
    this.targetDistance = this.distance
    this.update()
  }

  /**
   * Pans by a screen-space delta in CSS pixels, keeping the world roughly
   * pinned to the finger.
   */
  panByPixels(dxPixels: number, dyPixels: number, viewportHeight: number): void {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov)
    const worldPerPixel = (2 * this.distance * Math.tan(vFov / 2)) / viewportHeight

    this.target.x -= dxPixels * worldPerPixel
    // Screen-vertical maps to world Z through the tilt, so undo the foreshortening.
    this.target.z -= (dyPixels * worldPerPixel) / Math.sin(PITCH)

    const limit = this.boardRadius * PAN_LIMIT
    const distFromCentre = Math.hypot(this.target.x, this.target.z)
    if (distFromCentre > limit) {
      const k = limit / distFromCentre
      this.target.x *= k
      this.target.z *= k
    }
    this.update()
  }

  update(): void {
    // The bias shifts the whole view, not the target, so pan clamping stays
    // measured from the true board centre.
    this.lookAt.copy(this.target)
    this.lookAt.z += this.boardRadius * FRAME_BIAS

    this.offset.set(0, Math.sin(PITCH), Math.cos(PITCH)).multiplyScalar(this.distance)
    this.camera.position.copy(this.lookAt).add(this.offset)
    this.camera.lookAt(this.lookAt)
  }

  /** Builds a raycaster from a CSS-pixel screen position. Reused, not allocated. */
  rayFromScreen(clientX: number, clientY: number, rect: DOMRect): THREE.Raycaster {
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.ndc, this.camera)
    return this.raycaster
  }

  /** Where a screen position lands on the ground plane, or null if it misses. */
  screenToGround(clientX: number, clientY: number, rect: DOMRect, out: THREE.Vector3): THREE.Vector3 | null {
    const ray = this.rayFromScreen(clientX, clientY, rect)
    return ray.ray.intersectPlane(this.groundPlane, out)
  }
}
