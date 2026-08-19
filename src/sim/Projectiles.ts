import type { DamageType } from './World'
import type { World } from './World'

export const MAX_PROJECTILES = 320

/** Visual family of a projectile. Drives which instanced mesh renders it. */
export const enum ProjectileKind {
  Arrow,
  Mote,
  Bolt,
}

export const PROJECTILE_KINDS: readonly ProjectileKind[] = [
  ProjectileKind.Arrow,
  ProjectileKind.Mote,
  ProjectileKind.Bolt,
]
/** Distance at which a projectile counts as having arrived. */
const HIT_EPSILON = 0.16

/**
 * Arrows, bolts and arcane motes.
 *
 * Kept out of `World` as its own pool: projectiles have no health, no
 * targeting and no separation, so putting them through the actor systems would
 * mean skipping them in every sweep. They home on their target's live position
 * and fizzle harmlessly at the last known point if it dies mid-flight, which
 * reads better than a bolt blinking out of existence.
 */
export class Projectiles {
  readonly x = new Float32Array(MAX_PROJECTILES)
  readonly z = new Float32Array(MAX_PROJECTILES)
  readonly prevX = new Float32Array(MAX_PROJECTILES)
  readonly prevZ = new Float32Array(MAX_PROJECTILES)
  readonly targetId = new Int16Array(MAX_PROJECTILES)
  readonly damage = new Float32Array(MAX_PROJECTILES)
  readonly splash = new Float32Array(MAX_PROJECTILES)
  readonly speed = new Float32Array(MAX_PROJECTILES)
  readonly damageType = new Uint8Array(MAX_PROJECTILES)
  readonly kind = new Uint8Array(MAX_PROJECTILES)
  readonly alive = new Uint8Array(MAX_PROJECTILES)
  readonly yaw = new Float32Array(MAX_PROJECTILES)

  private highWater = 0
  private readonly free: number[] = []
  private liveCount = 0

  get capacity(): number {
    return this.highWater
  }

  get count(): number {
    return this.liveCount
  }

  clear(): void {
    this.alive.fill(0)
    this.free.length = 0
    this.highWater = 0
    this.liveCount = 0
  }

  spawn(
    x: number,
    z: number,
    targetId: number,
    damage: number,
    damageType: DamageType,
    splash: number,
    speed: number,
    kind: number,
  ): void {
    let id = this.free.pop()
    if (id === undefined) {
      if (this.highWater >= MAX_PROJECTILES) return
      id = this.highWater++
    }
    this.alive[id] = 1
    this.liveCount++
    this.x[id] = x
    this.z[id] = z
    this.prevX[id] = x
    this.prevZ[id] = z
    this.targetId[id] = targetId
    this.damage[id] = damage
    this.damageType[id] = damageType
    this.splash[id] = splash
    this.speed[id] = speed
    this.kind[id] = kind
  }

  private kill(id: number): void {
    if (!this.alive[id]) return
    this.alive[id] = 0
    this.liveCount--
    this.free.push(id)
  }

  /** `onHit` receives the target id (which may be dead) and the projectile id. */
  update(dt: number, world: World, onHit: (projectile: number, target: number) => void): void {
    for (let id = 0; id < this.highWater; id++) {
      if (!this.alive[id]) continue

      const target = this.targetId[id]!
      this.prevX[id] = this.x[id]!
      this.prevZ[id] = this.z[id]!

      // Chase the live target; if it died, fly on to where it last stood.
      const aimX = world.isAlive(target) ? world.posX[target]! : world.posX[target] ?? this.x[id]!
      const aimZ = world.isAlive(target) ? world.posZ[target]! : world.posZ[target] ?? this.z[id]!

      let dx = aimX - this.x[id]!
      let dz = aimZ - this.z[id]!
      const distance = Math.hypot(dx, dz)

      if (distance <= HIT_EPSILON) {
        if (world.isAlive(target)) onHit(id, target)
        this.kill(id)
        continue
      }

      dx /= distance
      dz /= distance
      this.yaw[id] = Math.atan2(dx, dz)

      const step = this.speed[id]! * dt
      if (step >= distance) {
        if (world.isAlive(target)) onHit(id, target)
        this.kill(id)
        continue
      }
      this.x[id] = this.x[id]! + dx * step
      this.z[id] = this.z[id]! + dz * step
    }
  }
}
