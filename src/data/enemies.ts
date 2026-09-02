/**
 * The Shadow Army.
 *
 * Each type answers a different defensive question, so a board that beats one
 * loses to another — that tension is what makes the M5 shop draft a decision
 * rather than a shopping list.
 */

export const enum EnemyKind {
  Orc,
  Troll,
  Wraith,
}

export interface EnemyDef {
  readonly kind: EnemyKind
  readonly name: string
  readonly hp: number
  /** World units per second. One hex is ~1.73 units across the flats. */
  readonly speed: number
  /** Flat physical reduction, applied as 100 / (100 + armor). */
  readonly armor: number
  /** Magic reduction, 0..0.75. */
  readonly resist: number
  readonly damage: number
  /** Seconds between attacks. */
  readonly attackInterval: number
  readonly radius: number
  readonly gold: number
  /**
   * Ignores the routing field and drifts straight at the Eldree.
   * Wraiths are the reason a perimeter alone is not a defence.
   */
  readonly flying: boolean
  /**
   * Damage multiplier against Constructs, on top of the usual mitigation.
   *
   * Flesh and timber are not the same target. Without this a Construct is
   * effectively indestructible: an Orc's 6 damage, after a Construct's
   * armour and the engagement limit that stops it grinding forever, removes
   * about 4% of a War Lodge before it gives up and reroutes. Splitting siege
   * from raw damage also keeps the enemy roster distinct — a Troll is the
   * thing that breaks your line, an Orc is the thing that gets past it.
   */
  readonly siege: number
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  [EnemyKind.Orc]: {
    kind: EnemyKind.Orc,
    name: 'Orc',
    hp: 40,
    speed: 1.15,
    armor: 0,
    resist: 0,
    damage: 8,
    attackInterval: 0.75,
    radius: 0.3,
    gold: 4,
    flying: false,
    siege: 2.5,
  },
  [EnemyKind.Troll]: {
    kind: EnemyKind.Troll,
    name: 'Troll',
    hp: 190,
    speed: 0.62,
    armor: 110,
    resist: 0,
    damage: 30,
    attackInterval: 1.3,
    radius: 0.42,
    gold: 14,
    flying: false,
    siege: 4.5,
  },
  [EnemyKind.Wraith]: {
    kind: EnemyKind.Wraith,
    name: 'Wraith',
    hp: 70,
    speed: 0.95,
    armor: 0,
    resist: 0.72,
    damage: 15,
    attackInterval: 0.95,
    radius: 0.32,
    gold: 10,
    flying: true,
    siege: 1.5,
  },
}

export const ENEMY_KINDS: readonly EnemyKind[] = [EnemyKind.Orc, EnemyKind.Troll, EnemyKind.Wraith]
