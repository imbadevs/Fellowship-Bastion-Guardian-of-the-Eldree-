import * as THREE from 'three'
import type { CameraRig } from './CameraRig'
import type { HexGridView } from './HexGridView'
import { CellState } from '../data/grid'
import type { Cell, HexGrid } from '../hex/HexGrid'

/** Movement beyond this many CSS pixels turns a tap into a drag. */
const TAP_SLOP = 10
const TAP_MAX_MS = 400
/** How long a stationary press on an eligible Construct takes to pick it up. */
const LONG_PRESS_MS = 180
/** Matches Placement's TOUCH_PICK_OFFSET — the finger covers the tile otherwise. */
const TOUCH_PICK_OFFSET = 64

interface PointerState {
  x: number
  y: number
  startX: number
  startY: number
  startTime: number
  moved: boolean
  /** setTimeout id for a pending long-press pickup, 0 if none is armed. */
  holdTimer: number
  /** True once the hold has fired and this pointer is carrying a Construct. */
  buildingDrag: boolean
}

/**
 * Touch and mouse handling for the board.
 *
 * One finger pans, two fingers pinch-zoom and pan together, a tap selects a
 * tile. Pointer events cover mouse, touch and pen in one path; `touch-action:
 * none` on the canvas stops the browser stealing the gesture for page scroll.
 *
 * A long-press on a placed Construct is a fourth gesture, layered on
 * carefully: starting a drag straight from the board would otherwise be
 * indistinguishable from panning, which is exactly why Move stayed tap-only
 * for so long. The disambiguation is a hold delay — a quick drag from
 * anywhere, including a built tile, still pans immediately; only a press
 * that stays still past `LONG_PRESS_MS` picks the Construct up. Panning is
 * suppressed only for that brief wait, and only on tiles the caller flags as
 * candidates (`onBuildingDragCandidate`), not the whole board.
 */
export class InputController {
  onSelect: ((cell: Cell | null) => void) | null = null
  onHover: ((cell: Cell | null) => void) | null = null
  /** Should a long-press on this cell arm a building drag at all? */
  onBuildingDragCandidate: ((cell: Cell) => boolean) | null = null
  onBuildingDragStart: ((cell: Cell) => void) | null = null
  /** `cell` is the touch-offset-adjusted board target under the finger right now, if any. */
  onBuildingDragMove: ((clientX: number, clientY: number, cell: Cell | null) => void) | null = null
  /**
   * `cell` is the touch-offset-adjusted drop target, or null if released off
   * the board. `clientX`/`clientY` are the raw, unadjusted release point —
   * for hit-testing DOM drop zones (like the recycle icon), which the finger
   * is actually aimed at, not the offset board target.
   */
  onBuildingDragEnd: ((cell: Cell | null, clientX: number, clientY: number) => void) | null = null

  private readonly pointers = new Map<number, PointerState>()
  private readonly hits: THREE.Intersection[] = []
  private readonly groundHit = new THREE.Vector3()
  private pinchDistance = 0
  private hasHover = false

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly rig: CameraRig,
    private readonly gridView: HexGridView,
    private readonly grid: HexGrid,
  ) {
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  /**
   * Cell under a screen position.
   *
   * Tries an exact raycast against the tile instances first, which respects
   * per-ring elevation. Tiles are inset by 6% though, so a ray can slip through
   * the gap between two of them — and along the board's zigzag edge it can pass
   * through the notches between pointy tops. Falling back to the ground plane
   * and rounding to the nearest hex closes both holes, which matters most while
   * dragging: without it the ghost blinks out every time the finger crosses a
   * tile boundary.
   */
  pick(clientX: number, clientY: number): Cell | null {
    const rect = this.canvas.getBoundingClientRect()
    const ray = this.rig.rayFromScreen(clientX, clientY, rect)

    this.hits.length = 0
    this.gridView.mesh.raycast(ray, this.hits)
    if (this.hits.length > 0) {
      this.hits.sort((a, b) => a.distance - b.distance)
      const id = this.hits[0]!.instanceId
      if (id !== undefined) return this.gridView.cellFromInstanceId(id) ?? null
    }

    const ground = this.rig.screenToGround(clientX, clientY, rect, this.groundHit)
    if (!ground) return null
    const cell = this.grid.fromWorld(ground.x, ground.z)
    // Rounding can land on a ring that has not been built out yet; those tiles
    // are not on the board, so treat them as empty space.
    return cell && cell.state !== CellState.Locked ? cell : null
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId)
    const state: PointerState = {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
      moved: false,
      holdTimer: 0,
      buildingDrag: false,
    }
    this.pointers.set(e.pointerId, state)

    if (this.pointers.size === 2) {
      // A second finger joining means pinch/pan; a lone-finger hold no longer applies.
      for (const s of this.pointers.values()) this.cancelHold(s)
      this.pinchDistance = this.currentPinchDistance()
      return
    }

    if (this.pointers.size === 1 && this.onBuildingDragCandidate) {
      const cell = this.pick(e.clientX, e.clientY)
      if (cell && this.onBuildingDragCandidate(cell)) {
        state.holdTimer = window.setTimeout(() => this.beginBuildingDrag(e.pointerId, cell), LONG_PRESS_MS)
      }
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    const state = this.pointers.get(e.pointerId)

    if (!state) {
      // No button held: mouse hover only. Touch never produces these.
      if (e.pointerType === 'mouse') {
        this.hasHover = true
        this.onHover?.(this.pick(e.clientX, e.clientY))
      }
      return
    }

    const dx = e.clientX - state.x
    const dy = e.clientY - state.y
    state.x = e.clientX
    state.y = e.clientY
    const totalMove = Math.hypot(e.clientX - state.startX, e.clientY - state.startY)
    if (totalMove > TAP_SLOP) state.moved = true

    if (state.buildingDrag) {
      const offset = e.pointerType === 'touch' ? TOUCH_PICK_OFFSET : 0
      this.onBuildingDragMove?.(e.clientX, e.clientY, this.pick(e.clientX, e.clientY - offset))
      return
    }

    if (state.holdTimer !== 0) {
      if (totalMove > TAP_SLOP) {
        // Moved too far to be a hold — let it resolve as an ordinary pan below.
        this.cancelHold(state)
      } else {
        // Still within the window where this could become a pickup; freeze
        // the camera rather than pan a few pixels and yank back on pickup.
        return
      }
    }

    if (this.pointers.size === 1) {
      this.rig.panByPixels(dx, dy, this.canvas.clientHeight)
    } else if (this.pointers.size === 2 && ![...this.pointers.values()].some((s) => s.buildingDrag)) {
      const distance = this.currentPinchDistance()
      if (this.pinchDistance > 0 && distance > 0) {
        this.rig.zoomBy(distance / this.pinchDistance)
      }
      this.pinchDistance = distance
      // Halved because both pointers report the same translation.
      this.rig.panByPixels(dx / 2, dy / 2, this.canvas.clientHeight)
    }
  }

  private onPointerUp = (e: PointerEvent): void => {
    const state = this.pointers.get(e.pointerId)
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) this.pinchDistance = 0
    if (!state) return

    this.cancelHold(state)

    if (state.buildingDrag) {
      const offset = e.pointerType === 'touch' ? TOUCH_PICK_OFFSET : 0
      this.onBuildingDragEnd?.(this.pick(e.clientX, e.clientY - offset), e.clientX, e.clientY)
      return
    }

    const heldMs = performance.now() - state.startTime
    if (!state.moved && heldMs < TAP_MAX_MS) {
      this.onSelect?.(this.pick(e.clientX, e.clientY))
    }
  }

  private onPointerLeave = (): void => {
    if (this.hasHover) {
      this.hasHover = false
      this.onHover?.(null)
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    this.rig.zoomBy(e.deltaY > 0 ? 0.9 : 1 / 0.9)
  }

  private beginBuildingDrag(pointerId: number, cell: Cell): void {
    const state = this.pointers.get(pointerId)
    // The pointer may already have lifted before the hold elapsed; clearTimeout
    // in that path prevents this callback from firing at all, but guard anyway.
    if (!state) return
    state.holdTimer = 0
    state.buildingDrag = true
    this.onBuildingDragStart?.(cell)
  }

  private cancelHold(state: PointerState): void {
    if (state.holdTimer !== 0) {
      window.clearTimeout(state.holdTimer)
      state.holdTimer = 0
    }
  }

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()]
    if (!a || !b) return 0
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
}
