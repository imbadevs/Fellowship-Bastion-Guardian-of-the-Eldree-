import * as THREE from 'three'
import type { HexGrid } from '../hex/HexGrid'
import { Category, MAX_ENTITIES, type World } from '../sim/World'

/** Ground height used beyond the board edge, matching the outermost ring. */
const OUTER_SURFACE_Y = 0.08

export interface ActorViewOptions {
  /** Archetype ids this view renders, one InstancedMesh each. */
  readonly archetypes: readonly number[]
  readonly geometry: (archetype: number) => THREE.BufferGeometry
  readonly category: Category
  /** Hover height, or 0 to walk on the ground. */
  readonly hover?: (archetype: number) => number
}

/**
 * Renders one category of actors, one InstancedMesh per archetype.
 *
 * Positions are interpolated between the last two sim ticks using the loop's
 * alpha, so a 30 Hz simulation reads as smooth on a 120 Hz display.
 *
 * Health shows as a colour shift on the instance rather than a floating bar:
 * bars for 40 bodies would cost more draw calls than the entire rest of the
 * scene, and at this camera distance a reddening silhouette is legible while
 * 8px of bar is not. Full-health actors are left untinted, so any colour shift
 * on the board means something is actually hurt.
 */
export class ActorView {
  private readonly meshes = new Map<number, THREE.InstancedMesh>()
  private readonly counts = new Map<number, number>()
  private readonly matrix = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly quaternion = new THREE.Quaternion()
  private readonly euler = new THREE.Euler()
  private readonly scale = new THREE.Vector3(1, 1, 1)
  private readonly tint = new THREE.Color()
  private time = 0

  constructor(
    scene: THREE.Scene,
    private readonly grid: HexGrid,
    private readonly options: ActorViewOptions,
  ) {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
    for (const archetype of options.archetypes) {
      const mesh = new THREE.InstancedMesh(options.geometry(archetype), material, MAX_ENTITIES)
      mesh.frustumCulled = false
      mesh.count = 0
      mesh.visible = false
      this.meshes.set(archetype, mesh)
      scene.add(mesh)
    }
  }

  /** `alpha` is the 0..1 fraction between the previous and current sim tick. */
  sync(world: World, alpha: number, wallDt: number): void {
    this.time += wallDt
    for (const archetype of this.options.archetypes) this.counts.set(archetype, 0)

    for (let id = 0; id < world.capacity; id++) {
      if (!world.alive[id] || world.category[id] !== this.options.category) continue

      const archetype = world.archetype[id]!
      const mesh = this.meshes.get(archetype)
      if (!mesh) continue
      const index = this.counts.get(archetype)!

      const x = world.prevX[id]! + (world.posX[id]! - world.prevX[id]!) * alpha
      const z = world.prevZ[id]! + (world.posZ[id]! - world.prevZ[id]!) * alpha

      // Off-board actors have no tile; hold them at the outer ring's height so
      // they do not sink as they close on the board edge.
      const cell = this.grid.fromWorld(x, z)
      const ground = cell && this.grid.isPlayable(cell) ? cell.surfaceY : OUTER_SURFACE_Y

      const hover = this.options.hover?.(archetype) ?? 0
      // Phase by id so a pack does not bob in lockstep.
      const phase = this.time * 7 + id * 1.7
      let y = ground
      if (hover > 0) {
        y += hover + Math.sin(phase * 0.35) * 0.07
      } else if (Math.abs(world.velX[id]!) + Math.abs(world.velZ[id]!) > 0.01) {
        y += Math.abs(Math.sin(phase)) * 0.045
      }

      this.position.set(x, y, z)
      this.euler.set(0, world.yaw[id]!, 0)
      this.quaternion.setFromEuler(this.euler)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      mesh.setMatrixAt(index, this.matrix)

      const maxHp = world.maxHp[id]!
      const hurt = maxHp > 0 ? 1 - Math.max(0, Math.min(1, world.hp[id]! / maxHp)) : 0
      this.tint.setRGB(1, 1 - hurt * 0.62, 1 - hurt * 0.72)
      mesh.setColorAt(index, this.tint)

      this.counts.set(archetype, index + 1)
    }

    for (const [archetype, mesh] of this.meshes) {
      const count = this.counts.get(archetype)!
      mesh.count = count
      mesh.visible = count > 0
      if (count > 0) {
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    }
  }
}
