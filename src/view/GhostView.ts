import * as THREE from 'three'
import type { BuildingId } from '../data/buildings'
import type { Cell } from '../hex/HexGrid'
import { buildingGeometry } from './BuildingShapes'
import { BuildingView } from './BuildingView'

const VALID_TINT = 0x2f7a3a
const INVALID_TINT = 0x8a2f2a
/** Matches MergeHighlight's marker colour, so the two read as one language. */
const MERGE_TINT = 0x6a3f8a

export type GhostState = 'valid' | 'invalid' | 'merge'

/**
 * Translucent preview of the Construct being placed.
 *
 * It hovers slightly above the tile and bobs, which does two things at once:
 * it reads as "not yet committed", and it keeps the silhouette clear of the
 * tile it is being judged against.
 *
 * `'merge'` is a distinct third state, not a shade of valid: dropping a
 * purchase onto a matching Construct combines the two instead of failing as
 * occupied. The merge result is drawn at random, so the ghost keeps showing
 * what's being dragged rather than a specific outcome — the tint alone
 * signals "this drop merges"; what it becomes is revealed on commit.
 */
export class GhostView {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.MeshLambertMaterial
  private currentId: BuildingId | null = null
  private time = 0
  private baseY = 0

  constructor() {
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material)
    this.mesh.visible = false
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
  }

  show(id: BuildingId, cell: Cell, state: GhostState): void {
    if (id !== this.currentId) {
      this.mesh.geometry = buildingGeometry(id)
      this.currentId = id
    }
    this.baseY = cell.surfaceY + 0.16
    this.mesh.position.set(cell.worldX, this.baseY, cell.worldZ)
    this.mesh.rotation.y = BuildingView.yawFor(cell)
    this.material.emissive.setHex(state === 'valid' ? VALID_TINT : state === 'merge' ? MERGE_TINT : INVALID_TINT)
    this.material.opacity = state === 'invalid' ? 0.45 : 0.62
    this.mesh.visible = true
  }

  hide(): void {
    this.mesh.visible = false
  }

  update(dt: number): void {
    if (!this.mesh.visible) return
    this.time += dt
    this.mesh.position.y = this.baseY + Math.sin(this.time * 4.2) * 0.045
  }
}
