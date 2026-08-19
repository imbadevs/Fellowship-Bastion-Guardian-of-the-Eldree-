import type { UnitDef } from '../../data/units'
import type { World } from '../World'

/** Close enough to a goal to stop; avoids jitter around the destination. */
const ARRIVE_EPSILON = 0.07

/**
 * Unit movement.
 *
 * This is the system that decides whether the game reads as tactical or as
 * mush, so the rules are deliberately restrictive:
 *
 * 1. Every unit owns a **station** — a slot in its Construct's formation. With
 *    nothing to fight it stands there, which is what makes a defensive line
 *    look like a line.
 * 2. A unit may chase, but never further than `leash` **from its station**, not
 *    from its current position. Without that anchor a chain of foes each
 *    slightly further out walks the whole garrison off the map — the blob
 *    failure the plan called out as M4's biggest risk.
 * 3. Ranged units do not close at all. They hold station and back away from
 *    anything inside `kite`, which keeps Archers behind the melee line instead
 *    of wandering into it.
 */
export function unitMovementSystem(
  world: World,
  dt: number,
  defOf: (id: number) => UnitDef,
): void {
  for (let id = 0; id < world.capacity; id++) {
    if (!world.alive[id] || world.category[id] !== 1 /* Category.Unit */) continue

    const def = defOf(id)
    const x = world.posX[id]!
    const z = world.posZ[id]!
    const stationX = world.stationX[id]!
    const stationZ = world.stationZ[id]!
    const target = world.targetId[id]!

    let goalX = stationX
    let goalZ = stationZ

    if (world.isAlive(target)) {
      const tx = world.posX[target]!
      const tz = world.posZ[target]!
      const toTarget = Math.hypot(tx - x, tz - z)
      const strikeRange = world.range[id]! + world.radius[target]!

      if (def.ranged) {
        // Hold the line, but give ground to anything that closes.
        if (toTarget < def.kite && toTarget > 1e-4) {
          goalX = x - ((tx - x) / toTarget) * def.kite
          goalZ = z - ((tz - z) / toTarget) * def.kite
        }
      } else if (toTarget > strikeRange * 0.85) {
        goalX = tx
        goalZ = tz
      } else {
        goalX = x
        goalZ = z
      }

      world.yaw[id] = Math.atan2(tx - x, tz - z)
    }

    // The leash is measured from the station, so a unit can be drawn forward
    // but always snaps back to a bounded area around its post.
    const leashDx = goalX - stationX
    const leashDz = goalZ - stationZ
    const leashDist = Math.hypot(leashDx, leashDz)
    if (leashDist > def.leash) {
      const k = def.leash / leashDist
      goalX = stationX + leashDx * k
      goalZ = stationZ + leashDz * k
    }

    let dx = goalX - x
    let dz = goalZ - z
    const distance = Math.hypot(dx, dz)
    if (distance <= ARRIVE_EPSILON) {
      world.velX[id] = 0
      world.velZ[id] = 0
      continue
    }

    dx /= distance
    dz /= distance
    const step = Math.min(def.speed * dt, distance)
    world.posX[id] = x + dx * step
    world.posZ[id] = z + dz * step
    world.velX[id] = dx * def.speed
    world.velZ[id] = dz * def.speed
    if (!world.isAlive(target)) world.yaw[id] = Math.atan2(dx, dz)
  }
}
