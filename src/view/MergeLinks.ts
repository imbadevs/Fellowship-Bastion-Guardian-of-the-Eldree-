import * as THREE from 'three'
import type { Cell } from '../hex/HexGrid'

const MERGE_COLOR = 0xc98cff
/** Roughly waist-height on a tier-1 Construct — clears the tile surface without floating too far above it. */
const LINE_HEIGHT = 0.6
/**
 * Half-height of the ribbon, in world units, measured vertically (not in the
 * ground plane). The camera looks down at a fixed ~62° pitch — a ribbon flat
 * in the XZ plane presents almost its bare edge from that angle and reads as
 * near-invisible, the same problem a raw WebGL line has (~1px regardless of
 * `linewidth`, unreliable cross-browser). Standing it up vertically instead
 * means the camera sees its full face, like a short beam of light.
 */
const LINE_WIDTH = 0.16
/** No family ever has more matches than this on a board this size; sized up front rather than reallocated per drag. */
const MAX_LINKS = 8
/** Vertices per link: two triangles (A,B,C) and (A,C,D) sharing edge A-C, no index buffer needed. */
const VERTS_PER_LINK = 6

/**
 * Draws a glowing ribbon from the Construct being dragged for a merge to
 * every eligible partner on the board.
 *
 * MergeHighlight already lights up the target tiles, but scanning the whole
 * board for a violet tile is slower than following a line straight to it —
 * this is the same information, read faster. One mesh sized to `MAX_LINKS`
 * up front, so showing N links is one buffer write and one draw call, not N
 * allocations.
 */
export class MergeLinks {
  private readonly geometry = new THREE.BufferGeometry()
  private readonly material: THREE.MeshBasicMaterial
  private readonly mesh: THREE.Mesh
  private readonly positions = new Float32Array(MAX_LINKS * VERTS_PER_LINK * 3)
  private pulse = 0

  constructor(scene: THREE.Scene) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setDrawRange(0, 0)
    this.material = new THREE.MeshBasicMaterial({
      color: MERGE_COLOR,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // The beam floats in open air between two tiles, at a height nearby
      // geometry (tiles, buildings) would otherwise occlude it at — this is
      // an indicator, not a scene object, so it should always read through.
      depthTest: false,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.renderOrder = 3
    this.mesh.visible = false
    this.mesh.frustumCulled = false
    scene.add(this.mesh)
  }

  /** `origin` is the dragged Construct's own tile — it stays put visually while lifted. */
  show(origin: Cell, targets: readonly Cell[]): void {
    const n = Math.min(targets.length, MAX_LINKS)
    const yLo = LINE_HEIGHT - LINE_WIDTH
    const yHi = LINE_HEIGHT + LINE_WIDTH
    for (let i = 0; i < n; i++) {
      const target = targets[i]!
      const base = i * VERTS_PER_LINK * 3
      // A vertical quad standing between origin and target — low/high at
      // each end. Triangle A,B,C then A,C,D.
      const verts = [
        origin.worldX, yLo, origin.worldZ,
        origin.worldX, yHi, origin.worldZ,
        target.worldX, yHi, target.worldZ,
        origin.worldX, yLo, origin.worldZ,
        target.worldX, yHi, target.worldZ,
        target.worldX, yLo, target.worldZ,
      ]
      this.positions.set(verts, base)
    }
    this.geometry.attributes.position!.needsUpdate = true
    this.geometry.setDrawRange(0, n * VERTS_PER_LINK)
    this.mesh.visible = n > 0
  }

  hide(): void {
    this.mesh.visible = false
  }

  update(dt: number): void {
    if (!this.mesh.visible) return
    this.pulse += dt * 3.4
    this.material.opacity = 0.5 + Math.sin(this.pulse) * 0.2
  }
}
