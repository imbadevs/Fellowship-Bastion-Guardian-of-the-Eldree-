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
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  [EnemyKind.Orc]: {
    kind: EnemyKind.Orc,
    name: 'Orc',
    hp: 40,
    speed: 1.15,
    armor: 0,
    resist: 0,
    damage: 6,
    attackInterval: 1.1,
    radius: 0.3,
    gold: 4,
    flying: false,
  },
  [EnemyKind.Troll]: {
    kind: EnemyKind.Troll,
    name: 'Troll',
    hp: 190,
    speed: 0.62,
    armor: 45,
    resist: 0,
    damage: 22,
    attackInterval: 1.9,
    radius: 0.42,
    gold: 14,
    flying: false,
  },
  [EnemyKind.Wraith]: {
    kind: EnemyKind.Wraith,
    name: 'Wraith',
    hp: 70,
    speed: 0.95,
    armor: 0,
    resist: 0.6,
    damage: 11,
    attackInterval: 1.4,
    radius: 0.32,
    gold: 10,
    flying: true,
  },
}

export const ENEMY_KINDS: readonly EnemyKind[] = [EnemyKind.Orc, EnemyKind.Troll, EnemyKind.Wraith]
