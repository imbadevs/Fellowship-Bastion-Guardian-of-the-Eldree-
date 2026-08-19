import * as THREE from 'three'
import type { CameraRig } from './CameraRig'
import type { HexGridView } from './HexGridView'
import { CellState } from '../data/grid'
import type { Cell, HexGrid } from '../hex/HexGrid'

/** Movement beyond this many CSS pixels turns a tap into a drag. */
const TAP_SLOP = 10
const TAP_MAX_MS = 400

interface PointerState {
  x: number
  y: number
  startX: number
  startY: number
  startTime: number
  moved: boolean
}

/**
 * Touch and mouse handling for the board.
 *
 * One finger pans, two fingers pinch-zoom and pan together, a tap selects a
 * tile. Pointer events cover mouse, touch and pen in one path; `touch-action:
 * none` on the canvas stops the browser stealing the gesture for page scroll.
 */
export class InputController {
  onSelect: ((cell: Cell | null) => void) | null = null
  onHover: ((cell: Cell | null) => void) | null = null

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
    this.pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
      moved: false,
    })
    if (this.pointers.size === 2) this.pinchDistance = this.currentPinchDistance()
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
    if (Math.hypot(e.clientX - state.startX, e.clientY - state.startY) > TAP_SLOP) {
      state.moved = true
    }

    if (this.pointers.size === 1) {
      this.rig.panByPixels(dx, dy, this.canvas.clientHeight)
    } else if (this.pointers.size === 2) {
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

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()]
    if (!a || !b) return 0
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
}
