import { BUILDINGS, SELL_REFUND, type BuildingDef, type BuildingId } from '../data/buildings'
import { CellState } from '../data/grid'
import type { Cell, HexGrid } from '../hex/HexGrid'

export interface PlacedBuilding {
  readonly entityId: number
  readonly def: BuildingDef
  cell: Cell
  /** Combat entity id in the Sim's World, or -1 before the sim hook attaches it. */
  simId: number
}

export const enum PlacementError {
  Ok,
  OffBoard,
  Locked,
  Sacred,
  Occupied,
  Unaffordable,
}

export function placementErrorText(error: PlacementError): string {
  switch (error) {
    case PlacementError.OffBoard:
      return 'Outside the bastion'
    case PlacementError.Locked:
      return 'Ring not yet unlocked'
    case PlacementError.Sacred:
      return 'The Eldree stands here'
    case PlacementError.Occupied:
      return 'Tile already built on'
    case PlacementError.Unaffordable:
      return 'Not enough gold'
    default:
      return ''
  }
}

/**
 * Owns which Construct sits on which tile.
 *
 * Occupancy is written onto the cell itself, so M3's flow field can read build
 * state straight off the grid without consulting this registry.
 */
export class BuildingRegistry {
  private readonly buildings = new Map<number, PlacedBuilding>()
  private readonly byCell = new Map<number, PlacedBuilding>()
  private nextId = 1

  /** Fired with the building type whose instance set needs re-uploading. */
  onTypeChanged: ((id: BuildingId) => void) | null = null
  /** Fired so a caller can mirror placement into the combat simulation. */
  onPlaced: ((building: PlacedBuilding) => void) | null = null
  onRemoved: ((building: PlacedBuilding) => void) | null = null
  onMoved: ((building: PlacedBuilding) => void) | null = null
  /**
   * Fired instead of `onRemoved`/`onPlaced` for a merge — the caller needs
   * both the outgoing Constructs and the new one together, in one event, so
   * it can carry the combined garrison across rather than tearing it down
   * and starting the upgrade from an empty roster.
   */
  onMerged: ((sources: readonly PlacedBuilding[], result: PlacedBuilding) => void) | null = null

  constructor(private readonly grid: HexGrid) {}

  get count(): number {
    return this.buildings.size
  }

  all(): Iterable<PlacedBuilding> {
    return this.buildings.values()
  }

  ofType(id: BuildingId): PlacedBuilding[] {
    const out: PlacedBuilding[] = []
    for (const b of this.buildings.values()) if (b.def.id === id) out.push(b)
    return out
  }

  at(cell: Cell): PlacedBuilding | undefined {
    return this.byCell.get(cell.index)
  }

  /** Whether `cell` could receive a Construct, ignoring cost. */
  validateCell(cell: Cell | null): PlacementError {
    if (!cell) return PlacementError.OffBoard
    // Checked before the unlock test: ring 0 is never Open, and reporting it as
    // "locked until wave N" would promise an expansion that never comes.
    if (cell.state === CellState.Eldree) return PlacementError.Sacred
    if (!this.grid.isUnlocked(cell)) return PlacementError.Locked
    if (cell.occupantId >= 0) return PlacementError.Occupied
    return PlacementError.Ok
  }

  place(defId: BuildingId, cell: Cell): PlacedBuilding | null {
    if (this.validateCell(cell) !== PlacementError.Ok) return null

    const building: PlacedBuilding = {
      entityId: this.nextId++,
      def: BUILDINGS[defId],
      cell,
      simId: -1,
    }
    this.buildings.set(building.entityId, building)
    this.byCell.set(cell.index, building)
    cell.occupantId = building.entityId
    this.onTypeChanged?.(defId)
    this.onPlaced?.(building)
    return building
  }

  remove(building: PlacedBuilding): void {
    this.buildings.delete(building.entityId)
    this.byCell.delete(building.cell.index)
    building.cell.occupantId = -1
    this.onTypeChanged?.(building.def.id)
    this.onRemoved?.(building)
  }

  /** Detaches a building from the board without destroying it, for repositioning. */
  lift(building: PlacedBuilding): void {
    this.byCell.delete(building.cell.index)
    building.cell.occupantId = -1
    this.onTypeChanged?.(building.def.id)
  }

  /** Re-attaches a lifted building. Returns false if the target is not valid. */
  drop(building: PlacedBuilding, cell: Cell): boolean {
    if (this.validateCell(cell) !== PlacementError.Ok) return false
    building.cell = cell
    this.byCell.set(cell.index, building)
    cell.occupantId = building.entityId
    this.onTypeChanged?.(building.def.id)
    this.onMoved?.(building)
    return true
  }

  /**
   * Removes `sources` (one or two Constructs) and raises their upgrade on
   * `cell` in their place. Deliberately does not go through `remove`/`place`
   * — those fire `onRemoved`/`onPlaced`, which the sim wiring uses to tear
   * down a garrison on removal and start a fresh one at zero on placement.
   * A merge needs the two treated as one transition, not two independent
   * events, so the sim can carry the combined garrison across instead.
   */
  merge(sources: readonly PlacedBuilding[], upgradeId: BuildingId, cell: Cell): PlacedBuilding | null {
    if (this.validateCell(cell) !== PlacementError.Ok && !sources.some((s) => s.cell.index === cell.index)) {
      return null
    }

    for (const source of sources) {
      this.buildings.delete(source.entityId)
      this.byCell.delete(source.cell.index)
      source.cell.occupantId = -1
    }

    const result: PlacedBuilding = {
      entityId: this.nextId++,
      def: BUILDINGS[upgradeId],
      cell,
      simId: -1,
    }
    this.buildings.set(result.entityId, result)
    this.byCell.set(cell.index, result)
    cell.occupantId = result.entityId

    const changedTypes = new Set(sources.map((s) => s.def.id))
    changedTypes.add(upgradeId)
    for (const id of changedTypes) this.onTypeChanged?.(id)
    this.onMerged?.(sources, result)
    return result
  }

  static refundFor(def: BuildingDef): number {
    return Math.floor(def.cost * SELL_REFUND)
  }
}
