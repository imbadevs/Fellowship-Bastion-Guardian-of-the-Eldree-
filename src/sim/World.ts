/**
 * Entity storage as a struct of arrays.
 *
 * Parallel typed arrays rather than objects: systems sweep one or two fields
 * across every entity each tick, and this keeps those sweeps cache-friendly and
 * allocation-free. Ids are indices, recycled through a free list.
 *
 * `prevX`/`prevZ` hold the previous tick's position so the renderer can
 * interpolate between sim steps — the sim runs at 30 Hz, the display does not.
 */

export const MAX_ENTITIES = 512

export const enum Team {
  Player,
  Shadow,
}

/** What an entity is. `archetype` is read against a different table per category. */
export const enum Category {
  Enemy,
  Unit,
  Construct,
}

export const enum DamageType {
  Physical,
  Magic,
}

/** Bit flags on `flags`. */
export const enum EntityFlag {
  /** Forces nearby enemies to retarget onto this entity. Knights only. */
  Taunt = 1,
  /** Ignores routing and every ground obstacle. Wraiths only. */
  Flying = 2,
}

/** Largest roster a single spawner can sustain; `slotMask` is one byte. */
export const MAX_ROSTER = 8

export class World {
  readonly posX = new Float32Array(MAX_ENTITIES)
  readonly posZ = new Float32Array(MAX_ENTITIES)
  readonly prevX = new Float32Array(MAX_ENTITIES)
  readonly prevZ = new Float32Array(MAX_ENTITIES)
  readonly velX = new Float32Array(MAX_ENTITIES)
  readonly velZ = new Float32Array(MAX_ENTITIES)
  readonly hp = new Float32Array(MAX_ENTITIES)
  readonly maxHp = new Float32Array(MAX_ENTITIES)
  readonly radius = new Float32Array(MAX_ENTITIES)
  readonly speed = new Float32Array(MAX_ENTITIES)
  readonly cooldown = new Float32Array(MAX_ENTITIES)
  /** Index into the archetype table for this entity's team. */
  readonly archetype = new Uint8Array(MAX_ENTITIES)
  readonly team = new Uint8Array(MAX_ENTITIES)
  readonly alive = new Uint8Array(MAX_ENTITIES)
  /** Facing, radians. Rendered directly; not part of movement integration. */
  readonly yaw = new Float32Array(MAX_ENTITIES)
  readonly category = new Uint8Array(MAX_ENTITIES)
  readonly flags = new Uint8Array(MAX_ENTITIES)

  // Combat stats, resolved once at spawn.
  //
  // Baking them here rather than reading a def table each tick is what gives
  // M6's Blessings a single choke point: effective stats are computed when an
  // entity is created, so a modifier only has to change that one calculation.
  readonly damage = new Float32Array(MAX_ENTITIES)
  readonly range = new Float32Array(MAX_ENTITIES)
  readonly attackInterval = new Float32Array(MAX_ENTITIES)
  readonly armor = new Float32Array(MAX_ENTITIES)
  readonly resist = new Float32Array(MAX_ENTITIES)
  readonly splash = new Float32Array(MAX_ENTITIES)
  readonly damageType = new Uint8Array(MAX_ENTITIES)

  // Where a unit belongs and what it is fighting.
  readonly stationX = new Float32Array(MAX_ENTITIES)
  readonly stationZ = new Float32Array(MAX_ENTITIES)
  readonly targetId = new Int16Array(MAX_ENTITIES)
  /** Seconds the current target has been held against a Construct, enemies only. */
  readonly engageTimer = new Float32Array(MAX_ENTITIES)
  /** Construct id an enemy just gave up on, so it doesn't instantly re-lock onto it. */
  readonly avoidId = new Int16Array(MAX_ENTITIES)
  readonly avoidTimer = new Float32Array(MAX_ENTITIES)
  /** Construct that produced this unit, or -1. */
  readonly ownerId = new Int16Array(MAX_ENTITIES)
  /** Which formation slot of its owner this unit holds. */
  readonly slot = new Uint8Array(MAX_ENTITIES)

  // Spawner bookkeeping, indexed by the construct's own entity id.
  /** Bitmask of formation slots currently filled. */
  readonly slotMask = new Uint8Array(MAX_ENTITIES)
  readonly rosterCap = new Uint8Array(MAX_ENTITIES)
  readonly spawnTimer = new Float32Array(MAX_ENTITIES)

  /** One past the highest index ever used, so sweeps can stop early. */
  private highWater = 0
  private readonly free: number[] = []
  private liveCount = 0

  get capacity(): number {
    return this.highWater
  }

  get count(): number {
    return this.liveCount
  }

  /** Returns a new entity id, or -1 if the world is full. */
  spawn(): number {
    let id = this.free.pop()
    if (id === undefined) {
      if (this.highWater >= MAX_ENTITIES) return -1
      id = this.highWater++
    }
    this.alive[id] = 1
    this.liveCount++
    this.velX[id] = 0
    this.velZ[id] = 0
    this.cooldown[id] = 0
    this.targetId[id] = -1
    this.ownerId[id] = -1
    this.flags[id] = 0
    this.slotMask[id] = 0
    this.spawnTimer[id] = 0
    this.engageTimer[id] = 0
    this.avoidId[id] = -1
    this.avoidTimer[id] = 0
    return id
  }

  /** Lowest free formation slot on `owner`, or -1 when the roster is full. */
  claimSlot(owner: number): number {
    const cap = Math.min(this.rosterCap[owner]!, MAX_ROSTER)
    const mask = this.slotMask[owner]!
    for (let slot = 0; slot < cap; slot++) {
      if ((mask & (1 << slot)) === 0) {
        this.slotMask[owner] = mask | (1 << slot)
        return slot
      }
    }
    return -1
  }

  releaseSlot(owner: number, slot: number): void {
    this.slotMask[owner] = this.slotMask[owner]! & ~(1 << slot)
  }

  isAlive(id: number): boolean {
    return id >= 0 && this.alive[id] === 1
  }

  kill(id: number): void {
    if (!this.alive[id]) return
    this.alive[id] = 0
    this.liveCount--
    this.free.push(id)
  }

  /** Drops every entity and resets the id pool. */
  clear(): void {
    this.alive.fill(0)
    this.free.length = 0
    this.highWater = 0
    this.liveCount = 0
  }

  /** Copies current positions into the interpolation source. Call before integrating. */
  snapshot(): void {
    this.prevX.set(this.posX.subarray(0, this.highWater))
    this.prevZ.set(this.posZ.subarray(0, this.highWater))
  }
}
