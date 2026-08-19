/**
 * Axial hex coordinates, pointy-top orientation.
 *
 * Pointy-top is deliberate: a pointy-top hex is taller than it is wide
 * (w = sqrt(3)*size, h = 2*size), so a radius-N field packs into a portrait
 * viewport with less wasted horizontal space than flat-top would.
 *
 * Reference: https://www.redblobgames.com/grids/hexagons/
 */

export interface Hex {
  readonly q: number
  readonly r: number
}

/** Neighbour directions in axial space, clockwise from east. */
export const HEX_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

export function hex(q: number, r: number): Hex {
  return { q, r }
}

/** Stable string key for use in Map/Set. */
export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r
}

export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r }
}

export function hexScale(h: Hex, k: number): Hex {
  return { q: h.q * k, r: h.r * k }
}

export function hexNeighbor(h: Hex, direction: number): Hex {
  const dir = HEX_DIRECTIONS[((direction % 6) + 6) % 6]!
  return hexAdd(h, dir)
}

export function hexNeighbors(h: Hex): Hex[] {
  return HEX_DIRECTIONS.map((d) => hexAdd(h, d))
}

/** Distance in hex steps. Uses the cube-coordinate identity s = -q - r. */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  const ds = -dq - dr
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2
}

/** Ring index of a hex measured from the origin. */
export function hexRing(h: Hex): number {
  return (Math.abs(h.q) + Math.abs(h.r) + Math.abs(-h.q - h.r)) / 2
}

/** The `radius` cells forming a single ring around `center`. Empty ring 0 returns [center]. */
export function hexRingCells(center: Hex, radius: number): Hex[] {
  if (radius <= 0) return [{ ...center }]
  const results: Hex[] = []
  // Walk to the ring's starting corner, then trace each of the 6 edges.
  let current = hexAdd(center, hexScale(HEX_DIRECTIONS[4]!, radius))
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      results.push(current)
      current = hexNeighbor(current, side)
    }
  }
  return results
}

/** All cells within `radius` of `center`, ordered outward ring by ring. */
export function hexSpiral(center: Hex, radius: number): Hex[] {
  const results: Hex[] = [{ ...center }]
  for (let ring = 1; ring <= radius; ring++) {
    results.push(...hexRingCells(center, ring))
  }
  return results
}

/**
 * Round fractional axial coordinates to the nearest hex.
 * Rounds in cube space and repairs the component with the largest error so
 * the q + r + s = 0 constraint always holds.
 */
export function hexRound(qf: number, rf: number): Hex {
  const sf = -qf - rf
  let q = Math.round(qf)
  let r = Math.round(rf)
  const s = Math.round(sf)

  const dq = Math.abs(q - qf)
  const dr = Math.abs(r - rf)
  const ds = Math.abs(s - sf)

  if (dq > dr && dq > ds) {
    q = -r - s
  } else if (dr > ds) {
    r = -q - s
  }
  return { q, r }
}
