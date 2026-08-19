import { EnemyKind } from './enemies'

/**
 * Wave schedule.
 *
 * `arcs` is how many directions the horde arrives from, which is the main
 * pressure dial: the same enemy count split across six approaches is a very
 * different defensive problem than the same count down one lane.
 */
export interface SpawnGroup {
  readonly kind: EnemyKind
  readonly count: number
  /** Seconds before this group starts, measured from the wave beginning. */
  readonly delay: number
  /** Seconds between individuals in the group. */
  readonly spacing: number
}

export interface WaveDef {
  readonly arcs: number
  readonly groups: readonly SpawnGroup[]
}

const orcs = (count: number, delay: number, spacing = 0.55): SpawnGroup => ({
  kind: EnemyKind.Orc,
  count,
  delay,
  spacing,
})
const trolls = (count: number, delay: number, spacing = 1.6): SpawnGroup => ({
  kind: EnemyKind.Troll,
  count,
  delay,
  spacing,
})
const wraiths = (count: number, delay: number, spacing = 1.0): SpawnGroup => ({
  kind: EnemyKind.Wraith,
  count,
  delay,
  spacing,
})

export const WAVES: readonly WaveDef[] = [
  { arcs: 1, groups: [orcs(5, 0)] },
  { arcs: 2, groups: [orcs(8, 0)] },
  { arcs: 2, groups: [orcs(10, 0), trolls(1, 6)] },
  { arcs: 3, groups: [orcs(12, 0), trolls(2, 5)] },
  { arcs: 3, groups: [orcs(10, 0), wraiths(3, 4)] },
  { arcs: 4, groups: [orcs(14, 0), trolls(3, 6), wraiths(2, 10)] },
  { arcs: 4, groups: [orcs(16, 0), wraiths(5, 5)] },
  { arcs: 5, groups: [orcs(18, 0), trolls(5, 4), wraiths(4, 9)] },
  { arcs: 6, groups: [orcs(20, 0), trolls(6, 5), wraiths(6, 8)] },
  { arcs: 6, groups: [orcs(24, 0), trolls(8, 4), wraiths(8, 7)] },
]

/**
 * Waves past the authored table scale instead of ending the run, so M3 can be
 * pushed until something breaks. The real 20-wave arc is authored at M7.
 */
export function waveDef(wave: number): WaveDef {
  const authored = WAVES[wave - 1]
  if (authored) return authored

  const over = wave - WAVES.length
  const scale = 1 + over * 0.18
  return {
    arcs: 6,
    groups: [
      orcs(Math.round(24 * scale), 0, 0.4),
      trolls(Math.round(8 * scale), 4),
      wraiths(Math.round(8 * scale), 7),
    ],
  }
}

/** Total spawns in a wave, for the HUD progress readout. */
export function waveTotal(def: WaveDef): number {
  let total = 0
  for (const group of def.groups) total += group.count
  return total
}
