/**
 * Uniform-grid broadphase over the XZ plane.
 *
 * Fixed, preallocated buckets rather than a Map of arrays: this is rebuilt every
 * tick, and per-tick allocation is the main source of GC jank on mobile.
 * Overflow past a bucket's capacity is dropped rather than grown — with a cell
 * sized to roughly one hex, a bucket that full means bodies are already
 * overlapping and one more neighbour will not change the steering result.
 *
 * Used for separation in M3, and for target acquisition from M4.
 */
export class SpatialHash {
  private readonly buckets: Int16Array
  private readonly counts: Uint8Array
  private readonly dim: number
  private readonly cellSize: number
  private readonly origin: number
  private readonly bucketCapacity: number

  constructor(extent: number, cellSize = 1.5, bucketCapacity = 12) {
    this.cellSize = cellSize
    this.origin = -extent
    this.dim = Math.max(1, Math.ceil((extent * 2) / cellSize))
    this.bucketCapacity = bucketCapacity
    this.buckets = new Int16Array(this.dim * this.dim * bucketCapacity)
    this.counts = new Uint8Array(this.dim * this.dim)
  }

  clear(): void {
    this.counts.fill(0)
  }

  private cellIndex(x: number, z: number): number {
    const cx = Math.floor((x - this.origin) / this.cellSize)
    const cz = Math.floor((z - this.origin) / this.cellSize)
    if (cx < 0 || cz < 0 || cx >= this.dim || cz >= this.dim) return -1
    return cz * this.dim + cx
  }

  insert(id: number, x: number, z: number): void {
    const cell = this.cellIndex(x, z)
    if (cell < 0) return
    const count = this.counts[cell]!
    if (count >= this.bucketCapacity) return
    this.buckets[cell * this.bucketCapacity + count] = id
    this.counts[cell] = count + 1
  }

  /**
   * Writes ids within `radius` of (x, z) into `out` and returns how many.
   * Results are approximate at the bucket level; callers do the exact distance test.
   */
  query(x: number, z: number, radius: number, out: Int16Array): number {
    const min = Math.max(0, Math.floor((x - radius - this.origin) / this.cellSize))
    const max = Math.min(this.dim - 1, Math.floor((x + radius - this.origin) / this.cellSize))
    const minZ = Math.max(0, Math.floor((z - radius - this.origin) / this.cellSize))
    const maxZ = Math.min(this.dim - 1, Math.floor((z + radius - this.origin) / this.cellSize))

    let n = 0
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = min; cx <= max; cx++) {
        const cell = cz * this.dim + cx
        const count = this.counts[cell]!
        const base = cell * this.bucketCapacity
        for (let i = 0; i < count; i++) {
          if (n >= out.length) return n
          out[n++] = this.buckets[base + i]!
        }
      }
    }
    return n
  }
}
