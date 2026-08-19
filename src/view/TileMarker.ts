import * as THREE from 'three'
import type { Cell } from '../hex/HexGrid'

/**
 * A glowing hex plate that snaps to a tile. Used for hover and selection.
 *
 * Additive and depth-write-free so it reads as light on the surface rather than
 * as a stacked object, which matters once buildings occupy the same tile.
 */
export class TileMarker {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.MeshBasicMaterial
  private cell: Cell | null = null
  private pulse = 0

  constructor(
    tileSize: number,
    color: number,
    private readonly baseOpacity: number,
    private readonly pulseAmount = 0,
  ) {
    const geometry = new THREE.CylinderGeometry(tileSize * 0.95, tileSize * 0.95, 0.05, 6)
    this.material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: baseOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.renderOrder = 2
    this.mesh.visible = false
    this.mesh.frustumCulled = false
  }

  show(cell: Cell): void {
    this.cell = cell
    this.mesh.position.set(cell.worldX, cell.surfaceY + 0.03, cell.worldZ)
    this.mesh.visible = true
  }

  hide(): void {
    this.cell = null
    this.mesh.visible = false
  }

  get current(): Cell | null {
    return this.cell
  }

  setColor(hex: number): void {
    this.material.color.setHex(hex)
  }

  update(dt: number): void {
    if (!this.mesh.visible || this.pulseAmount === 0) return
    this.pulse += dt * 3.4
    this.material.opacity = this.baseOpacity + Math.sin(this.pulse) * this.pulseAmount
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
