import { hexRound, type Hex } from './Hex'

const SQRT3 = Math.sqrt(3)

/**
 * Converts between axial hex coordinates and world space.
 *
 * The board lies on the XZ plane with +Y up, so hex "row" maps to world Z.
 * `size` is the centre-to-corner radius of a tile.
 */
export class HexLayout {
  constructor(public readonly size: number) {}

  /** Full width of one tile (corner-to-corner across the flats). */
  get tileWidth(): number {
    return SQRT3 * this.size
  }

  /** Full height of one tile, point to point. */
  get tileHeight(): number {
    return 2 * this.size
  }

  toWorldX(h: Hex): number {
    return this.size * (SQRT3 * h.q + (SQRT3 / 2) * h.r)
  }

  toWorldZ(h: Hex): number {
    return this.size * (1.5 * h.r)
  }

  /** World position of a hex centre, written into `out` to avoid allocation. */
  toWorld(h: Hex, out: { x: number; z: number }): { x: number; z: number } {
    out.x = this.toWorldX(h)
    out.z = this.toWorldZ(h)
    return out
  }

  /** Nearest hex to a point on the ground plane. */
  fromWorld(x: number, z: number): Hex {
    const q = ((SQRT3 / 3) * x - (1 / 3) * z) / this.size
    const r = ((2 / 3) * z) / this.size
    return hexRound(q, r)
  }
}
