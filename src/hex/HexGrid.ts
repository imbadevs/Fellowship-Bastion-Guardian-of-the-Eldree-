import { hexKey, hexRing, hexSpiral, type Hex } from './Hex'
import { HexLayout } from './HexLayout'
import { BOARD_RADIUS, CellState, HEX_SIZE, RING_UNLOCK_WAVE } from '../data/grid'

export interface Cell {
  readonly hex: Hex
  readonly ring: number
  /** Index into the flat cell array, and also the render instance index. */
  readonly index: number
  readonly worldX: number
  readonly worldZ: number
  /** Top surface height. Buildings sit at this Y. */
  readonly surfaceY: number
  state: CellState
  /** Building entity id once M2 lands, -1 while empty. */
  occupantId: number
}

/**
 * The board. Owns cell identity, occupancy and ring unlocking.
 *
 * Cells are stored in a flat array ordered outward from the centre by
 * `hexSpiral`, so a cell's array index doubles as its render instance index
 * and inner rings occupy the low indices.
 */
export class HexGrid {
  readonly layout: HexLayout
  readonly cells: Cell[] = []
  private readonly byKey = new Map<string, Cell>()

  constructor(
    public readonly radius: number = BOARD_RADIUS,
    size: number = HEX_SIZE,
  ) {
    this.layout = new HexLayout(size)

    for (const h of hexSpiral({ q: 0, r: 0 }, radius)) {
      const ring = hexRing(h)
      const cell: Cell = {
        hex: h,
        ring,
        index: this.cells.length,
        worldX: this.layout.toWorldX(h),
        worldZ: this.layout.toWorldZ(h),
        surfaceY: 0,
        state: ring === 0 ? CellState.Eldree : CellState.Locked,
        occupantId: -1,
      }
      this.cells.push(cell)
      this.byKey.set(hexKey(h), cell)
    }
  }

  get size(): number {
    return this.layout.size
  }

  at(h: Hex): Cell | undefined {
    return this.byKey.get(hexKey(h))
  }

  /** Nearest cell to a ground-plane point, or undefined if that hex is off-board. */
  fromWorld(x: number, z: number): Cell | undefined {
    return this.at(this.layout.fromWorld(x, z))
  }

  /** Cell exists on the board right now. Locked rings are not yet in play. */
  isPlayable(cell: Cell): boolean {
    return cell.state !== CellState.Locked
  }

  /** Ring is open for building. Says nothing about whether something is on it. */
  isUnlocked(cell: Cell): boolean {
    return cell.state === CellState.Open
  }

  isBuildable(cell: Cell): boolean {
    return this.isUnlocked(cell) && cell.occupantId < 0
  }

  /** Opens every ring whose unlock wave has been reached. Returns cells that changed. */
  unlockForWave(wave: number): Cell[] {
    const changed: Cell[] = []
    for (const cell of this.cells) {
      if (cell.state !== CellState.Locked) continue
      const unlockAt = RING_UNLOCK_WAVE[cell.ring] ?? Number.POSITIVE_INFINITY
      if (wave >= unlockAt) {
        cell.state = CellState.Open
        changed.push(cell)
      }
    }
    return changed
  }

  /**
   * Cells that physically exist right now.
   *
   * Locked rings are not drawn at all — the bastion grows outward as it is
   * earned rather than sitting inside a pre-drawn shell of dead tiles.
   */
  visibleCells(): Cell[] {
    return this.cells.filter((cell) => cell.state !== CellState.Locked)
  }

  /** Outermost ring currently in play. */
  get visibleRing(): number {
    let max = 0
    for (const cell of this.cells) {
      if (cell.state !== CellState.Locked && cell.ring > max) max = cell.ring
    }
    return max
  }

  /** Distance from centre to the outer edge of the visible board, in world units. */
  get visibleWorldRadius(): number {
    let maxSq = 0
    for (const cell of this.cells) {
      if (cell.state === CellState.Locked) continue
      const d = cell.worldX * cell.worldX + cell.worldZ * cell.worldZ
      if (d > maxSq) maxSq = d
    }
    return Math.sqrt(maxSq) + this.layout.size
  }
}
