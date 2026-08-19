import type { Cell, HexGrid } from '../hex/HexGrid'
import { hexNeighbors } from '../hex/Hex'

/**
 * Extra path cost for crossing a tile with a Construct on it.
 *
 * High enough that the horde routes around a defended line when a way exists,
 * finite so it can never be walled in completely. Impassable Constructs would
 * turn the game into a maze-building exercise and let one ring of Palisades
 * stall a wave forever.
 */
const BUILDING_COST = 6

/**
 * Per-tile routing toward the Eldree, as a Dijkstra field over the hex graph.
 *
 * Each cell stores the neighbour to walk to next; enemies steer toward that
 * cell's centre rather than along a fixed per-cell vector, which makes them
 * funnel naturally through gaps instead of moving in six discrete directions.
 *
 * Recomputed only when the board changes — a build, a sale, a ring unlock — not
 * per tick. At 61 cells a naive O(n^2) search is microseconds, so there is no
 * reason to reach for a heap.
 */
export class FlowField {
  /** Cell index to walk toward next, or -1 if this cell has no route. */
  readonly next: Int16Array
  readonly cost: Float32Array
  private readonly neighbourCache: Int16Array
  private static readonly UNREACHABLE = Number.POSITIVE_INFINITY

  constructor(private readonly grid: HexGrid) {
    const n = grid.cells.length
    this.next = new Int16Array(n)
    this.cost = new Float32Array(n)
    this.neighbourCache = new Int16Array(n * 6)
    this.cacheNeighbours()
    this.rebuild()
  }

  /** Adjacency never changes; only which cells are in play does. */
  private cacheNeighbours(): void {
    for (const cell of this.grid.cells) {
      const around = hexNeighbors(cell.hex)
      for (let d = 0; d < 6; d++) {
        const neighbour = this.grid.at(around[d]!)
        this.neighbourCache[cell.index * 6 + d] = neighbour ? neighbour.index : -1
      }
    }
  }

  rebuild(): void {
    const cells = this.grid.cells
    this.cost.fill(FlowField.UNREACHABLE)
    this.next.fill(-1)

    // The Eldree tile is the goal.
    const goal = cells[0]!
    this.cost[goal.index] = 0

    const visited = new Uint8Array(cells.length)
    for (;;) {
      let current = -1
      let best = FlowField.UNREACHABLE
      for (const cell of cells) {
        if (visited[cell.index] || !this.grid.isPlayable(cell)) continue
        const c = this.cost[cell.index]!
        if (c < best) {
          best = c
          current = cell.index
        }
      }
      if (current < 0) break
      visited[current] = 1

      for (let d = 0; d < 6; d++) {
        const neighbour = this.neighbourCache[current * 6 + d]!
        if (neighbour < 0 || visited[neighbour]) continue
        const cell = cells[neighbour]!
        if (!this.grid.isPlayable(cell)) continue

        const step = 1 + (cell.occupantId >= 0 ? BUILDING_COST : 0)
        const candidate = best + step
        if (candidate < this.cost[neighbour]!) {
          this.cost[neighbour] = candidate
          // Walking "toward the goal" means stepping to where we came from.
          this.next[neighbour] = current
        }
      }
    }
  }

  /** Cell to move toward from `cell`, or null at the goal or with no route. */
  nextCell(cell: Cell): Cell | null {
    const target = this.next[cell.index]!
    return target < 0 ? null : (this.grid.cells[target] ?? null)
  }
}
