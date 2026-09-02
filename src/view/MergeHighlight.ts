import * as THREE from 'three'
import type { Cell } from '../hex/HexGrid'
import { TileMarker } from './TileMarker'

const MERGE_COLOR = 0xc98cff

/**
 * Merge targets blink rather than breathe like the hover/select markers do.
 *
 * Those are ambient — they say "you are here". This one is a call to action
 * with a short shelf life: it only exists while a Construct is in the air,
 * and the player has to spot it across the board without hunting. So it runs
 * roughly twice as fast, swings nearly its whole opacity range (0.12–0.80
 * against the old 0.18–0.46), and its curve is flattened toward the extremes
 * so it reads as on/off instead of a swell.
 */
const BLINK_BASE = 0.46
const BLINK_AMOUNT = 0.34
const BLINK_SPEED = 6.4
const BLINK_SHAPE = 0.4

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
      const marker = new TileMarker(this.tileSize, MERGE_COLOR, BLINK_BASE, BLINK_AMOUNT, BLINK_SPEED, BLINK_SHAPE)
      this.pool.push(marker)
      this.scene.add(marker.mesh)
    }
    // Phase is reset on every show: pooled markers accumulate their pulse
    // only while visible, so without this the ones reused most would blink
    // out of step with the rest and read as a shimmer rather than one signal.
    cells.forEach((cell, i) => {
      this.pool[i]!.resetPulse()
      this.pool[i]!.show(cell)
    })
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
