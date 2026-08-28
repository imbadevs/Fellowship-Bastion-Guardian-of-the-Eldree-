import { Category, EntityFlag, Team, type World } from '../World'
import type { SpatialHash } from '../SpatialHash'

/** How far a Knight's taunt reaches. */
export const TAUNT_RADIUS = 2.1

/**
 * Target acquisition.
 *
 * Targets are sticky: an entity keeps its current target while that target is
 * alive and still in reach. Re-acquiring nearest every tick makes units flicker
 * between two equidistant foes and never finish either — the classic "why is
 * nothing dying" bug in swarm combat.
 */

/** True if `id` may still hold `target`. */
function stillValid(world: World, id: number, target: number, reach: number): boolean {
  if (!world.isAlive(target)) return false
  const dx = world.posX[target]! - world.posX[id]!
  const dz = world.posZ[target]! - world.posZ[id]!
  const slack = reach + world.radius[target]!
  return dx * dx + dz * dz <= slack * slack
}

/**
 * Nearest hostile within `searchRadius` of (originX, originZ).
 *
 * Enemies searching for something to hit prefer a taunting Knight over anything
 * closer, which is the entire mechanical point of the class: it decides where
 * the horde commits, rather than just having more health.
 */
export function acquire(
  world: World,
  spatial: SpatialHash,
  id: number,
  originX: number,
  originZ: number,
  searchRadius: number,
  scratch: Int16Array,
  honourTaunt: boolean,
  /** Ordinary targets must be inside this; taunters may pull from `searchRadius`. */
  engageRadius = searchRadius,
  /** Skipped entirely — an enemy that just gave up on this Construct, still on cooldown. */
  avoidId = -1,
): number {
  const myTeam = world.team[id]!
  const found = spatial.query(originX, originZ, searchRadius, scratch)

  let best = -1
  let bestDistSq = Infinity
  let taunter = -1
  let taunterDistSq = Infinity

  for (let i = 0; i < found; i++) {
    const other = scratch[i]!
    if (other === id || other === avoidId || !world.alive[other]) continue
    if (world.team[other] === myTeam) continue

    const dx = world.posX[other]! - originX
    const dz = world.posZ[other]! - originZ
    const reach = searchRadius + world.radius[other]!
    const distSq = dx * dx + dz * dz
    if (distSq > reach * reach) continue

    if (honourTaunt && (world.flags[other]! & EntityFlag.Taunt) !== 0) {
      if (distSq < taunterDistSq) {
        taunterDistSq = distSq
        taunter = other
      }
    }
    const engage = engageRadius + world.radius[other]!
    if (distSq <= engage * engage && distSq < bestDistSq) {
      bestDistSq = distSq
      best = other
    }
  }

  if (taunter >= 0 && taunterDistSq <= TAUNT_RADIUS * TAUNT_RADIUS) return taunter
  return best
}

/**
 * Refreshes every entity's target for this tick.
 *
 * Search origin differs by role, and that difference is what stops units
 * blobbing: melee search around their assigned station, not their own position,
 * so a unit cannot be dragged off its post by a chain of foes each slightly
 * further out than the last.
 */
export function targetingSystem(
  world: World,
  spatial: SpatialHash,
  scratch: Int16Array,
  /**
   * Acquisition radius for a player unit, measured from its station.
   *
   * This must be the true engagement envelope, not the leash: a ranged unit
   * never walks to close distance, so its envelope is its weapon range: a
   * melee unit can walk `leash` before striking, so its envelope is range plus
   * leash. Using leash alone for ranged units was the bug — Archers and Mages
   * could only see targets within their (deliberately tiny) leash, even though
   * their weapon range reached far past it, so anything that stopped just
   * outside leash but inside range sat unengaged indefinitely.
   */
  unitEngageRadius: (id: number) => number,
  enemyAggro: number,
): void {
  for (let id = 0; id < world.capacity; id++) {
    if (!world.alive[id]) continue

    const category = world.category[id]!
    // Fliers never stop to fight; they exist to punish a purely outward defence.
    if ((world.flags[id]! & EntityFlag.Flying) !== 0) {
      world.targetId[id] = -1
      continue
    }

    const isEnemy = world.team[id] === Team.Shadow
    const searchX = isEnemy || category === Category.Construct ? world.posX[id]! : world.stationX[id]!
    const searchZ = isEnemy || category === Category.Construct ? world.posZ[id]! : world.stationZ[id]!

    let reach: number
    if (isEnemy) reach = enemyAggro
    else if (category === Category.Construct) reach = world.range[id]!
    else reach = unitEngageRadius(id)

    const current = world.targetId[id]!
    if (current >= 0 && stillValid(world, id, current, reach + 0.5)) continue

    // Enemies sweep out to taunt range so a Knight can pull them, but only
    // commit to ordinary targets already inside their own engagement radius.
    const search = isEnemy ? Math.max(reach, TAUNT_RADIUS) : reach
    const avoidId = isEnemy && world.avoidTimer[id]! > 0 ? world.avoidId[id]! : -1
    const next = acquire(world, spatial, id, searchX, searchZ, search, scratch, isEnemy, reach, avoidId)
    // A fresh target starts its engagement clock over — see enemyStep's
    // Construct-engagement timeout, which reads this for enemies only.
    if (next !== current) world.engageTimer[id] = 0
    world.targetId[id] = next
  }
}
