import { BUILDINGS, type BuildingId } from '../data/buildings'
import type { Cell } from '../hex/HexGrid'
import type { GhostView } from '../view/GhostView'
import type { TileMarker } from '../view/TileMarker'
import { BuildingRegistry, PlacementError, placementErrorText, type PlacedBuilding } from './Buildings'
import type { Economy } from './Economy'

/**
 * How far above the fingertip the placement target is sampled, in CSS pixels.
 *
 * Without this the finger covers the tile it is choosing. Every touch-based
 * builder needs some version of it; 64px clears an average fingertip on a
 * ~2.5x display without the ghost feeling detached from the hand.
 */
const TOUCH_PICK_OFFSET = 64

const MARKER_VALID = 0x6ce07a
const MARKER_INVALID = 0xff5c48
/** Matches GhostView's merge tint and MergeHighlight's marker colour. */
const MARKER_MERGE = 0xc98cff

export type PlacementState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'placing'; readonly defId: BuildingId; dragging: boolean }
  | {
      readonly kind: 'moving'
      readonly building: PlacedBuilding
      readonly origin: Cell
      dragging: boolean
    }

export type PickFn = (clientX: number, clientY: number) => Cell | null

/**
 * Drives buying-and-placing and repositioning.
 *
 * Supports two input paths on purpose. Drag-and-drop is the headline gesture,
 * but a plain tap-card-then-tap-tile path is kept alive alongside it: dragging
 * across a phone screen one-handed is genuinely awkward, and the tap path costs
 * almost nothing once the commit logic is shared.
 */
export class Placement {
  private current: PlacementState = { kind: 'idle' }
  private hoveredCell: Cell | null = null

  onChange: ((state: PlacementState) => void) | null = null
  onMessage: ((text: string, ok: boolean) => void) | null = null
  /** Screen position of an in-flight drag, for the DOM chip that follows the finger. */
  onDragMove: ((clientX: number, clientY: number) => void) | null = null
  /**
   * Fires once a fresh purchase actually lands on a tile — distinct from
   * `onChange`'s return to 'idle', which also covers a cancelled or mistapped
   * attempt where nothing was built. Callers that need to know whether a
   * placement *succeeded*, not just that it ended, should use this instead.
   */
  onPlaced: ((defId: BuildingId) => void) | null = null

  constructor(
    private readonly registry: BuildingRegistry,
    private readonly economy: Economy,
    private readonly ghost: GhostView,
    private readonly marker: TileMarker,
    private readonly pick: PickFn,
  ) {}

  get state(): PlacementState {
    return this.current
  }

  get isActive(): boolean {
    return this.current.kind !== 'idle'
  }

  // --- entry points ---------------------------------------------------------

  /** Begins a drag from a tray card. Takes over the pointer until release. */
  beginPurchaseDrag(defId: BuildingId, event: PointerEvent): void {
    if (!this.economy.canAfford(BUILDINGS[defId].cost)) {
      this.onMessage?.(placementErrorText(PlacementError.Unaffordable), false)
      return
    }
    this.setState({ kind: 'placing', defId, dragging: true })
    this.attachDragListeners()
    this.trackPointer(event)
  }

  /** Begins tap-to-place mode from a tray card. */
  beginPurchaseHold(defId: BuildingId): void {
    if (!this.economy.canAfford(BUILDINGS[defId].cost)) {
      this.onMessage?.(placementErrorText(PlacementError.Unaffordable), false)
      return
    }
    this.setState({ kind: 'placing', defId, dragging: false })
    this.onMessage?.(`Tap a tile to raise the ${BUILDINGS[defId].name}`, true)
  }

  /**
   * Lifts an existing Construct off the board — the single entry point for
   * Move, Merge and Sell alike, disambiguated purely by where it lands:
   * an empty tile moves it, a matching Construct merges into it, and the
   * recycle zone (checked by the caller, not here) sells it. Free either way.
   *
   * `dragging` mirrors `beginPurchaseHold`/`beginPurchaseDrag`'s split: today
   * only the long-press-drag path (InputController) ever passes `true`, since
   * a plain drag from a board tile would otherwise race the camera pan, but
   * the tap-then-tap fallback stays wired in case that changes.
   */
  beginMove(building: PlacedBuilding, dragging = false): void {
    const origin = building.cell
    this.registry.lift(building)
    this.setState({ kind: 'moving', building, origin, dragging })
    this.onMessage?.(
      dragging ? 'Drag to move, merge, or drop on the recycle icon to sell' : `Tap a tile to move the ${building.def.name}`,
      true,
    )
  }

  /**
   * Sells the Construct currently lifted mid-drag — the recycle-zone drop
   * outcome. `registry.remove` is safe to call on an already-lifted building:
   * `lift()` only cleared its cell occupancy, the entity itself is untouched.
   */
  sellDragged(): void {
    if (this.current.kind !== 'moving') return
    const { building } = this.current
    const refund = BuildingRegistry.refundFor(building.def)
    this.registry.remove(building)
    this.economy.grant(refund)
    this.onMessage?.(`Sold ${building.def.name} · +${refund}g`, true)
    this.clear()
  }

  // --- tap path -------------------------------------------------------------

  /** Handles a board tap while a placement is pending. Returns true if consumed. */
  tapAt(cell: Cell | null): boolean {
    if (this.current.kind === 'idle') return false
    // A tap on empty space is the cancel affordance in tap mode.
    if (!cell) {
      this.cancel()
      return true
    }
    this.commit(cell)
    return true
  }

  // --- drag path ------------------------------------------------------------

  private attachDragListeners(): void {
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerCancel)
  }

  private detachDragListeners(): void {
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerCancel)
  }

  private onPointerMove = (event: PointerEvent): void => {
    this.trackPointer(event)
  }

  private onPointerUp = (event: PointerEvent): void => {
    this.detachDragListeners()
    // These listeners are only ever attached for a shop-card drag (see
    // `beginPurchaseDrag`); a board-to-board move/merge/sell drag is driven
    // externally by InputController's long-press handling instead, so
    // 'moving' never reaches here in practice. The guard is just for
    // TypeScript to see `dragging` is safe to write below.
    if (this.current.kind === 'idle') return
    this.current.dragging = false

    const cell = this.pickWithOffset(event)
    // A release back over the tray, or off the board, abandons the placement
    // rather than dumping the Construct on a random tile.
    if (!cell) {
      this.cancel()
      return
    }
    this.commit(cell)
  }

  private onPointerCancel = (): void => {
    this.detachDragListeners()
    this.cancel()
  }

  private trackPointer(event: PointerEvent): void {
    this.onDragMove?.(event.clientX, event.clientY)
    this.preview(this.pickWithOffset(event))
  }

  private pickWithOffset(event: PointerEvent): Cell | null {
    const offset = event.pointerType === 'touch' ? TOUCH_PICK_OFFSET : 0
    return this.pick(event.clientX, event.clientY - offset)
  }

  // --- shared ---------------------------------------------------------------

  private preview(cell: Cell | null): void {
    this.hoveredCell = cell
    const state = this.current
    if (state.kind === 'idle') return

    if (!cell) {
      this.ghost.hide()
      this.marker.hide()
      return
    }

    // Dragging a purchase or a lifted Construct over a matching Construct
    // previews the *merge result*, not the thing being dragged — the ghost
    // shows what dropping here actually produces.
    const mergeTarget =
      state.kind === 'placing'
        ? this.mergeTargetAt(state.defId, cell)
        : this.mergeTargetAt(state.building.def.id, cell)
    const defId = mergeTarget
      ? mergeTarget.def.upgradesTo!
      : state.kind === 'placing'
        ? state.defId
        : state.building.def.id
    const error = this.check(cell, state)
    const valid = error === PlacementError.Ok

    this.ghost.show(defId, cell, mergeTarget ? (valid ? 'merge' : 'invalid') : valid ? 'valid' : 'invalid')
    this.marker.setColor(mergeTarget ? MARKER_MERGE : valid ? MARKER_VALID : MARKER_INVALID)
    this.marker.show(cell)
  }

  /**
   * Drives the live ghost/marker preview from an externally-tracked drag —
   * a board-to-board move/merge lifted via InputController's long-press,
   * which (unlike a shop-card drag) never runs through `trackPointer`.
   */
  previewAt(cell: Cell | null): void {
    this.preview(cell)
  }

  /** The Construct already on `cell` that buying `defId` would merge into, if any. */
  private mergeTargetAt(defId: BuildingId, cell: Cell | null): PlacedBuilding | null {
    if (!cell) return null
    const existing = this.registry.at(cell)
    if (!existing || existing.def.id !== defId || !existing.def.upgradesTo) return null
    return existing
  }

  private check(cell: Cell | null, state: PlacementState): PlacementError {
    if (state.kind === 'placing' && this.mergeTargetAt(state.defId, cell)) {
      return this.economy.canAfford(BUILDINGS[state.defId].cost) ? PlacementError.Ok : PlacementError.Unaffordable
    }
    // A move onto a matching Construct merges instead — free, since the
    // existing Construct was already paid for.
    if (state.kind === 'moving' && this.mergeTargetAt(state.building.def.id, cell)) {
      return PlacementError.Ok
    }
    const cellError = this.registry.validateCell(cell)
    if (cellError !== PlacementError.Ok) return cellError
    if (state.kind === 'placing' && !this.economy.canAfford(BUILDINGS[state.defId].cost)) {
      return PlacementError.Unaffordable
    }
    return PlacementError.Ok
  }

  private commit(cell: Cell): void {
    const state = this.current
    if (state.kind === 'idle') return

    // Affordability is gated here uniformly — including for a merge target,
    // since `check()` already accounts for one — so a tap-mode mistap on an
    // unaffordable drop stays armed exactly like every other case, instead of
    // the merge path quietly skipping that forgiveness.
    const error = this.check(cell, state)
    if (error !== PlacementError.Ok) {
      this.onMessage?.(placementErrorText(error), false)
      // Stay armed so a mistap does not cost the player their held Construct.
      if (!state.dragging) return
      this.cancel()
      return
    }

    if (state.kind === 'placing') {
      const mergeTarget = this.mergeTargetAt(state.defId, cell)
      if (mergeTarget) {
        this.commitPurchaseMerge(state.defId, mergeTarget, cell)
        return
      }
      const def = BUILDINGS[state.defId]
      if (!this.economy.spend(def.cost)) {
        this.onMessage?.(placementErrorText(PlacementError.Unaffordable), false)
        this.cancel()
        return
      }
      this.registry.place(state.defId, cell)
      this.onMessage?.(`${def.name} raised · -${def.cost}g`, true)
      this.onPlaced?.(state.defId)
    } else {
      const mergeTarget = this.mergeTargetAt(state.building.def.id, cell)
      if (mergeTarget) {
        this.commitMoveMerge(state.building, mergeTarget, cell)
        return
      }
      this.registry.drop(state.building, cell)
      this.onMessage?.(`${state.building.def.name} moved`, true)
    }
    this.clear()
  }

  /**
   * Buying `defId` directly onto a matching, already-placed Construct merges
   * the two into its upgrade instead of failing as "occupied" — the
   * headline gesture the shop dock is built for: drag a card straight onto
   * what you already have. Costs exactly what the fresh card would have cost
   * standing alone; the existing Construct was already paid for when it was
   * first raised, so merging itself adds no further toll.
   */
  private commitPurchaseMerge(defId: BuildingId, existing: PlacedBuilding, cell: Cell): void {
    const def = BUILDINGS[defId]
    const upgradeId = existing.def.upgradesTo!
    if (!this.economy.spend(def.cost)) {
      this.onMessage?.(placementErrorText(PlacementError.Unaffordable), false)
      this.cancel()
      return
    }
    this.registry.merge([existing], upgradeId, cell)
    this.onMessage?.(`${BUILDINGS[upgradeId].name} raised from the merge · -${def.cost}g`, true)
    this.onPlaced?.(defId)
    this.clear()
  }

  /**
   * Dropping a lifted Construct onto a matching one merges them instead of
   * failing "occupied" — the board-to-board counterpart to
   * `commitPurchaseMerge`, free since both Constructs were already paid for.
   */
  private commitMoveMerge(source: PlacedBuilding, target: PlacedBuilding, cell: Cell): void {
    const upgradeId = target.def.upgradesTo!
    this.registry.merge([source, target], upgradeId, cell)
    this.onMessage?.(`${BUILDINGS[upgradeId].name} raised from the merge`, true)
    this.clear()
  }

  /** Abandons the pending placement, returning a lifted building to its origin. */
  cancel(): void {
    const state = this.current
    if (state.kind === 'moving') {
      this.registry.drop(state.building, state.origin)
      this.onMessage?.('Move cancelled', false)
    }
    this.detachDragListeners()
    this.clear()
  }

  private clear(): void {
    this.ghost.hide()
    this.marker.hide()
    this.hoveredCell = null
    this.setState({ kind: 'idle' })
  }

  private setState(state: PlacementState): void {
    this.current = state
    this.onChange?.(state)
  }

  /** Re-evaluates the current preview, e.g. after gold changes mid-drag. */
  revalidate(): void {
    if (this.isActive) this.preview(this.hoveredCell)
  }
}
