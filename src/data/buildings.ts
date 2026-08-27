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
    upgradesTo: 'warhost',
  },
  warhost: {
    id: 'warhost',
    hp: 520,
    name: 'Warhost Bastion',
    blurb: 'A full warhost, primed to break any charge.',
    category: BuildingCategory.Spawner,
    tier: 3,
    cost: 340,
    glyph: 'WAR III',
    spawn: { unitClass: UnitClass.Warrior, roster: 7, interval: 3.5 },
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
    upgradesTo: 'stormwatch-spire',
  },
  'stormwatch-spire': {
    id: 'stormwatch-spire',
    hp: 400,
    name: 'Stormwatch Spire',
    blurb: 'Massed Archers rain volleys from on high.',
    category: BuildingCategory.Spawner,
    tier: 3,
    cost: 380,
    glyph: 'ARC III',
    spawn: { unitClass: UnitClass.Archer, roster: 4, interval: 4.3 },
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
    upgradesTo: 'highguard-citadel',
  },
  'highguard-citadel': {
    id: 'highguard-citadel',
    hp: 640,
    name: 'Highguard Citadel',
    blurb: 'A four-towered garrison, unbreakable and swift to rehorse.',
    category: BuildingCategory.Spawner,
    tier: 3,
    cost: 460,
    glyph: 'KNT III',
    spawn: { unitClass: UnitClass.Knight, roster: 3, interval: 6.5 },
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
    upgradesTo: 'eldree-sanctum',
  },
  'eldree-sanctum': {
    id: 'eldree-sanctum',
    hp: 380,
    name: 'Eldree Sanctum',
    blurb: 'A ring of Mages channel the Eldree at full strength.',
    category: BuildingCategory.Spawner,
    tier: 3,
    cost: 480,
    glyph: 'MAG III',
    spawn: { unitClass: UnitClass.Mage, roster: 3, interval: 6.2 },
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
    hp: 610,
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
    hp: 850,
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
    blurb: 'Heavy bolts. Punishes armoured Trolls.',
    category: BuildingCategory.Defense,
    tier: 1,
    cost: 95,
    glyph: 'BAL',
    weapon: { damage: 34, range: 3.5, cooldown: 1.8 },
    upgradesTo: 'heavy-ballista',
  },
  'heavy-ballista': {
    id: 'heavy-ballista',
    hp: 350,
    name: 'Heavy Ballista',
    blurb: 'A larger frame, heavier bolts, longer reach.',
    category: BuildingCategory.Defense,
    tier: 2,
    cost: 210,
    glyph: 'BAL II',
    weapon: { damage: 49, range: 4, cooldown: 1.5 },
    upgradesTo: 'siege-ballista',
  },
  'siege-ballista': {
    id: 'siege-ballista',
    hp: 490,
    name: 'Siege Ballista',
    blurb: 'Siege-grade bolts that shatter armour outright.',
    category: BuildingCategory.Defense,
    tier: 3,
    cost: 440,
    glyph: 'BAL III',
    weapon: { damage: 70, range: 4.5, cooldown: 1.3 },
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
    upgradesTo: 'rune-pillar',
  },
  'rune-pillar': {
    id: 'rune-pillar',
    hp: 300,
    name: 'Rune Pillar',
    blurb: 'A taller conduit, wider pulse, Wraiths cannot dodge.',
    category: BuildingCategory.Defense,
    tier: 2,
    cost: 260,
    glyph: 'RUNE II',
    weapon: { damage: 20, range: 2.3, cooldown: 0.95, splash: 1.4 },
    upgradesTo: 'rune-nexus',
  },
  'rune-nexus': {
    id: 'rune-nexus',
    hp: 420,
    name: 'Rune Nexus',
    blurb: 'Three wards fused into one relentless pulse.',
    category: BuildingCategory.Defense,
    tier: 3,
    cost: 540,
    glyph: 'RUNE III',
    weapon: { damage: 26, range: 2.5, cooldown: 0.8, splash: 1.6 },
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
  },
  'blessed-shrine': {
    id: 'blessed-shrine',
    hp: 300,
    name: 'Blessed Shrine',
    blurb: 'A stronger blessing, faster to mend the wounded.',
    category: BuildingCategory.Defense,
    tier: 2,
    cost: 300,
    glyph: 'SHRN II',
    upgradesTo: 'eternal-wellspring',
  },
  'eternal-wellspring': {
    id: 'eternal-wellspring',
    hp: 420,
    name: 'Eternal Wellspring',
    blurb: 'An unending font of blessing for the whole garrison.',
    category: BuildingCategory.Defense,
    tier: 3,
    cost: 620,
    glyph: 'SHRN III',
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
