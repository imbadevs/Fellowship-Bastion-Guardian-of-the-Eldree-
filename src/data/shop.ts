import { BUILDING_ORDER, BUILDINGS, type BuildingId } from './buildings'
import type { Rng } from '../core/Rng'

/**
 * Shop rarity.
 *
 * Purely a drafting-weight concept — it has no combat effect. Tier already
 * carries the balance (a Rare building's price and stats speak for
 * themselves); rarity only controls how early a wave sees it offered.
 */
export const enum Rarity {
  Common,
  Uncommon,
  Rare,
}

export const BUILDING_RARITY: Record<BuildingId, Rarity> = {
  barracks: Rarity.Common,
  'archery-range': Rarity.Common,
  palisade: Rarity.Common,
  'knights-hall': Rarity.Uncommon,
  'mage-spire': Rarity.Uncommon,
  ballista: Rarity.Uncommon,
  'rune-ward': Rarity.Uncommon,
  'healing-shrine': Rarity.Uncommon,
  warlodge: Rarity.Rare,
  bowspire: Rarity.Rare,
  'bastion-keep': Rarity.Rare,
  'arcane-obelisk': Rarity.Rare,
  'reinforced-palisade': Rarity.Rare,
  'heavy-ballista': Rarity.Rare,
  'rune-pillar': Rarity.Rare,
  'blessed-shrine': Rarity.Rare,
  // Tier-3 Constructs never appear in `BUILDING_ORDER`'s draft pool — merge-only
  // — but the map is a `Record<BuildingId, Rarity>`, so these still need an entry.
  warhost: Rarity.Rare,
  'stormwatch-spire': Rarity.Rare,
  'highguard-citadel': Rarity.Rare,
  'eldree-sanctum': Rarity.Rare,
  'stoneguard-wall': Rarity.Rare,
  'siege-ballista': Rarity.Rare,
  'rune-nexus': Rarity.Rare,
  'eternal-wellspring': Rarity.Rare,
}

export const RARITY_LABEL: Record<Rarity, string> = {
  [Rarity.Common]: 'Common',
  [Rarity.Uncommon]: 'Uncommon',
  [Rarity.Rare]: 'Rare',
}

/** CSS colours, keyed the same way so the panel never needs its own mapping. */
export const RARITY_COLOR: Record<Rarity, string> = {
  [Rarity.Common]: '#9aa3ad',
  [Rarity.Uncommon]: '#7fe08c',
  [Rarity.Rare]: '#7fb4ff',
}

interface RarityWeights {
  readonly common: number
  readonly uncommon: number
  readonly rare: number
}

/**
 * How the offer pool shifts as a run progresses.
 *
 * Commons dominate the opening waves, Rares only start appearing once a
 * garrison exists to make a 150g+ purchase a real choice rather than the only
 * thing the player can afford. Data-only, so a balance pass can retune this
 * without touching drafting logic.
 */
const WEIGHT_STAGES: ReadonlyArray<{ readonly minWave: number; readonly weights: RarityWeights }> = [
  { minWave: 1, weights: { common: 70, uncommon: 30, rare: 0 } },
  { minWave: 4, weights: { common: 45, uncommon: 40, rare: 15 } },
  { minWave: 7, weights: { common: 25, uncommon: 45, rare: 30 } },
  { minWave: 10, weights: { common: 15, uncommon: 40, rare: 45 } },
]

function weightsForWave(wave: number): RarityWeights {
  let result = WEIGHT_STAGES[0]!.weights
  for (const stage of WEIGHT_STAGES) {
    if (wave >= stage.minWave) result = stage.weights
  }
  return result
}

function weightOf(id: BuildingId, weights: RarityWeights): number {
  const rarity = BUILDING_RARITY[id]
  if (rarity === Rarity.Common) return weights.common
  if (rarity === Rarity.Uncommon) return weights.uncommon
  return weights.rare
}

function drawOne(weights: RarityWeights, rng: Rng): BuildingId {
  const pool = BUILDING_ORDER.filter((id) => weightOf(id, weights) > 0)
  const total = pool.reduce((sum, id) => sum + weightOf(id, weights), 0)

  let roll = rng.next() * total
  for (const id of pool) {
    roll -= weightOf(id, weights)
    if (roll <= 0) return id
  }
  return pool[pool.length - 1]!
}

/**
 * Draws `count` offers, independently — duplicates are possible and
 * intentional. Stacking copies of the same spawner is a real strategy, so the
 * draw must not artificially rule it out.
 */
export function drawOffer(wave: number, rng: Rng, count = 3): BuildingId[] {
  const weights = weightsForWave(wave)
  return Array.from({ length: count }, () => drawOne(weights, rng))
}

export function priceOf(id: BuildingId): number {
  return BUILDINGS[id].cost
}
