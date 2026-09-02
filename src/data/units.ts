import { UnitClass } from './buildings'
import { DamageType } from '../sim/World'

/**
 * The Fellowship's combat units.
 *
 * Units are never controlled directly. The player's agency is in which
 * Constructs they raise and where, so each class has to express its role
 * through behaviour alone — which is why stationing, leash and taunt are
 * per-class data rather than shared constants.
 */
export interface UnitDef {
  readonly cls: UnitClass
  readonly name: string
  readonly hp: number
  readonly speed: number
  readonly damage: number
  /** Attack reach in world units. One hex is ~1.73 across the flats. */
  readonly range: number
  readonly attackInterval: number
  readonly armor: number
  readonly resist: number
  readonly damageType: DamageType
  /** Splash radius on hit, 0 for single target. */
  readonly splash: number
  readonly radius: number
  /**
   * How far outward from its Construct the unit forms up, in world units.
   * Melee holds a line ahead of the building; ranged stays tucked behind it.
   */
  readonly stationForward: number
  /** Lateral gap between formation slots. */
  readonly stationSpread: number
  /** How far from station a unit will chase before returning. */
  readonly leash: number
  /** Fires a projectile rather than striking instantly. */
  readonly ranged: boolean
  /** Pulls nearby enemies onto itself. */
  readonly taunt: boolean
  /** Backs away when something closes inside this distance. 0 disables. */
  readonly kite: number
}

export const UNITS: Record<UnitClass, UnitDef> = {
  [UnitClass.Warrior]: {
    cls: UnitClass.Warrior,
    name: 'Warrior',
    hp: 95,
    speed: 1.5,
    damage: 13,
    range: 0.62,
    attackInterval: 0.85,
    armor: 8,
    resist: 0,
    damageType: DamageType.Physical,
    splash: 0,
    radius: 0.28,
    stationForward: 1.05,
    stationSpread: 0.62,
    leash: 2.4,
    ranged: false,
    taunt: false,
    kite: 0,
  },
  [UnitClass.Knight]: {
    cls: UnitClass.Knight,
    name: 'Knight',
    hp: 320,
    speed: 1.25,
    damage: 16,
    range: 0.7,
    attackInterval: 1.15,
    armor: 38,
    resist: 0.15,
    damageType: DamageType.Physical,
    splash: 0,
    radius: 0.36,
    stationForward: 1.35,
    stationSpread: 0.8,
    leash: 1.8,
    ranged: false,
    taunt: true,
    kite: 0,
  },
  [UnitClass.Archer]: {
    cls: UnitClass.Archer,
    name: 'Archer',
    hp: 62,
    speed: 1.4,
    damage: 17,
    range: 3.4,
    attackInterval: 0.95,
    armor: 0,
    resist: 0,
    damageType: DamageType.Physical,
    splash: 0,
    radius: 0.25,
    stationForward: -0.8,
    stationSpread: 0.55,
    leash: 0.9,
    ranged: true,
    taunt: false,
    kite: 1.15,
  },
  [UnitClass.Mage]: {
    cls: UnitClass.Mage,
    name: 'Mage',
    hp: 70,
    speed: 1.3,
    damage: 26,
    range: 2.7,
    attackInterval: 1.75,
    armor: 0,
    resist: 0.2,
    damageType: DamageType.Magic,
    splash: 0.95,
    radius: 0.27,
    stationForward: -0.95,
    stationSpread: 0.6,
    leash: 0.9,
    ranged: true,
    taunt: false,
    kite: 1.3,
  },
}

export const UNIT_CLASSES: readonly UnitClass[] = [
  UnitClass.Warrior,
  UnitClass.Knight,
  UnitClass.Archer,
  UnitClass.Mage,
]

/**
 * What a Construct's tier does to the units it musters.
 *
 * Merging trades tiles and bodies for quality — two Barracks (6 Warriors on
 * two tiles) become one War Lodge (5 Warriors on one). For that to be a
 * decision rather than a downgrade, the survivors have to be worth more than
 * the ones given up: a tier-2 unit must beat 6/5 of a tier-1, and a tier-3
 * must beat 12/7 of one, or spamming cheap Constructs across the board would
 * simply be the better play.
 *
 * `stat` scales hp and damage together, so a higher-tier unit both hits
 * harder and lives longer — the two compound, which is most of why
 * concentration wins. `range` and `haste` are the qualitative half: a
 * tier-3 garrison reaches further and swings faster, which changes where you
 * want it standing, not just how big its numbers are.
 */
export interface TierProfile {
  /** Multiplies hp and damage. */
  readonly stat: number
  /** Multiplies attack reach. */
  readonly range: number
  /** Multiplies the interval between swings — below 1 is faster. */
  readonly haste: number
}

export const TIER_SCALING: Record<number, TierProfile> = {
  1: { stat: 1, range: 1, haste: 1 },
  2: { stat: 1.65, range: 1.1, haste: 0.92 },
  3: { stat: 2.6, range: 1.22, haste: 0.82 },
}
