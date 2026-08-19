import * as THREE from 'three'
import { UnitClass } from '../data/buildings'
import { UNITS } from '../data/units'
import { bake, box, cone, cyl, fitToTile, gem, type PartSpec } from './MeshKit'

/**
 * Procedural Fellowship units.
 *
 * The palette is the read: the Shadow Army is desaturated green, brown and
 * violet, so the Fellowship gets steel-blue and gold. At board zoom a player
 * needs to tell friend from foe before they can tell Warrior from Knight.
 */

const STEEL = 0xa8b6c8
const STEEL_DARK = 0x5b6878
const TABARD = 0x3f6bb5
const TABARD_DEEP = 0x2b4a80
const LEATHER = 0x7a5a3a
const CLOAK_GREEN = 0x3f7a55
const ROBE = 0x6b53b0
const ROBE_DEEP = 0x453575
const SKIN = 0xc79b76
const GOLD = 0xe0b45f
const ARCANE = 0x74e0ff

const head = (color: number, y: number, size = 0.16): PartSpec => ({
  geo: box(size, size, size * 0.9),
  color,
  pos: [0, y, 0.02],
})

const SHAPES: Record<UnitClass, () => PartSpec[]> = {
  [UnitClass.Warrior]: () => [
    { geo: box(0.26, 0.28, 0.2), color: TABARD, pos: [0, 0.34, 0] },
    { geo: box(0.28, 0.08, 0.22), color: STEEL_DARK, pos: [0, 0.47, 0] },
    head(SKIN, 0.58),
    { geo: box(0.07, 0.2, 0.07), color: TABARD_DEEP, pos: [-0.17, 0.34, 0] },
    { geo: box(0.07, 0.2, 0.07), color: TABARD_DEEP, pos: [0.17, 0.34, 0] },
    { geo: box(0.09, 0.18, 0.09), color: STEEL_DARK, pos: [-0.08, 0.1, 0] },
    { geo: box(0.09, 0.18, 0.09), color: STEEL_DARK, pos: [0.08, 0.1, 0] },
    { geo: box(0.04, 0.32, 0.04), color: STEEL, pos: [0.22, 0.44, 0.06], rot: [0.4, 0, 0] },
  ],

  [UnitClass.Knight]: () => [
    { geo: box(0.32, 0.34, 0.24), color: STEEL, pos: [0, 0.4, 0] },
    { geo: box(0.36, 0.1, 0.28), color: STEEL_DARK, pos: [0, 0.56, 0] },
    head(STEEL, 0.68, 0.18),
    { geo: cone(0.05, 0.14, 4), color: GOLD, pos: [0, 0.82, 0] },
    { geo: box(0.09, 0.24, 0.09), color: STEEL_DARK, pos: [-0.21, 0.4, 0] },
    { geo: box(0.09, 0.24, 0.09), color: STEEL_DARK, pos: [0.21, 0.4, 0] },
    { geo: box(0.11, 0.2, 0.11), color: STEEL_DARK, pos: [-0.1, 0.11, 0] },
    { geo: box(0.11, 0.2, 0.11), color: STEEL_DARK, pos: [0.1, 0.11, 0] },
    // The shield reads at a glance, which is how the player spots the anchor.
    { geo: box(0.22, 0.3, 0.05), color: TABARD, pos: [-0.26, 0.4, 0.14] },
    { geo: gem(0.05), color: GOLD, pos: [-0.26, 0.4, 0.19] },
  ],

  [UnitClass.Archer]: () => [
    { geo: box(0.22, 0.26, 0.18), color: CLOAK_GREEN, pos: [0, 0.32, 0] },
    { geo: cone(0.16, 0.18, 6), color: CLOAK_GREEN, pos: [0, 0.5, -0.02] },
    head(SKIN, 0.55, 0.14),
    { geo: box(0.06, 0.18, 0.06), color: LEATHER, pos: [-0.14, 0.32, 0] },
    { geo: box(0.06, 0.18, 0.06), color: LEATHER, pos: [0.14, 0.32, 0] },
    { geo: box(0.08, 0.16, 0.08), color: LEATHER, pos: [-0.07, 0.09, 0] },
    { geo: box(0.08, 0.16, 0.08), color: LEATHER, pos: [0.07, 0.09, 0] },
    { geo: cyl(0.02, 0.02, 0.34, 5), color: LEATHER, pos: [0.19, 0.38, 0.08], rot: [0, 0, 0.25] },
  ],

  [UnitClass.Mage]: () => [
    { geo: cone(0.19, 0.44, 7), color: ROBE, pos: [0, 0.22, 0] },
    { geo: box(0.22, 0.16, 0.18), color: ROBE_DEEP, pos: [0, 0.5, 0] },
    { geo: cone(0.13, 0.22, 6), color: ROBE, pos: [0, 0.68, 0] },
    head(SKIN, 0.56, 0.13),
    { geo: cyl(0.022, 0.022, 0.52, 5), color: LEATHER, pos: [0.2, 0.4, 0.04] },
    { geo: gem(0.07), color: ARCANE, pos: [0.2, 0.69, 0.04] },
  ],
}

const cache = new Map<UnitClass, THREE.BufferGeometry>()

/** Merged geometry for a unit class, fitted to its collision radius. */
export function unitGeometry(cls: UnitClass): THREE.BufferGeometry {
  let geo = cache.get(cls)
  if (!geo) {
    geo = bake(SHAPES[cls]())
    fitToTile(geo, UNITS[cls].radius, 1)
    cache.set(cls, geo)
  }
  return geo
}
