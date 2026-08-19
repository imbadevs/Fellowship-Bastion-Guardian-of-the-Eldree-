import * as THREE from 'three'
import type { Cell, HexGrid } from '../hex/HexGrid'
import { RING_STYLES, TILE_INSET } from '../data/grid'

/** How far the tile sides extend below y=0, so the board reads as solid ground. */
const SKIRT = 0.7

/**
 * Renders the board as a single InstancedMesh — one draw call, whatever its size.
 *
 * Top and side faces are shaded differently without a second material by baking
 * a brightness ramp into the geometry's vertex colours, which three multiplies
 * with the per-instance colour. That keeps ring tinting on the instance
 * attribute and the two-tone look free.
 *
 * Only unlocked cells are drawn, so the instance index is not the cell index.
 * `instanceToCell` carries that mapping for picking.
 */
export class HexGridView {
  readonly mesh: THREE.InstancedMesh
  private instanceToCell: Cell[] = []
  private readonly matrix = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly quaternion = new THREE.Quaternion()
  private readonly scale = new THREE.Vector3()
  private readonly color = new THREE.Color()

  constructor(private readonly grid: HexGrid) {
    const geometry = new THREE.CylinderGeometry(
      grid.size * TILE_INSET,
      grid.size * TILE_INSET,
      1,
      6,
    )
    // CylinderGeometry's first vertex sits at +Z, which is exactly the
    // pointy-top orientation our axial layout expects. No rotation needed.
    geometry.translate(0, 0.5, 0)
    geometry.computeVertexNormals()
    HexGridView.bakeFaceShading(geometry)

    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })

    // Capacity covers full expansion; `count` tracks what is currently in play.
    this.mesh = new THREE.InstancedMesh(geometry, material, grid.cells.length)
    this.mesh.frustumCulled = false
    this.rebuild()
  }

  /** Darkens side and bottom faces via vertex colour, keyed off the face normal. */
  private static bakeFaceShading(geometry: THREE.BufferGeometry): void {
    const normal = geometry.getAttribute('normal')
    const colors = new Float32Array(normal.count * 3)
    for (let i = 0; i < normal.count; i++) {
      const ny = normal.getY(i)
      const shade = ny > 0.5 ? 1 : ny < -0.5 ? 0.3 : 0.58
      colors[i * 3] = shade
      colors[i * 3 + 1] = shade
      colors[i * 3 + 2] = shade
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }

  private styleFor(cell: Cell) {
    return RING_STYLES[cell.ring] ?? RING_STYLES[RING_STYLES.length - 1]!
  }

  /** Rewrites the instance set from the grid's currently unlocked cells. */
  rebuild(): void {
    this.instanceToCell = this.grid.visibleCells()

    for (let i = 0; i < this.instanceToCell.length; i++) {
      const cell = this.instanceToCell[i]!
      const style = this.styleFor(cell)
      const height = SKIRT + style.elevation

      this.position.set(cell.worldX, -SKIRT, cell.worldZ)
      this.scale.set(1, height, 1)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      this.mesh.setMatrixAt(i, this.matrix)

      this.color.setHex(style.top)
      this.mesh.setColorAt(i, this.color)

      // Keep the logical surface height in sync so buildings and markers can sit
      // on the tile without re-deriving it.
      ;(cell as { surfaceY: number }).surfaceY = style.elevation
    }

    this.mesh.count = this.instanceToCell.length
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.mesh.computeBoundingSphere()
  }

  /** Maps a raycast hit on this mesh back to a board cell. */
  cellFromInstanceId(instanceId: number): Cell | undefined {
    return this.instanceToCell[instanceId]
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
