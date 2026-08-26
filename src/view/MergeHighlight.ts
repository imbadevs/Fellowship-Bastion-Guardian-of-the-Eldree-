import * as THREE from 'three'
import type { Cell } from '../hex/HexGrid'
import { TileMarker } from './TileMarker'

const MERGE_COLOR = 0xc98cff

/**
 * Highlights every eligible merge target at once, the moment merge mode is
 * armed.
 *
 * Placement's own hover marker only appears once a drag starts tracking the
 * pointer, which never happens for a tap-only interaction — so a merge needs
 * its own always-on highlight to show all of the player's options up front,
 * not just whichever tile they happen to be touching.
 *
 * Markers are pooled rather than reallocated per call, since "show these N
 * cells" happens every time merge mode arms and the eligible count varies.
 */
export class MergeHighlight {
  private readonly pool: TileMarker[] = []
  private active = 0

  constructor(
    private readonly scene: THREE.Scene,
    private readonly tileSize: number,
  ) {}

  showAll(cells: readonly Cell[]): void {
    while (this.pool.length < cells.length) {
      const marker = new TileMarker(this.tileSize, MERGE_COLOR, 0.32, 0.14)
      this.pool.push(marker)
      this.scene.add(marker.mesh)
    }
    cells.forEach((cell, i) => this.pool[i]!.show(cell))
    for (let i = cells.length; i < this.active; i++) this.pool[i]!.hide()
    this.active = cells.length
  }

  hideAll(): void {
    for (let i = 0; i < this.active; i++) this.pool[i]!.hide()
    this.active = 0
  }

  update(dt: number): void {
    for (let i = 0; i < this.active; i++) this.pool[i]!.update(dt)
  }
}
