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
 * Which era a wave belongs to, zero-based: waves 1–5 are era 0, 6–10 era 1,
 * and so on. An era ends on a hard wave, and clearing that hard wave is what
 * unlocks the next ring of board (see `RING_UNLOCK_WAVE`), so eras are the
 * unit the whole run is paced in.
 */
export function eraOf(wave: number): number {
  return Math.floor((wave - 1) / HARD_WAVE_INTERVAL)
}

/**
 * How the horde grows once past the authored table.
 *
 * The player's strength does not grow smoothly — it jumps at each hard wave,
 * when a new ring opens (a third more tiles to build on) and the gold from
 * holding the spike buys into it. Growth that was linear per wave therefore
 * fell further behind with every era. These compound per *era* instead, so
 * each ring the player earns is met by a horde that grew in the same step.
 */
const ERA_GROWTH = 1.5
/** The gentler ramp between waves inside a single era. */
const WAVE_GROWTH = 1.08
/**
 * Trolls and Wraiths grow faster than Orcs on top of that, so later eras are
 * answered with the right Constructs rather than simply more of them — armour
 * and magic resistance are the two problems raw volume cannot solve.
 */
const ELITE_GROWTH = 1.12

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

/** The last era the authored table covers — generated eras escalate from there. */
const AUTHORED_ERAS = eraOf(WAVES.length)

/**
 * How much tougher each individual foe gets per era past the authored table.
 *
 * The player's power grows in quality as well as quantity — merging turns
 * bodies into better bodies (see `TIER_SCALING`) — so a horde that only ever
 * grew in headcount would eventually be answered by a handful of tier-3
 * Constructs holding a whole board. Scaling the foes themselves keeps that
 * from settling, and does it without spending entity budget: a tougher wave
 * costs the same simulation as a weaker one of the same size.
 */
const ERA_TOUGHNESS = 1.18

/** Multiplier on an individual enemy's hp and damage at `wave`. 1 through the authored table. */
export function enemyToughness(wave: number): number {
  return ERA_TOUGHNESS ** Math.max(0, eraOf(wave) - AUTHORED_ERAS)
}

/**
 * The wave sent once the authored table runs out.
 *
 * Built from the table's final wave, escalated by how many eras have passed
 * since. Within an era it ramps gently; crossing into a new one is the step,
 * which is what makes surviving a hard wave feel like it moved the run into
 * a harder chapter rather than just surviving one bad night.
 */
function generated(wave: number): WaveDef {
  const eras = eraOf(wave) - AUTHORED_ERAS
  const withinEra = (wave - 1) % HARD_WAVE_INTERVAL
  const scale = ERA_GROWTH ** eras * WAVE_GROWTH ** withinEra
  const elite = scale * ELITE_GROWTH ** eras

  return {
    lanes: 6,
    groups: [
      orcs(Math.round(24 * scale), 0, 0.4),
      trolls(Math.round(8 * elite), 4),
      wraiths(Math.round(8 * elite), 7),
    ],
  }
}

/**
 * Waves past the authored table scale instead of ending the run, so the game
 * can be pushed until something breaks. The real 20-wave arc is authored at
 * M7.
 */
export function waveDef(wave: number): WaveDef {
  const base = WAVES[wave - 1] ?? generated(wave)
  return isHardWave(wave) ? harden(base) : base
}

/** Total spawns in a wave, for the HUD progress readout. */
export function waveTotal(def: WaveDef): number {
  let total = 0
  for (const group of def.groups) total += group.count
  return total
}
