import * as THREE from 'three'
import type { BuildingId } from '../data/buildings'
import type { BuildingRegistry } from '../game/Buildings'
import type { Cell } from '../hex/HexGrid'
import { BOARD_RADIUS, tileCount } from '../data/grid'
import { buildingGeometry } from './BuildingShapes'

/** Max Constructs of any one type — every tile but the Eldree's, at full expansion. */
const CAPACITY = tileCount(BOARD_RADIUS) - 1

/**
 * Renders placed Constructs, one InstancedMesh per building type.
 *
 * Meshes are created on first placement and hidden when a type's count drops to
 * zero, so an unused building type costs no draw call. Instance sets are
 * rebuilt wholesale on change rather than patched — at 60 matrices the bookkeeping
 * a swap-remove would need is more expensive than just rewriting the array.
 */
export class BuildingView {
  private readonly meshes = new Map<BuildingId, THREE.InstancedMesh>()
  private readonly matrix = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly quaternion = new THREE.Quaternion()
  private readonly euler = new THREE.Euler()
  private readonly scale = new THREE.Vector3(1, 1, 1)

  constructor(
    private readonly scene: THREE.Scene,
    private readonly registry: BuildingRegistry,
  ) {}

  /**
   * Constructs face away from the Eldree, so walls present their outer face and
   * banners read from the direction the horde arrives.
   */
  static yawFor(cell: Cell): number {
    if (cell.ring === 0) return 0
    return Math.atan2(cell.worldX, cell.worldZ)
  }

  private meshFor(id: BuildingId): THREE.InstancedMesh {
    let mesh = this.meshes.get(id)
    if (!mesh) {
      const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
      mesh = new THREE.InstancedMesh(buildingGeometry(id), material, CAPACITY)
      mesh.frustumCulled = false
      mesh.count = 0
      mesh.visible = false
      this.meshes.set(id, mesh)
      this.scene.add(mesh)
    }
    return mesh
  }

  refresh(id: BuildingId): void {
    const placed = this.registry.ofType(id)
    const mesh = this.meshFor(id)

    for (let i = 0; i < placed.length; i++) {
      const { cell } = placed[i]!
      this.position.set(cell.worldX, cell.surfaceY, cell.worldZ)
      this.euler.set(0, BuildingView.yawFor(cell), 0)
      this.quaternion.setFromEuler(this.euler)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      mesh.setMatrixAt(i, this.matrix)
    }

    mesh.count = placed.length
    mesh.visible = placed.length > 0
    mesh.instanceMatrix.needsUpdate = true
  }

  refreshAll(): void {
    for (const id of this.meshes.keys()) this.refresh(id)
  }
}
