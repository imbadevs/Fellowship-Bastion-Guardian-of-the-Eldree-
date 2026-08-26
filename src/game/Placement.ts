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
  | { readonly kind: 'merging'; readonly source: PlacedBuilding; dragging: boolean }

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

  /** Lifts an existing Construct off the board for repositioning. Free. */
  beginMove(building: PlacedBuilding): void {
    const origin = building.cell
    this.registry.lift(building)
    this.setState({ kind: 'moving', building, origin, dragging: false })
    this.onMessage?.(`Tap a tile to move the ${building.def.name}`, true)
  }

  /**
   * Arms merge-select mode: choose another Construct of the same kind to
   * combine into `source`'s tier-2 upgrade. `source` itself never moves or
   * lifts — only the target selection is pending — so this covers both
   * triggers: a tap (from the InspectPanel's Merge button, `dragging` false)
   * and a long-press-drag lifted straight off the board (`dragging` true,
   * see InputController's long-press handling — the same "drag races the
   * camera pan" constraint that kept Move tap-only applies here, so the drag
   * variant only exists behind that disambiguation, not as the default).
   */
  beginMerge(source: PlacedBuilding, dragging = false): void {
    if (!source.def.upgradesTo) return
    this.setState({ kind: 'merging', source, dragging })
    this.onMessage?.(
      dragging ? `Drag onto another ${source.def.name} to merge` : `Tap another ${source.def.name} to merge`,
      true,
    )
  }

  sell(building: PlacedBuilding): void {
    const refund = BuildingRegistry.refundFor(building.def)
    this.registry.remove(building)
    this.economy.grant(refund)
    this.onMessage?.(`Sold ${building.def.name} · +${refund}g`, true)
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
    // Merging never attaches these listeners in the first place (it is
    // tap-only, like Move); the guard is here only so TypeScript can see
    // `dragging` is safe to write below.
    if (this.current.kind === 'idle' || this.current.kind === 'merging') return
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
    // Merging is tap-only — its eligible targets are shown up front by a
    // dedicated highlight (see MergeHighlight), not this drag-hover preview.
    if (state.kind === 'idle' || state.kind === 'merging') return

    if (!cell) {
      this.ghost.hide()
      this.marker.hide()
      return
    }

    // Dragging a purchase over a matching Construct previews the *merge
    // result*, not the card being dragged — the ghost shows what dropping
    // here actually produces.
    const mergeTarget = state.kind === 'placing' ? this.mergeTargetAt(state.defId, cell) : null
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

    if (state.kind === 'merging') {
      this.commitMerge(state.source, cell, state.dragging)
      return
    }

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
      this.registry.drop(state.building, cell)
      this.onMessage?.(`${state.building.def.name} moved`, true)
    }
    this.clear()
  }

  /**
   * Buying `defId` directly onto a matching, already-placed Construct merges
   * the two into the tier-2 upgrade instead of failing as "occupied" — the
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
   * Resolves a merge attempt. The target must be a different Construct of the
   * same kind as the source — anything else (empty ground, a mismatched
   * building, tapping the source again) is an invalid selection. For a tap
   * that stays armed, so a mistap costs nothing and the player can just try
   * again; for a drag, the finger has already lifted, so there is nothing
   * left to "stay armed" for and it cancels instead, matching every other
   * drag-based action in this class.
   */
  private commitMerge(source: PlacedBuilding, cell: Cell, dragging: boolean): void {
    const upgradeId = source.def.upgradesTo
    const target = this.registry.at(cell)

    if (!upgradeId || !target || target.entityId === source.entityId || target.def.id !== source.def.id) {
      this.onMessage?.('Choose a matching Construct to merge', false)
      if (dragging) this.cancel()
      return
    }

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
    } else if (state.kind === 'merging') {
      this.onMessage?.('Merge cancelled', false)
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
