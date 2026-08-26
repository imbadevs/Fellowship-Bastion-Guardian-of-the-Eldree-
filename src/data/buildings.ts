/**
 * Construct definitions.
 *
 * Everything balance-facing lives here as plain data so tuning never requires a
 * code change. Combat fields (`spawn`, `weapon`) are authored now but not read
 * until M4 — defining them alongside cost keeps a building's identity in one
 * place instead of split across milestones.
 */

export const enum BuildingCategory {
  /** Deploys combat units automatically. */
  Spawner,
  /** Fights or supports directly from its tile. */
  Defense,
}

export const enum UnitClass {
  Warrior,
  Archer,
  Knight,
  Mage,
}

export type BuildingId =
  | 'barracks'
  | 'warlodge'
  | 'archery-range'
  | 'bowspire'
  | 'knights-hall'
  | 'bastion-keep'
  | 'mage-spire'
  | 'arcane-obelisk'
  | 'palisade'
  | 'ballista'
  | 'rune-ward'
  | 'healing-shrine'

/** Consumed by SpawnerSystem in M4. */
export interface SpawnProfile {
  readonly unitClass: UnitClass
  /** Live units this building sustains. */
  readonly roster: number
  /** Seconds between replacing a fallen unit. */
  readonly interval: number
}

/** Consumed by CombatSystem in M4. */
export interface WeaponProfile {
  readonly damage: number
  /** Range in hex steps. */
  readonly range: number
  readonly cooldown: number
  readonly splash?: number
}

export interface BuildingDef {
  readonly id: BuildingId
  readonly name: string
  readonly blurb: string
  readonly category: BuildingCategory
  readonly tier: 1 | 2
  readonly cost: number
  /** Short label for the tray card. */
  readonly glyph: string
  /** Structure health. Constructs are targets once the horde reaches them. */
  readonly hp: number
  readonly spawn?: SpawnProfile
  readonly weapon?: WeaponProfile
  /**
   * The tier-2 Construct two of this one merge into, if any.
   *
   * Only the four tier-1 spawners have one — the defensive structures have no
   * tier-2 counterpart yet, so they are simply not mergeable. Kept as data
   * rather than derived from `tier`/`name` so a future asymmetric family
   * (three tier-1s, or a merge that changes category) is not a special case.
   */
  readonly upgradesTo?: BuildingId
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  barracks: {
    id: 'barracks',
    hp: 260,
    name: 'Barracks',
    blurb: 'Sends Warriors to hold the line.',
    category: BuildingCategory.Spawner,
    tier: 1,
    cost: 60,
    glyph: 'WAR',
    spawn: { unitClass: UnitClass.Warrior, roster: 3, interval: 6 },
    upgradesTo: 'warlodge',
  },
  warlodge: {
    id: 'warlodge',
    hp: 380,
    name: 'War Lodge',
    blurb: 'A larger Warrior host, faster to reform.',
    category: BuildingCategory.Spawner,
    tier: 2,
    cost: 150,
    glyph: 'WAR II',
    spawn: { unitClass: UnitClass.Warrior, roster: 5, interval: 4.5 },
  },
  'archery-range': {
    id: 'archery-range',
    hp: 220,
    name: 'Archery Range',
    blurb: 'Archers strike single targets at range.',
    category: BuildingCategory.Spawner,
    tier: 1,
    cost: 75,
    glyph: 'ARC',
    spawn: { unitClass: UnitClass.Archer, roster: 2, interval: 7 },
    upgradesTo: 'bowspire',
  },
  bowspire: {
    id: 'bowspire',
    hp: 300,
    name: 'Bowspire',
    blurb: 'Elevated Archers with extended reach.',
    category: BuildingCategory.Spawner,
    tier: 2,
    cost: 170,
    glyph: 'ARC II',
    spawn: { unitClass: UnitClass.Archer, roster: 3, interval: 5.5 },
  },
  'knights-hall': {
    id: 'knights-hall',
    hp: 340,
    name: "Knight's Hall",
    blurb: 'Knights taunt and absorb the charge.',
    category: BuildingCategory.Spawner,
    tier: 1,
    cost: 110,
    glyph: 'KNT',
    spawn: { unitClass: UnitClass.Knight, roster: 1, interval: 10 },
    upgradesTo: 'bastion-keep',
  },
  'bastion-keep': {
    id: 'bastion-keep',
    hp: 480,
    name: 'Bastion Keep',
    blurb: 'A pair of Knights, swiftly rehorsed.',
    category: BuildingCategory.Spawner,
    tier: 2,
    cost: 230,
    glyph: 'KNT II',
    spawn: { unitClass: UnitClass.Knight, roster: 2, interval: 8 },
  },
  'mage-spire': {
    id: 'mage-spire',
    hp: 210,
    name: 'Mage Spire',
    blurb: 'Mages burn packs with arcane splash.',
    category: BuildingCategory.Spawner,
    tier: 1,
    cost: 130,
    glyph: 'MAG',
    spawn: { unitClass: UnitClass.Mage, roster: 1, interval: 9 },
    upgradesTo: 'arcane-obelisk',
  },
  'arcane-obelisk': {
    id: 'arcane-obelisk',
    hp: 280,
    name: 'Arcane Obelisk',
    blurb: 'Twin Mages channel the Eldree.',
    category: BuildingCategory.Spawner,
    tier: 2,
    cost: 260,
    glyph: 'MAG II',
    spawn: { unitClass: UnitClass.Mage, roster: 2, interval: 7.5 },
  },
  palisade: {
    id: 'palisade',
    hp: 420,
    name: 'Palisade',
    blurb: 'Cheap bulk. Slows the horde where it stands.',
    category: BuildingCategory.Defense,
    tier: 1,
    cost: 25,
    glyph: 'WALL',
  },
  ballista: {
    id: 'ballista',
    hp: 240,
    name: 'Ballista Turret',
    blurb: 'Heavy bolts. Punishes armoured Trolls.',
    category: BuildingCategory.Defense,
    tier: 1,
    cost: 95,
    glyph: 'BAL',
    weapon: { damage: 34, range: 3.5, cooldown: 1.8 },
  },
  'rune-ward': {
    id: 'rune-ward',
    hp: 200,
    name: 'Rune Ward',
    blurb: 'Arcane pulse. Wraiths cannot ignore it.',
    category: BuildingCategory.Defense,
    tier: 1,
    cost: 120,
    glyph: 'RUNE',
    weapon: { damage: 14, range: 2, cooldown: 1.1, splash: 1.2 },
  },
  'healing-shrine': {
    id: 'healing-shrine',
    hp: 200,
    name: 'Healing Shrine',
    blurb: 'Mends nearby units between clashes.',
    category: BuildingCategory.Defense,
    tier: 1,
    cost: 140,
    glyph: 'SHRN',
  },
}

export const BUILDING_ORDER: readonly BuildingId[] = [
  'barracks',
  'archery-range',
  'knights-hall',
  'mage-spire',
  'palisade',
  'ballista',
  'rune-ward',
  'healing-shrine',
  'warlodge',
  'bowspire',
  'bastion-keep',
  'arcane-obelisk',
]

/** Fraction of cost returned when a Construct is sold. */
export const SELL_REFUND = 0.6
