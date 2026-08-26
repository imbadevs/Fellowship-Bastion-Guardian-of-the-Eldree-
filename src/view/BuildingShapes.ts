import * as THREE from 'three'
import type { BuildingId } from '../data/buildings'
import { TILE_INNER_RADIUS } from '../data/grid'
import { bake, box, cone, cyl, fitToTile, gem, type PartSpec } from './MeshKit'

/**
 * Procedural Construct meshes.
 *
 * Each building is authored as a handful of primitives, then merged into a
 * single geometry with its palette baked into vertex colours. One geometry per
 * building type means one InstancedMesh and one draw call per type, however
 * many parts the silhouette needs and however many copies are on the board.
 *
 * Replaced by authored glTF in M7; the merged-geometry-per-type contract stays.
 */

const STONE = 0x8f8d84
const STONE_DARK = 0x615f59
const WOOD = 0x8a6240
const WOOD_DARK = 0x5d422b
const ROOF_RED = 0xa8433a
const ROOF_GREEN = 0x4c7a48
const STEEL = 0x9fb0c4
const STEEL_DARK = 0x5c6b7d
const ARCANE = 0x7d61c4
const CRYSTAL = 0x74e0ff
const GOLD = 0xd9b25f
const LEAF = 0x6bb058

/** A square pyramid roof. Four-segment cones need a 45 degree yaw to sit square. */
const pyramid = (r: number, h: number, y: number, color: number): PartSpec => ({
  geo: cone(r, h, 4),
  color,
  pos: [0, y, 0],
  rot: [0, Math.PI / 4, 0],
})

const banner = (x: number, color: number): PartSpec[] => [
  { geo: cyl(0.025, 0.025, 0.72, 5), color: WOOD_DARK, pos: [x, 0.62, 0.3] },
  { geo: box(0.02, 0.24, 0.2), color, pos: [x, 0.82, 0.4] },
]

const SHAPES: Record<BuildingId, () => PartSpec[]> = {
  barracks: () => [
    { geo: box(0.92, 0.42, 0.8), color: STONE, pos: [0, 0.21, 0] },
    { geo: box(0.96, 0.08, 0.84), color: STONE_DARK, pos: [0, 0.04, 0] },
    pyramid(0.72, 0.42, 0.63, ROOF_RED),
    ...banner(-0.34, ROOF_RED),
  ],

  warlodge: () => [
    { geo: box(1.02, 0.52, 0.88), color: STONE, pos: [0, 0.26, 0] },
    { geo: box(1.06, 0.09, 0.92), color: STONE_DARK, pos: [0, 0.045, 0] },
    { geo: cone(0.46, 0.4, 4), color: ROOF_RED, pos: [-0.24, 0.72, 0], rot: [0, Math.PI / 4, 0] },
    { geo: cone(0.46, 0.4, 4), color: ROOF_RED, pos: [0.24, 0.72, 0], rot: [0, Math.PI / 4, 0] },
    ...banner(-0.4, GOLD),
    ...banner(0.4, GOLD),
  ],

  'archery-range': () => [
    { geo: box(1.0, 0.16, 0.9), color: WOOD, pos: [0, 0.08, 0] },
    { geo: cyl(0.05, 0.05, 0.55, 6), color: WOOD_DARK, pos: [-0.38, 0.43, -0.3] },
    { geo: cyl(0.05, 0.05, 0.55, 6), color: WOOD_DARK, pos: [0.38, 0.43, -0.3] },
    { geo: box(0.86, 0.07, 0.07), color: WOOD_DARK, pos: [0, 0.68, -0.3] },
    { geo: cyl(0.2, 0.2, 0.05, 12), color: ROOF_RED, pos: [0, 0.42, 0.24], rot: [Math.PI / 2, 0, 0] },
    { geo: cyl(0.08, 0.08, 0.06, 10), color: 0xf0ece0, pos: [0, 0.42, 0.26], rot: [Math.PI / 2, 0, 0] },
  ],

  bowspire: () => [
    { geo: cyl(0.28, 0.36, 1.0, 8), color: STONE, pos: [0, 0.5, 0] },
    { geo: cyl(0.46, 0.46, 0.1, 8), color: STONE_DARK, pos: [0, 1.05, 0] },
    { geo: cone(0.44, 0.36, 8), color: ROOF_GREEN, pos: [0, 1.28, 0] },
    { geo: box(0.5, 0.06, 0.06), color: WOOD_DARK, pos: [0, 0.72, 0.3] },
  ],

  'knights-hall': () => [
    { geo: box(0.94, 0.62, 0.84), color: STONE, pos: [0, 0.31, 0] },
    { geo: box(0.98, 0.08, 0.88), color: STONE_DARK, pos: [0, 0.66, 0] },
    ...[-0.32, 0, 0.32].map(
      (x): PartSpec => ({ geo: box(0.16, 0.14, 0.16), color: STONE_DARK, pos: [x, 0.77, -0.3] }),
    ),
    { geo: gem(0.19), color: STEEL, pos: [0, 0.38, 0.44] },
  ],

  'bastion-keep': () => [
    { geo: box(0.76, 0.66, 0.72), color: STONE, pos: [0, 0.33, 0] },
    { geo: cyl(0.17, 0.19, 0.92, 8), color: STONE_DARK, pos: [-0.4, 0.46, 0.22] },
    { geo: cyl(0.17, 0.19, 0.92, 8), color: STONE_DARK, pos: [0.4, 0.46, 0.22] },
    { geo: cone(0.24, 0.3, 8), color: STEEL_DARK, pos: [-0.4, 1.07, 0.22] },
    { geo: cone(0.24, 0.3, 8), color: STEEL_DARK, pos: [0.4, 1.07, 0.22] },
    { geo: gem(0.2), color: STEEL, pos: [0, 0.52, 0.4] },
  ],

  'mage-spire': () => [
    { geo: cyl(0.17, 0.4, 0.98, 7), color: 0x4a4468, pos: [0, 0.49, 0] },
    { geo: cyl(0.24, 0.24, 0.08, 7), color: ARCANE, pos: [0, 1.0, 0] },
    { geo: gem(0.22), color: CRYSTAL, pos: [0, 1.24, 0] },
  ],

  'arcane-obelisk': () => [
    { geo: cyl(0.1, 0.3, 1.3, 4), color: 0x40395c, pos: [0, 0.65, 0], rot: [0, Math.PI / 4, 0] },
    { geo: cone(0.14, 0.24, 4), color: ARCANE, pos: [0, 1.42, 0], rot: [0, Math.PI / 4, 0] },
    { geo: gem(0.15), color: CRYSTAL, pos: [-0.36, 0.86, 0.1] },
    { geo: gem(0.15), color: CRYSTAL, pos: [0.36, 1.04, -0.1] },
  ],

  palisade: () => [
    ...[-0.36, -0.18, 0, 0.18, 0.36].map(
      (x, i): PartSpec => ({
        geo: cyl(0.075, 0.09, 0.5 + (i % 2) * 0.08, 6),
        color: i % 2 ? WOOD : WOOD_DARK,
        pos: [x, 0.25 + (i % 2) * 0.04, 0],
      }),
    ),
    ...[-0.36, -0.18, 0, 0.18, 0.36].map(
      (x, i): PartSpec => ({
        geo: cone(0.075, 0.1, 6),
        color: WOOD_DARK,
        pos: [x, 0.55 + (i % 2) * 0.08, 0],
      }),
    ),
    { geo: box(0.82, 0.06, 0.05), color: WOOD_DARK, pos: [0, 0.36, 0.09] },
  ],

  ballista: () => [
    { geo: box(0.66, 0.2, 0.66), color: WOOD, pos: [0, 0.1, 0] },
    { geo: cyl(0.1, 0.13, 0.24, 8), color: WOOD_DARK, pos: [0, 0.32, 0] },
    { geo: box(0.72, 0.06, 0.1), color: WOOD_DARK, pos: [0, 0.46, -0.02], rot: [0, 0, 0.12] },
    { geo: box(0.08, 0.06, 0.56), color: STEEL_DARK, pos: [0, 0.5, 0.12] },
    { geo: cone(0.05, 0.16, 6), color: STEEL, pos: [0, 0.5, 0.42], rot: [Math.PI / 2, 0, 0] },
  ],

  'rune-ward': () => [
    { geo: cyl(0.5, 0.54, 0.12, 6), color: STONE_DARK, pos: [0, 0.06, 0] },
    { geo: cyl(0.34, 0.34, 0.04, 6), color: ARCANE, pos: [0, 0.14, 0] },
    ...[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((a): PartSpec => ({
      geo: box(0.13, 0.4, 0.1),
      color: STONE,
      pos: [Math.cos(a) * 0.33, 0.32, Math.sin(a) * 0.33],
      rot: [0, -a, 0],
    })),
    { geo: gem(0.16), color: CRYSTAL, pos: [0, 0.62, 0] },
  ],

  'healing-shrine': () => [
    { geo: cyl(0.5, 0.52, 0.1, 6), color: STONE_DARK, pos: [0, 0.05, 0] },
    ...[0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].map((a): PartSpec => ({
      geo: cyl(0.06, 0.07, 0.58, 6),
      color: STONE,
      pos: [Math.cos(a) * 0.34, 0.39, Math.sin(a) * 0.34],
    })),
    { geo: cyl(0.48, 0.48, 0.07, 6), color: STONE, pos: [0, 0.71, 0] },
    { geo: cyl(0.24, 0.16, 0.18, 10), color: 0xd8d2c0, pos: [0, 0.19, 0] },
    { geo: gem(0.13), color: LEAF, pos: [0, 0.34, 0] },
  ],
}

/**
 * How much of the tile's inscribed circle a Construct's footprint should span.
 *
 * Just under 1: a Construct should read as filling its hex, while keeping a
 * sliver of ground visible at the edge so neighbouring tiles stay separable.
 */
const FOOTPRINT_FILL = 0.94

const cache = new Map<BuildingId, THREE.BufferGeometry>()

/**
 * Merged, tile-fitted geometry for a building type.
 *
 * Built once and shared by every instance, so the measure-and-scale pass costs
 * nothing per Construct placed.
 */
export function buildingGeometry(id: BuildingId): THREE.BufferGeometry {
  let geo = cache.get(id)
  if (!geo) {
    geo = bake(SHAPES[id]())
    fitToTile(geo, TILE_INNER_RADIUS * FOOTPRINT_FILL)
    cache.set(id, geo)
  }
  return geo
}

const heightCache = new Map<BuildingId, number>()

/**
 * Peak height of a building's fitted geometry above the tile surface.
 *
 * Measured off the actual geometry rather than hand-authored, so anything
 * that needs to sit above a Construct — a cooldown bar, say — can never drift
 * out of sync with a shape that gets tuned later.
 */
export function buildingHeight(id: BuildingId): number {
  let height = heightCache.get(id)
  if (height === undefined) {
    const geo = buildingGeometry(id)
    geo.computeBoundingBox()
    height = geo.boundingBox?.max.y ?? 0
    heightCache.set(id, height)
  }
  return height
}
