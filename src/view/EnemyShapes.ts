import * as THREE from 'three'
import { ENEMIES, EnemyKind } from '../data/enemies'
import { bake, box, cone, cyl, fitToTile, gem, type PartSpec } from './MeshKit'

/**
 * Procedural Shadow Army meshes.
 *
 * Silhouette does the work, not detail: at this camera distance a player reads
 * body mass and posture, not faces. Orcs are small and hunched, Trolls are wide
 * and heavy, Wraiths are legless and tapered so they read as floating even when
 * standing still.
 */

const ORC_SKIN = 0x6c8f4a
const ORC_DARK = 0x455c30
const TROLL_SKIN = 0x8a7f6a
const TROLL_DARK = 0x574f42
const TROLL_ARMOR = 0x5d5346
const WRAITH_CLOTH = 0x2f2a44
const WRAITH_DEEP = 0x1b1830
const EMBER = 0xff6a3d
const SPECTRE = 0x8fd8ff
const IRON = 0x6a6f78

const SHAPES: Record<EnemyKind, () => PartSpec[]> = {
  [EnemyKind.Orc]: () => [
    { geo: box(0.3, 0.3, 0.24), color: ORC_SKIN, pos: [0, 0.32, 0], rot: [0.22, 0, 0] },
    { geo: box(0.19, 0.16, 0.18), color: ORC_SKIN, pos: [0, 0.54, 0.08] },
    { geo: box(0.08, 0.22, 0.08), color: ORC_DARK, pos: [-0.19, 0.32, 0.02] },
    { geo: box(0.08, 0.22, 0.08), color: ORC_DARK, pos: [0.19, 0.32, 0.02] },
    { geo: box(0.1, 0.18, 0.1), color: ORC_DARK, pos: [-0.09, 0.09, 0] },
    { geo: box(0.1, 0.18, 0.1), color: ORC_DARK, pos: [0.09, 0.09, 0] },
    { geo: cone(0.05, 0.16, 4), color: IRON, pos: [0.24, 0.46, 0.12], rot: [0.5, 0, 0] },
    { geo: gem(0.035), color: EMBER, pos: [0, 0.56, 0.17] },
  ],

  [EnemyKind.Troll]: () => [
    { geo: box(0.52, 0.44, 0.38), color: TROLL_SKIN, pos: [0, 0.46, 0], rot: [0.16, 0, 0] },
    { geo: box(0.56, 0.12, 0.42), color: TROLL_ARMOR, pos: [0, 0.66, 0] },
    { geo: box(0.24, 0.2, 0.22), color: TROLL_SKIN, pos: [0, 0.8, 0.06] },
    { geo: box(0.14, 0.34, 0.14), color: TROLL_DARK, pos: [-0.33, 0.44, 0.02] },
    { geo: box(0.14, 0.34, 0.14), color: TROLL_DARK, pos: [0.33, 0.44, 0.02] },
    { geo: box(0.16, 0.26, 0.16), color: TROLL_DARK, pos: [-0.14, 0.13, 0] },
    { geo: box(0.16, 0.26, 0.16), color: TROLL_DARK, pos: [0.14, 0.13, 0] },
    { geo: cone(0.07, 0.2, 4), color: IRON, pos: [-0.38, 0.24, 0.06] },
    { geo: gem(0.045), color: EMBER, pos: [0, 0.83, 0.15] },
  ],

  [EnemyKind.Wraith]: () => [
    // No legs: the body tapers to a point so it reads as hovering.
    { geo: cone(0.26, 0.5, 6), color: WRAITH_DEEP, pos: [0, 0.28, 0], rot: [Math.PI, 0, 0] },
    { geo: cyl(0.2, 0.28, 0.34, 6), color: WRAITH_CLOTH, pos: [0, 0.62, 0] },
    { geo: cone(0.22, 0.24, 6), color: WRAITH_CLOTH, pos: [0, 0.86, 0] },
    { geo: box(0.34, 0.1, 0.12), color: WRAITH_DEEP, pos: [0, 0.7, 0.04], rot: [0, 0, 0.3] },
    { geo: gem(0.04), color: SPECTRE, pos: [-0.06, 0.78, 0.16] },
    { geo: gem(0.04), color: SPECTRE, pos: [0.06, 0.78, 0.16] },
  ],
}

const cache = new Map<EnemyKind, THREE.BufferGeometry>()

/**
 * Merged geometry for an enemy type, scaled so its silhouette matches the
 * collision radius the simulation uses.
 *
 * Fitting rather than hand-sizing means body size is tuned in `enemies.ts`
 * alongside speed and health, and a model can never drift from the space it
 * actually occupies — which would show up as bodies visibly overlapping, or
 * standing apart for no reason, once a horde packs in around the Eldree.
 *
 * Unlike Constructs the scale is uniform: these are creatures, and squashing
 * their proportions to fit a footprint would read as wrong immediately.
 */
export function enemyGeometry(kind: EnemyKind): THREE.BufferGeometry {
  let geo = cache.get(kind)
  if (!geo) {
    geo = bake(SHAPES[kind]())
    fitToTile(geo, ENEMIES[kind].radius, 1)
    cache.set(kind, geo)
  }
  return geo
}
