import * as THREE from 'three'
import { MAX_PROJECTILES, ProjectileKind, PROJECTILE_KINDS, type Projectiles } from '../sim/Projectiles'
import { bake, box, gem, type PartSpec } from './MeshKit'

/** Projectiles fly at roughly chest height on the actors they pass between. */
const FLIGHT_Y = 0.52

const SHAPES: Record<ProjectileKind, () => PartSpec[]> = {
  [ProjectileKind.Arrow]: () => [
    { geo: box(0.025, 0.025, 0.3), color: 0xd8cfae },
    { geo: box(0.05, 0.05, 0.06), color: 0x9fb0c4, pos: [0, 0, 0.16] },
  ],
  [ProjectileKind.Mote]: () => [
    { geo: gem(0.085), color: 0x74e0ff },
    { geo: gem(0.045), color: 0xd8f4ff, pos: [0, 0, -0.09] },
  ],
  [ProjectileKind.Bolt]: () => [
    { geo: box(0.05, 0.05, 0.44), color: 0x5c6b7d },
    { geo: box(0.09, 0.09, 0.1), color: 0xa8b6c8, pos: [0, 0, 0.24] },
  ],
}

/**
 * Renders in-flight projectiles, one InstancedMesh per family.
 *
 * Interpolated like actors, which matters more here than anywhere else: at
 * 9 units per second a bolt covers a third of a hex per sim tick, so without
 * interpolation it would visibly teleport.
 */
export class ProjectileView {
  private readonly meshes = new Map<ProjectileKind, THREE.InstancedMesh>()
  private readonly counts = new Map<ProjectileKind, number>()
  private readonly matrix = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly quaternion = new THREE.Quaternion()
  private readonly euler = new THREE.Euler()
  private readonly scale = new THREE.Vector3(1, 1, 1)

  constructor(scene: THREE.Scene) {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
    for (const kind of PROJECTILE_KINDS) {
      const mesh = new THREE.InstancedMesh(bake(SHAPES[kind]()), material, MAX_PROJECTILES)
      mesh.frustumCulled = false
      mesh.count = 0
      mesh.visible = false
      this.meshes.set(kind, mesh)
      scene.add(mesh)
    }
  }

  sync(projectiles: Projectiles, alpha: number): void {
    for (const kind of PROJECTILE_KINDS) this.counts.set(kind, 0)

    for (let id = 0; id < projectiles.capacity; id++) {
      if (!projectiles.alive[id]) continue
      const kind = projectiles.kind[id] as ProjectileKind
      const mesh = this.meshes.get(kind)
      if (!mesh) continue
      const index = this.counts.get(kind)!

      const x = projectiles.prevX[id]! + (projectiles.x[id]! - projectiles.prevX[id]!) * alpha
      const z = projectiles.prevZ[id]! + (projectiles.z[id]! - projectiles.prevZ[id]!) * alpha

      this.position.set(x, FLIGHT_Y, z)
      this.euler.set(0, projectiles.yaw[id]!, 0)
      this.quaternion.setFromEuler(this.euler)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      mesh.setMatrixAt(index, this.matrix)
      this.counts.set(kind, index + 1)
    }

    for (const [kind, mesh] of this.meshes) {
      const count = this.counts.get(kind)!
      mesh.count = count
      mesh.visible = count > 0
      if (count > 0) mesh.instanceMatrix.needsUpdate = true
    }
  }
}
