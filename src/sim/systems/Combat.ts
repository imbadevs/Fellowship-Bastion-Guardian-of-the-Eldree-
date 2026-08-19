import { DamageType, type World } from '../World'
import type { SpatialHash } from '../SpatialHash'

/**
 * Damage mitigation.
 *
 * Armour is a diminishing curve so stacking it never reaches immunity; magic
 * resistance is a straight fraction, hard-capped. The split is what makes
 * Trolls (high armour, no resistance) a Mage problem and Wraiths (high
 * resistance, no armour) an Archer problem.
 */
export function mitigate(amount: number, type: DamageType, armor: number, resist: number): number {
  if (type === DamageType.Magic) {
    return amount * (1 - Math.min(0.75, resist))
  }
  return amount * (100 / (100 + Math.max(0, armor)))
}

export function applyDamage(world: World, target: number, amount: number, type: DamageType): void {
  if (!world.isAlive(target)) return
  const dealt = mitigate(amount, type, world.armor[target]!, world.resist[target]!)
  world.hp[target] = world.hp[target]! - dealt
}

/** Damages everything hostile to `sourceTeam` within `radius` of the impact point. */
export function applySplash(
  world: World,
  spatial: SpatialHash,
  x: number,
  z: number,
  radius: number,
  amount: number,
  type: DamageType,
  sourceTeam: number,
  exclude: number,
  scratch: Int16Array,
): void {
  const found = spatial.query(x, z, radius, scratch)
  for (let i = 0; i < found; i++) {
    const other = scratch[i]!
    if (other === exclude || !world.alive[other]) continue
    if (world.team[other] === sourceTeam) continue
    const dx = world.posX[other]! - x
    const dz = world.posZ[other]! - z
    const reach = radius + world.radius[other]!
    if (dx * dx + dz * dz > reach * reach) continue
    applyDamage(world, other, amount, type)
  }
}
