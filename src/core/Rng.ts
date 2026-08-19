/**
 * Seeded PRNG (mulberry32).
 *
 * Every random decision in the simulation draws from one of these so a run is
 * reproducible from its seed alone — which is what makes the M7 balance harness
 * (thousands of scripted runs) and shareable seeds possible later.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive)
  }
}
