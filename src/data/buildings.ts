import { DamageType } from '../sim/World'

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
  | 'warhost'
  | 'archery-range'
  | 'bowspire'
  | 'stormwatch-spire'
  | 'knights-hall'
  | 'bastion-keep'
  | 'highguard-citadel'
  | 'mage-spire'
  | 'arcane-obelisk'
  | 'eldree-sanctum'
  | 'palisade'
  | 'reinforced-palisade'
  | 'stoneguard-wall'
  | 'ballista'
  | 'heavy-ballista'
  | 'siege-ballista'
  | 'rune-ward'
  | 'rune-pillar'
  | 'rune-nexus'
  | 'healing-shrine'
  | 'blessed-shrine'
  | 'eternal-wellspring'

/** Consumed by SpawnerSystem in M4. */
export interface SpawnProfile {
  readonly unitClass: UnitClass
  /** Live units this building sustains. */
  readonly roster: number
  /** Seconds between replacing a fallen unit. */
  readonly interval: number
}

/**
 * A shrine's mending aura.
 *
 * Continuous rather than on a cooldown, so there is no shot to time and no
 * cooldown ring to show. Rates follow the same rule every other family does:
 * a tier has to beat the sum of what merged into it, so tier 2 clears 2x the
 * tier-1 rate and tier 3 clears 4x.
 */
export interface HealProfile {
  /** Hit points restored per second, shared across everyone in range. */
  readonly rate: number
  /** Radius in hex steps, like `WeaponProfile.range`. */
  readonly range: number
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
  readonly tier: 1 | 2 | 3
  readonly cost: number
  /** Short label for the tray card. */
  readonly glyph: string
  /** Structure health. Constructs are targets once the horde reaches them. */
  readonly hp: number
  readonly spawn?: SpawnProfile
  readonly weapon?: WeaponProfile
  readonly heal?: HealProfile
  /**
   * What its weapon deals, if it has one. Defaults to physical.
   *
   * Data rather than a check on the id: this used to read
   * `def.id === 'rune-ward'`, so merging a Rune Ward into its own upgrades
   * silently turned the game's only magic line physical — the counter
   * identity broke exactly when the player invested in it.
   */
  readonly damageType?: DamageType
  /**
   * The higher-tier Construct two of this one merge into, if any.
   *
   * Every family — the four spawners and the four defensive structures alike
   * — chains two deep (tier 1 to 2, tier 2 to 3). Kept as data rather than
   * derived from `tier`/`name` so an asymmetric family (three tier-1s, or a
   * merge that changes category) is not a special case, and so a family
   * could stop upgrading at any tier by just omitting the field.
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
    spawn: { unitClass: UnitClass.Warrior, roster: 3, interval: 4.9 },
    upgradesTo: 'warlodge',
  },
  warlodge: {
    id: 'warlodge',
    hp: 600,
    name: 'War Lodge',
    blurb: 'A larger Warrior host, faster to reform.',
    category: BuildingCategory.Spawner,
    tier: 2,
    cost: 150,
    glyph: 'WAR II',
    spawn: { unitClass: UnitClass.Warrior, roster: 5, interval: 3.7 },
    upgradesTo: 'warhost',
  },
  warhost: {
    id: 'warhost',
    hp: 1250,
    name: 'Warhost Bastion',
    blurb: 'A full warhost, primed to break any charge.',
    category: BuildingCategory.Spawner,
    tier: 3,
    cost: 340,
    glyph: 'WAR III',
    spawn: { unitClass: UnitClass.Warrior, roster: 7, interval: 2.9 },
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
    spawn: { unitClass: UnitClass.Archer, roster: 2, interval: 5.7 },
    upgradesTo: 'bowspire',
  },
  bowspire: {
    id: 'bowspire',
    hp: 500,
    name: 'Bowspire',
    blurb: 'Elevated Archers with extended reach.',
    category: BuildingCategory.Spawner,
    tier: 2,
    cost: 170,
    glyph: 'ARC II',
    spawn: { unitClass: UnitClass.Archer, roster: 3, interval: 4.5 },
    upgradesTo: 'stormwatch-spire',
  },
  'stormwatch-spire': {
    id: 'stormwatch-spire',
    hp: 1050,
    name: 'Stormwatch Spire',
    blurb: 'Massed Archers rain volleys from on high.',
    category: BuildingCategory.Spawner,
    tier: 3,
    cost: 380,
    glyph: 'ARC III',
    spawn: { unitClass: UnitClass.Archer, roster: 4, interval: 3.5 },
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
    spawn: { unitClass: UnitClass.Knight, roster: 1, interval: 8.2 },
    upgradesTo: 'bastion-keep',
  },
  'bastion-keep': {
    id: 'bastion-keep',
    hp: 780,
    name: 'Bastion Keep',
    blurb: 'A pair of Knights, swiftly rehorsed.',
    category: BuildingCategory.Spawner,
    tier: 2,
    cost: 230,
    glyph: 'KNT II',
    spawn: { unitClass: UnitClass.Knight, roster: 2, interval: 6.5 },
    upgradesTo: 'highguard-citadel',
  },
  'highguard-citadel': {
    id: 'highguard-citadel',
    hp: 1600,
    name: 'Highguard Citadel',
    blurb: 'A four-towered garrison, unbreakable and swift to rehorse.',
    category: BuildingCategory.Spawner,
    tier: 3,
    cost: 460,
    glyph: 'KNT III',
    spawn: { unitClass: UnitClass.Knight, roster: 3, interval: 5.3 },
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
    spawn: { unitClass: UnitClass.Mage, roster: 1, interval: 7.4 },
    upgradesTo: 'arcane-obelisk',
  },
  'arcane-obelisk': {
    id: 'arcane-obelisk',
    hp: 490,
    name: 'Arcane Obelisk',
    blurb: 'Twin Mages channel the Eldree.',
    category: BuildingCategory.Spawner,
    tier: 2,
    cost: 260,
    glyph: 'MAG II',
    spawn: { unitClass: UnitClass.Mage, roster: 2, interval: 6.1 },
    upgradesTo: 'eldree-sanctum',
  },
  'eldree-sanctum': {
    id: 'eldree-sanctum',
    hp: 1000,
    name: 'Eldree Sanctum',
    blurb: 'A ring of Mages channel the Eldree at full strength.',
    category: BuildingCategory.Spawner,
    tier: 3,
    cost: 480,
    glyph: 'MAG III',
    spawn: { unitClass: UnitClass.Mage, roster: 3, interval: 5.1 },
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
    upgradesTo: 'reinforced-palisade',
  },
  'reinforced-palisade': {
    id: 'reinforced-palisade',
    hp: 950,
    name: 'Reinforced Palisade',
    blurb: 'Thicker timber and stone, holding the line longer.',
    category: BuildingCategory.Defense,
    tier: 2,
    cost: 55,
    glyph: 'WALL II',
    upgradesTo: 'stoneguard-wall',
  },
  'stoneguard-wall': {
    id: 'stoneguard-wall',
    hp: 2150,
    name: 'Stoneguard Wall',
    blurb: 'A solid stone rampart the horde cannot easily break.',
    category: BuildingCategory.Defense,
    tier: 3,
    cost: 120,
    glyph: 'WALL III',
  },
  ballista: {
    id: 'ballista',
    hp: 240,
    name: 'Ballista Turret',
    blurb: 'Heavy bolts. Tears through Wraiths that shrug off magic.',
    category: BuildingCategory.Defense,
    tier: 1,
    cost: 95,
    glyph: 'BAL',
    weapon: { damage: 34, range: 3.5, cooldown: 1.8 },
    upgradesTo: 'heavy-ballista',
  },
  'heavy-ballista': {
    id: 'heavy-ballista',
    hp: 560,
    name: 'Heavy Ballista',
    blurb: 'A larger frame, heavier bolts, longer reach.',
    category: BuildingCategory.Defense,
    tier: 2,
    cost: 210,
    glyph: 'BAL II',
    weapon: { damage: 62, range: 4.1, cooldown: 1.45 },
    upgradesTo: 'siege-ballista',
  },
  'siege-ballista': {
    id: 'siege-ballista',
    hp: 1150,
    name: 'Siege Ballista',
    blurb: 'Siege-grade bolts. Nothing unarmoured survives the volley.',
    category: BuildingCategory.Defense,
    tier: 3,
    cost: 440,
    glyph: 'BAL III',
    weapon: { damage: 108, range: 4.7, cooldown: 1.25 },
  },
  'rune-ward': {
    id: 'rune-ward',
    hp: 200,
    name: 'Rune Ward',
    blurb: 'Arcane pulse. Ignores the armour Trolls hide behind.',
    category: BuildingCategory.Defense,
    tier: 1,
    cost: 120,
    glyph: 'RUNE',
    weapon: { damage: 18, range: 2.8, cooldown: 1.05, splash: 1.2 },
    upgradesTo: 'rune-pillar',
    damageType: DamageType.Magic,
  },
  'rune-pillar': {
    id: 'rune-pillar',
    hp: 480,
    name: 'Rune Pillar',
    blurb: 'A taller conduit, wider pulse, no armour worth the name.',
    category: BuildingCategory.Defense,
    tier: 2,
    cost: 260,
    glyph: 'RUNE II',
    weapon: { damage: 34, range: 3.2, cooldown: 0.95, splash: 1.45 },
    upgradesTo: 'rune-nexus',
    damageType: DamageType.Magic,
  },
  'rune-nexus': {
    id: 'rune-nexus',
    hp: 1020,
    name: 'Rune Nexus',
    blurb: 'Three wards fused into one relentless pulse.',
    category: BuildingCategory.Defense,
    tier: 3,
    cost: 540,
    glyph: 'RUNE III',
    weapon: { damage: 58, range: 3.5, cooldown: 0.8, splash: 1.75 },
    damageType: DamageType.Magic,
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
    upgradesTo: 'blessed-shrine',
    heal: { rate: 8, range: 2.4 },
  },
  'blessed-shrine': {
    id: 'blessed-shrine',
    hp: 470,
    name: 'Blessed Shrine',
    blurb: 'A stronger blessing, faster to mend the wounded.',
    category: BuildingCategory.Defense,
    tier: 2,
    cost: 300,
    glyph: 'SHRN II',
    upgradesTo: 'eternal-wellspring',
    heal: { rate: 18, range: 2.9 },
  },
  'eternal-wellspring': {
    id: 'eternal-wellspring',
    hp: 1080,
    name: 'Eternal Wellspring',
    blurb: 'An unending font of blessing for the whole garrison.',
    category: BuildingCategory.Defense,
    tier: 3,
    cost: 620,
    glyph: 'SHRN III',
    heal: { rate: 38, range: 3.4 },
  },
}

/**
 * Shop draft pool. Tier-3 Constructs are deliberately absent — they are
 * reached only by merging a matching pair of tier-2s, never bought outright,
 * so the top of every family (spawner or defensive) stays an upgrade to earn
 * rather than a fourth card in the drop table.
 */
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
  'reinforced-palisade',
  'heavy-ballista',
  'rune-pillar',
  'blessed-shrine',
]

/** Fraction of cost returned when a Construct is sold. */
export const SELL_REFUND = 0.6
