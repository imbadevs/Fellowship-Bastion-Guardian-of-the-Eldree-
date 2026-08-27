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

/** Stat multiplier applied to units from a tier-2 or tier-3 Construct. */
export const TIER_SCALING: Record<number, number> = { 1: 1, 2: 1.45, 3: 1.9 }
