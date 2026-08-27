import { Rng } from '../core/Rng'
import type { BuildingDef } from '../data/buildings'
import { UnitClass } from '../data/buildings'
import { ENEMIES, type EnemyKind } from '../data/enemies'
import { TIER_SCALING, UNITS, type UnitDef } from '../data/units'
import { waveDef, waveTotal, type SpawnGroup } from '../data/waves'
import type { Cell, HexGrid } from '../hex/HexGrid'
import { FlowField } from './FlowField'
import { Projectiles, ProjectileKind } from './Projectiles'
import { SpatialHash } from './SpatialHash'
import { applyDamage, applySplash } from './systems/Combat'
import { unitMovementSystem } from './systems/Movement'
import { targetingSystem } from './systems/Targeting'
import { Category, DamageType, EntityFlag, MAX_ENTITIES, Team, World } from './World'

/** How far outside the board's edge the horde forms up. */
const SPAWN_MARGIN = 2.2
/** Distance from the board centre at which an enemy can strike the Eldree. */
const ELDREE_REACH = 0.85
/** Speed multiplier while forcing a path across a tile with a Construct on it. */
const BUILDING_SLOW = 0.45
/** How hard overlapping bodies push apart, per tick. */
const SEPARATION_STRENGTH = 0.5
/** How far an enemy will look for something of the Fellowship's to fight. */
const ENEMY_AGGRO = 1.35
/** Collision body of a Construct. Under the tile radius so units can form up around it. */
const CONSTRUCT_RADIUS = 0.45
/** Projectile flight speed, world units per second. */
const PROJECTILE_SPEED = 9

export const enum SimPhase {
  Idle,
  Running,
  Cleared,
  Defeat,
}

export interface SimEvents {
  onEldreeDamaged: ((hp: number, max: number) => void) | null
  onEnemyKilled: ((gold: number, x: number, z: number) => void) | null
  onConstructDestroyed: ((simId: number) => void) | null
  onWaveCleared: ((wave: number) => void) | null
  onDefeat: (() => void) | null
}

interface PendingGroup {
  readonly group: SpawnGroup
  spawned: number
  nextAt: number
}

/**
 * The headless simulation.
 *
 * Imports nothing from `three` — this whole file runs in Node, which is what
 * lets combat be unit-tested and lets a balance harness replay thousands of
 * seeded runs without a renderer.
 *
 * Fixed-step: `update` is only ever called with the loop's constant dt, so the
 * speed multiplier adds ticks rather than scaling time and cannot change outcomes.
 */
export class Sim {
  readonly world = new World()
  readonly spatial: SpatialHash
  readonly flow: FlowField
  readonly projectiles = new Projectiles()

  readonly events: SimEvents = {
    onEldreeDamaged: null,
    onEnemyKilled: null,
    onConstructDestroyed: null,
    onWaveCleared: null,
    onDefeat: null,
  }

  phase: SimPhase = SimPhase.Idle
  wave = 0
  eldreeHp = 100
  eldreeMaxHp = 100

  private rng: Rng
  private pending: PendingGroup[] = []
  private elapsed = 0
  private lanes = 1
  private laneCursor = 0
  private spawnedTotal = 0
  private waveTotalCount = 0
  private killedTotal = 0
  private readonly seed: number
  private readonly scratch = new Int16Array(96)
  /** Construct definitions, indexed by the construct's entity id. */
  private readonly constructDefs: Array<BuildingDef | null> = new Array(MAX_ENTITIES).fill(null)

  constructor(
    private readonly grid: HexGrid,
    seed = 1,
  ) {
    this.seed = seed
    this.rng = new Rng(seed)
    this.flow = new FlowField(grid)
    this.spatial = new SpatialHash(grid.radius * 2 + SPAWN_MARGIN * 2 + 4)
  }

  rebuildRouting(): void {
    this.flow.rebuild()
  }

  get spawnsRemaining(): number {
    return this.waveTotalCount - this.spawnedTotal
  }

  get waveProgress(): { killed: number; total: number } {
    return { killed: this.killedTotal, total: this.waveTotalCount }
  }

  /** Live count of Shadow entities; units and Constructs are excluded. */
  get enemyCount(): number {
    const w = this.world
    let n = 0
    for (let id = 0; id < w.capacity; id++) {
      if (w.alive[id] && w.team[id] === Team.Shadow) n++
    }
    return n
  }

  // --- constructs -----------------------------------------------------------

  /** Registers a placed Construct as a combat entity. Returns its sim id. */
  addConstruct(def: BuildingDef, cell: Cell): number {
    const w = this.world
    const id = w.spawn()
    if (id < 0) return -1

    w.posX[id] = cell.worldX
    w.posZ[id] = cell.worldZ
    w.prevX[id] = cell.worldX
    w.prevZ[id] = cell.worldZ
    w.hp[id] = def.hp
    w.maxHp[id] = def.hp
    w.radius[id] = CONSTRUCT_RADIUS
    w.speed[id] = 0
    w.category[id] = Category.Construct
    w.team[id] = Team.Player
    w.armor[id] = 12
    w.resist[id] = 0
    w.yaw[id] = Math.atan2(cell.worldX, cell.worldZ)

    const weapon = def.weapon
    w.damage[id] = weapon?.damage ?? 0
    w.range[id] = weapon ? weapon.range * this.grid.layout.tileWidth : 0
    w.attackInterval[id] = weapon?.cooldown ?? 0
    w.splash[id] = weapon?.splash ?? 0
    w.damageType[id] = def.id === 'rune-ward' ? DamageType.Magic : DamageType.Physical

    w.rosterCap[id] = def.spawn?.roster ?? 0
    // The first unit waits a full interval too, same as every one after it —
    // a freshly raised Construct is not yet garrisoned.
    w.spawnTimer[id] = def.spawn?.interval ?? 0

    this.constructDefs[id] = def
    return id
  }

  removeConstruct(simId: number): void {
    if (!this.world.isAlive(simId)) return
    // A Construct's garrison belongs to it; losing the building loses the squad.
    this.releaseGarrison(simId)
    this.constructDefs[simId] = null
    this.world.kill(simId)
  }

  /**
   * Tears down one or two Constructs and raises their upgrade on `cell`,
   * carrying over as much of the combined garrison as the new roster holds
   * instead of releasing every unit and mustering the upgrade from zero —
   * unlike `removeConstruct`, a merge is not really losing the building, it's
   * becoming a bigger one. Surviving units beyond the new roster cap (e.g.
   * two full Barracks, 6 Warriors, merging into a War Lodge that only holds
   * 5) have no slot to hold and are released.
   */
  mergeConstructs(sourceSimIds: readonly number[], upgradeDef: BuildingDef, cell: Cell): number {
    const w = this.world
    const survivors: number[] = []
    for (let id = 0; id < w.capacity; id++) {
      if (w.alive[id] && w.category[id] === Category.Unit && sourceSimIds.includes(w.ownerId[id]!)) {
        survivors.push(id)
      }
    }

    for (const simId of sourceSimIds) {
      if (!w.isAlive(simId)) continue
      this.constructDefs[simId] = null
      w.kill(simId)
    }

    const newId = this.addConstruct(upgradeDef, cell)
    if (newId < 0) {
      // No room for the upgrade at all — the units it would have inherited
      // have nothing left to belong to either.
      for (const unitId of survivors) w.kill(unitId)
      return newId
    }

    for (const unitId of survivors) {
      const slot = w.claimSlot(newId)
      if (slot < 0) {
        w.kill(unitId)
        continue
      }
      w.ownerId[unitId] = newId
      w.slot[unitId] = slot
      this.writeStation(unitId, newId, slot)
    }
    return newId
  }

  moveConstruct(simId: number, cell: Cell): void {
    const w = this.world
    if (!w.isAlive(simId)) return
    w.posX[simId] = cell.worldX
    w.posZ[simId] = cell.worldZ
    w.prevX[simId] = cell.worldX
    w.prevZ[simId] = cell.worldZ
    w.yaw[simId] = Math.atan2(cell.worldX, cell.worldZ)
    this.restationGarrison(simId)
  }

  private releaseGarrison(owner: number): void {
    const w = this.world
    for (let id = 0; id < w.capacity; id++) {
      if (w.alive[id] && w.category[id] === Category.Unit && w.ownerId[id] === owner) {
        w.kill(id)
      }
    }
    w.slotMask[owner] = 0
  }

  private restationGarrison(owner: number): void {
    const w = this.world
    for (let id = 0; id < w.capacity; id++) {
      if (w.alive[id] && w.category[id] === Category.Unit && w.ownerId[id] === owner) {
        this.writeStation(id, owner, w.slot[id]!)
      }
    }
  }

  /**
   * Wipes every Construct's garrison at once, on wave clear — a fresh wave
   * means every spawner musters from zero again rather than fighting it with
   * whoever happened to survive the last one. Constructs themselves are
   * untouched; only their units and roster occupancy reset.
   */
  private releaseAllGarrisons(): void {
    const w = this.world
    for (let id = 0; id < w.capacity; id++) {
      if (w.alive[id] && w.category[id] === Category.Unit) w.kill(id)
    }
    for (let id = 0; id < w.capacity; id++) {
      if (w.alive[id] && w.category[id] === Category.Construct) w.slotMask[id] = 0
    }
  }

  // --- lifecycle ------------------------------------------------------------

  startWave(wave: number): void {
    const def = waveDef(wave)
    this.wave = wave
    this.lanes = def.lanes
    this.laneCursor = 0
    this.elapsed = 0
    this.spawnedTotal = 0
    this.killedTotal = 0
    this.waveTotalCount = waveTotal(def)
    this.pending = def.groups.map((group) => ({ group, spawned: 0, nextAt: group.delay }))
    // Re-seed per wave so a wave plays the same whatever happened before it.
    this.rng = new Rng(this.seed * 7919 + wave)
    this.phase = SimPhase.Running
  }

  /** Clears everything, including Constructs. Callers must re-register them. */
  reset(hp = 100): void {
    this.world.clear()
    this.projectiles.clear()
    this.constructDefs.fill(null)
    this.pending = []
    this.phase = SimPhase.Idle
    this.wave = 0
    this.elapsed = 0
    this.spawnedTotal = 0
    this.killedTotal = 0
    this.waveTotalCount = 0
    this.eldreeMaxHp = hp
    this.eldreeHp = hp
    this.rng = new Rng(this.seed)
  }

  /** Dev shortcut: wipes every living enemy. */
  smiteAll(): void {
    const w = this.world
    for (let id = 0; id < w.capacity; id++) {
      if (w.alive[id] && w.team[id] === Team.Shadow) this.killEnemy(id)
    }
  }

  update(dt: number): void {
    this.world.snapshot()
    this.spawnerStep(dt)
    this.rebuildSpatial()

    if (this.phase === SimPhase.Running) this.waveSpawnStep()

    targetingSystem(this.world, this.spatial, this.scratch, (id) => this.unitEngageRadius(id), ENEMY_AGGRO)
    unitMovementSystem(this.world, dt, (id) => this.unitDef(id))
    this.enemyStep(dt)
    this.separateStep()
    this.attackStep(dt)
    this.projectiles.update(dt, this.world, (p, target) => this.resolveHit(p, target))
    this.deathStep()

    if (this.phase === SimPhase.Running) {
      this.elapsed += dt
      this.checkWaveEnd()
    }
  }

  private unitDef(id: number): UnitDef {
    return UNITS[this.world.archetype[id] as UnitClass]
  }

  /** See the doc comment on `targetingSystem`'s `unitEngageRadius` parameter. */
  private unitEngageRadius(id: number): number {
    const def = this.unitDef(id)
    return def.ranged ? def.range : def.range + def.leash
  }

  // --- spawning -------------------------------------------------------------

  private waveSpawnStep(): void {
    for (const entry of this.pending) {
      while (entry.spawned < entry.group.count && this.elapsed >= entry.nextAt) {
        this.spawnEnemy(entry.group.kind)
        entry.spawned++
        entry.nextAt += entry.group.spacing
      }
    }
  }

  private spawnEnemy(kind: EnemyKind): void {
    const def = ENEMIES[kind]
    const id = this.world.spawn()
    if (id < 0) return

    // Lanes are visited round-robin so a wave arrives evenly on every front,
    // spread across the full circle, then jittered so the horde does not
    // form a single-file column. The Eldree sits at the board's centre with
    // no inherent "front" — the horde attacking from all sides is the point.
    const lane = this.laneCursor++ % this.lanes
    const angle = (lane / this.lanes) * Math.PI * 2 + this.rng.range(-0.28, 0.28)
    const distance = this.grid.visibleWorldRadius + SPAWN_MARGIN + this.rng.range(0, 1.4)

    const w = this.world
    w.posX[id] = Math.sin(angle) * distance
    w.posZ[id] = Math.cos(angle) * distance
    w.prevX[id] = w.posX[id]!
    w.prevZ[id] = w.posZ[id]!
    w.hp[id] = def.hp
    w.maxHp[id] = def.hp
    w.speed[id] = def.speed
    w.radius[id] = def.radius
    w.archetype[id] = kind
    w.category[id] = Category.Enemy
    w.team[id] = Team.Shadow
    w.armor[id] = def.armor
    w.resist[id] = def.resist
    w.damage[id] = def.damage
    w.range[id] = 0.55
    w.attackInterval[id] = def.attackInterval
    w.damageType[id] = DamageType.Physical
    w.splash[id] = 0
    w.flags[id] = def.flying ? EntityFlag.Flying : 0
    w.yaw[id] = angle + Math.PI

    this.spawnedTotal++
  }

  /** Constructs top their garrison back up to roster over time. */
  private spawnerStep(dt: number): void {
    const w = this.world
    for (let id = 0; id < w.capacity; id++) {
      if (!w.alive[id] || w.category[id] !== Category.Construct) continue
      const def = this.constructDefs[id]
      if (!def?.spawn) continue

      w.spawnTimer[id] = w.spawnTimer[id]! - dt
      if (w.spawnTimer[id]! > 0) continue

      const slot = w.claimSlot(id)
      if (slot < 0) continue
      this.spawnUnit(id, def, slot)
      w.spawnTimer[id] = def.spawn.interval
    }
  }

  private spawnUnit(owner: number, def: BuildingDef, slot: number): void {
    const spawn = def.spawn!
    const unit = UNITS[spawn.unitClass]
    const scale = TIER_SCALING[def.tier] ?? 1

    const id = this.world.spawn()
    if (id < 0) {
      this.world.releaseSlot(owner, slot)
      return
    }

    const w = this.world
    w.archetype[id] = spawn.unitClass
    w.category[id] = Category.Unit
    w.team[id] = Team.Player
    w.ownerId[id] = owner
    w.slot[id] = slot
    // Effective stats are resolved once, here. M6's Blessings hook this call.
    w.hp[id] = unit.hp * scale
    w.maxHp[id] = w.hp[id]!
    w.damage[id] = unit.damage * scale
    w.range[id] = unit.range
    w.attackInterval[id] = unit.attackInterval
    w.armor[id] = unit.armor
    w.resist[id] = unit.resist
    w.damageType[id] = unit.damageType
    w.splash[id] = unit.splash
    w.radius[id] = unit.radius
    w.speed[id] = unit.speed
    w.flags[id] = unit.taunt ? EntityFlag.Taunt : 0

    this.writeStation(id, owner, slot)
    // Units muster at their post rather than walking out of the building.
    w.posX[id] = w.stationX[id]!
    w.posZ[id] = w.stationZ[id]!
    w.prevX[id] = w.posX[id]!
    w.prevZ[id] = w.posZ[id]!
  }

  /**
   * Places a unit's post in its Construct's formation.
   *
   * The line faces outward from the Eldree, because that is where the horde
   * comes from, and slots fan out sideways so a garrison forms a rank instead
   * of a stack.
   */
  private writeStation(id: number, owner: number, slot: number): void {
    const w = this.world
    const def = this.unitDef(id)
    const cap = Math.max(1, w.rosterCap[owner]!)

    const ox = w.posX[owner]!
    const oz = w.posZ[owner]!
    const length = Math.hypot(ox, oz)
    // A Construct on the centre tile has no outward direction; face +Z.
    const outX = length > 1e-4 ? ox / length : 0
    const outZ = length > 1e-4 ? oz / length : 1

    const lateral = (slot - (cap - 1) / 2) * def.stationSpread
    w.stationX[id] = ox + outX * def.stationForward - outZ * lateral
    w.stationZ[id] = oz + outZ * def.stationForward + outX * lateral
  }

  // --- movement -------------------------------------------------------------

  private rebuildSpatial(): void {
    const { world, spatial } = this
    spatial.clear()
    for (let id = 0; id < world.capacity; id++) {
      if (!world.alive[id]) continue
      spatial.insert(id, world.posX[id]!, world.posZ[id]!)
    }
  }

  private enemyStep(dt: number): void {
    const w = this.world

    for (let id = 0; id < w.capacity; id++) {
      if (!w.alive[id] || w.team[id] !== Team.Shadow) continue

      const def = ENEMIES[w.archetype[id] as EnemyKind]
      const x = w.posX[id]!
      const z = w.posZ[id]!

      // Something of the Fellowship's is in reach: stop and fight it.
      const target = w.targetId[id]!
      if (w.isAlive(target)) {
        const dx = w.posX[target]! - x
        const dz = w.posZ[target]! - z
        const distance = Math.hypot(dx, dz)
        const strike = w.range[id]! + w.radius[target]!
        w.yaw[id] = Math.atan2(dx, dz)
        if (distance > strike) {
          const step = Math.min(def.speed * dt, distance - strike)
          w.posX[id] = x + (dx / distance) * step
          w.posZ[id] = z + (dz / distance) * step
        }
        w.velX[id] = 0
        w.velZ[id] = 0
        continue
      }

      if (Math.hypot(x, z) <= ELDREE_REACH + w.radius[id]!) {
        this.strikeEldree(id, def.damage, def.attackInterval, dt)
        w.velX[id] = 0
        w.velZ[id] = 0
        continue
      }

      let targetX = 0
      let targetZ = 0
      let slow = 1

      if (!def.flying) {
        const cell = this.grid.fromWorld(x, z)
        if (cell && this.grid.isPlayable(cell)) {
          const next = this.flow.nextCell(cell)
          if (next) {
            targetX = next.worldX
            targetZ = next.worldZ
          }
          if (cell.occupantId >= 0) slow = BUILDING_SLOW
        }
      }

      let dx = targetX - x
      let dz = targetZ - z
      const length = Math.hypot(dx, dz)
      if (length > 1e-4) {
        dx /= length
        dz /= length
      }

      const speed = def.speed * slow
      w.velX[id] = dx * speed
      w.velZ[id] = dz * speed
      w.posX[id] = x + dx * speed * dt
      w.posZ[id] = z + dz * speed * dt
      if (length > 1e-4) w.yaw[id] = Math.atan2(dx, dz)
    }
  }

  /**
   * One relaxation pass pushing overlapping bodies apart.
   *
   * Position correction rather than steering force: stable at 30 Hz without
   * tuning, and it stops the horde collapsing to a point when it funnels at the
   * Eldree. Constructs shove but are never shoved, so units and enemies flow
   * around a building instead of standing inside it.
   */
  private separateStep(): void {
    const w = this.world
    for (let id = 0; id < w.capacity; id++) {
      if (!w.alive[id] || w.category[id] === Category.Construct) continue
      const x = w.posX[id]!
      const z = w.posZ[id]!
      const r = w.radius[id]!

      const found = this.spatial.query(x, z, r * 2 + 0.9, this.scratch)
      for (let i = 0; i < found; i++) {
        const other = this.scratch[i]!
        if (other === id || !w.alive[other]) continue
        const otherIsStatic = w.category[other] === Category.Construct
        if (!otherIsStatic && other < id) continue

        const dx = w.posX[other]! - w.posX[id]!
        const dz = w.posZ[other]! - w.posZ[id]!
        const minDistance = r + w.radius[other]!
        const distSq = dx * dx + dz * dz
        if (distSq >= minDistance * minDistance || distSq < 1e-6) continue

        const dist = Math.sqrt(distSq)
        const overlap = (minDistance - dist) / dist
        if (otherIsStatic) {
          w.posX[id] = w.posX[id]! - dx * overlap
          w.posZ[id] = w.posZ[id]! - dz * overlap
        } else {
          const push = overlap * SEPARATION_STRENGTH * 0.5
          w.posX[id] = w.posX[id]! - dx * push
          w.posZ[id] = w.posZ[id]! - dz * push
          w.posX[other] = w.posX[other]! + dx * push
          w.posZ[other] = w.posZ[other]! + dz * push
        }
      }
    }
  }

  // --- combat ---------------------------------------------------------------

  private attackStep(dt: number): void {
    const w = this.world

    for (let id = 0; id < w.capacity; id++) {
      if (!w.alive[id]) continue
      const interval = w.attackInterval[id]!
      if (interval <= 0) continue

      // Enemies striking the Eldree run their own timer inside enemyStep.
      const target = w.targetId[id]!
      if (!w.isAlive(target)) {
        if (w.cooldown[id]! > 0) w.cooldown[id] = w.cooldown[id]! - dt
        continue
      }

      const dx = w.posX[target]! - w.posX[id]!
      const dz = w.posZ[target]! - w.posZ[id]!
      const strike = w.range[id]! + w.radius[target]!
      if (dx * dx + dz * dz > strike * strike) continue

      w.cooldown[id] = w.cooldown[id]! - dt
      if (w.cooldown[id]! > 0) continue
      w.cooldown[id] = interval

      const isRangedUnit = w.category[id] === Category.Unit && this.unitDef(id).ranged
      const isTurret = w.category[id] === Category.Construct

      if (isRangedUnit || isTurret) {
        const kind =
          w.damageType[id] === DamageType.Magic
            ? ProjectileKind.Mote
            : isTurret
              ? ProjectileKind.Bolt
              : ProjectileKind.Arrow
        this.projectiles.spawn(
          w.posX[id]!,
          w.posZ[id]!,
          target,
          w.damage[id]!,
          w.damageType[id] as DamageType,
          w.splash[id]!,
          PROJECTILE_SPEED,
          kind,
        )
      } else {
        this.dealDamage(id, target, w.damage[id]!, w.damageType[id] as DamageType, w.splash[id]!)
      }
    }
  }

  private resolveHit(projectile: number, target: number): void {
    const p = this.projectiles
    const type = p.damageType[projectile] as DamageType
    applyDamage(this.world, target, p.damage[projectile]!, type)

    const splash = p.splash[projectile]!
    if (splash > 0) {
      applySplash(
        this.world,
        this.spatial,
        p.x[projectile]!,
        p.z[projectile]!,
        splash,
        p.damage[projectile]! * 0.6,
        type,
        this.world.team[target] === Team.Shadow ? Team.Player : Team.Shadow,
        target,
        this.scratch,
      )
    }
  }

  private dealDamage(
    source: number,
    target: number,
    amount: number,
    type: DamageType,
    splash: number,
  ): void {
    applyDamage(this.world, target, amount, type)
    if (splash > 0) {
      applySplash(
        this.world,
        this.spatial,
        this.world.posX[target]!,
        this.world.posZ[target]!,
        splash,
        amount * 0.6,
        type,
        this.world.team[source]!,
        target,
        this.scratch,
      )
    }
  }

  private strikeEldree(id: number, damage: number, interval: number, dt: number): void {
    const w = this.world
    w.cooldown[id] = w.cooldown[id]! - dt
    if (w.cooldown[id]! > 0) return
    w.cooldown[id] = interval

    this.eldreeHp = Math.max(0, this.eldreeHp - damage)
    this.events.onEldreeDamaged?.(this.eldreeHp, this.eldreeMaxHp)

    if (this.eldreeHp <= 0 && this.phase === SimPhase.Running) {
      this.phase = SimPhase.Defeat
      this.events.onDefeat?.()
    }
  }

  // --- resolution -----------------------------------------------------------

  private deathStep(): void {
    const w = this.world
    for (let id = 0; id < w.capacity; id++) {
      if (!w.alive[id] || w.hp[id]! > 0) continue

      if (w.team[id] === Team.Shadow) {
        this.killEnemy(id)
      } else if (w.category[id] === Category.Construct) {
        this.events.onConstructDestroyed?.(id)
        this.removeConstruct(id)
      } else {
        w.releaseSlot(w.ownerId[id]!, w.slot[id]!)
        w.kill(id)
      }
    }
  }

  private killEnemy(id: number): void {
    const w = this.world
    const def = ENEMIES[w.archetype[id] as EnemyKind]
    this.killedTotal++
    this.events.onEnemyKilled?.(def.gold, w.posX[id]!, w.posZ[id]!)
    w.kill(id)
  }

  private checkWaveEnd(): void {
    if (this.spawnsRemaining > 0 || this.enemyCount > 0) return
    this.phase = SimPhase.Cleared
    this.releaseAllGarrisons()
    this.events.onWaveCleared?.(this.wave)
  }
}
