import { EnemyKind } from './enemies'

/**
 * Wave schedule.
 *
 * The Eldree sits at the board's centre with no inherent front — the horde
 * attacks from all sides. `lanes` is how many evenly-spaced directions it
 * arrives from, which is the main pressure dial: the same enemy count
 * surrounding the board from six directions is a very different defensive
 * problem than the same count funnelling in from one.
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
  readonly lanes: number
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
  { lanes: 1, groups: [orcs(5, 0)] },
  { lanes: 2, groups: [orcs(8, 0)] },
  { lanes: 2, groups: [orcs(10, 0), trolls(1, 6)] },
  { lanes: 3, groups: [orcs(12, 0), trolls(2, 5)] },
  { lanes: 3, groups: [orcs(10, 0), wraiths(3, 4)] },
  { lanes: 4, groups: [orcs(14, 0), trolls(3, 6), wraiths(2, 10)] },
  { lanes: 4, groups: [orcs(16, 0), wraiths(5, 5)] },
  { lanes: 5, groups: [orcs(18, 0), trolls(5, 4), wraiths(4, 9)] },
  { lanes: 6, groups: [orcs(20, 0), trolls(6, 5), wraiths(6, 8)] },
  { lanes: 6, groups: [orcs(24, 0), trolls(8, 4), wraiths(8, 7)] },
]

/** Every Nth wave is a hard wave — a deliberate spike the player builds toward. */
export const HARD_WAVE_INTERVAL = 5

/** Hard waves surround the board from one more direction and send half again as many foes, closer together. */
const HARD_COUNT_SCALE = 1.5
const HARD_SPACING_SCALE = 0.85

export function isHardWave(wave: number): boolean {
  return wave > 0 && wave % HARD_WAVE_INTERVAL === 0
}

/**
 * Turns a wave into its hard-wave form.
 *
 * Layered on top of whatever the base wave would have been rather than
 * authored separately, so a hard wave is recognisably the same fight one
 * notch harder — same enemy mix, more of it, arriving from wider and faster.
 */
function harden(def: WaveDef): WaveDef {
  return {
    lanes: Math.min(6, def.lanes + 1),
    groups: def.groups.map((group) => ({
      ...group,
      count: Math.round(group.count * HARD_COUNT_SCALE),
      spacing: group.spacing * HARD_SPACING_SCALE,
    })),
  }
}

/**
 * Waves past the authored table scale instead of ending the run, so M3 can be
 * pushed until something breaks. The real 20-wave arc is authored at M7.
 */
export function waveDef(wave: number): WaveDef {
  const authored = WAVES[wave - 1]
  const base =
    authored ??
    (() => {
      const over = wave - WAVES.length
      const scale = 1 + over * 0.18
      return {
        lanes: 6,
        groups: [
          orcs(Math.round(24 * scale), 0, 0.4),
          trolls(Math.round(8 * scale), 4),
          wraiths(Math.round(8 * scale), 7),
        ],
      }
    })()

  return isHardWave(wave) ? harden(base) : base
}

/** Total spawns in a wave, for the HUD progress readout. */
export function waveTotal(def: WaveDef): number {
  let total = 0
  for (const group of def.groups) total += group.count
  return total
}
