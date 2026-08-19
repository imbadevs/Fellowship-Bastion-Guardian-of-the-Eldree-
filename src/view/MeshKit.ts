import * as THREE from 'three'

/**
 * Shared procedural-geometry kit.
 *
 * Parts are authored as primitives, then merged into one geometry with their
 * palette baked into vertex colours. Merging is what keeps the draw-call budget
 * flat: a Construct with six parts still costs one instanced draw.
 */

export interface PartSpec {
  geo: THREE.BufferGeometry
  color: number
  /** Centre of the primitive, in local space with y=0 at the tile surface. */
  pos?: [number, number, number]
  rot?: [number, number, number]
}

export const box = (w: number, h: number, d: number): THREE.BufferGeometry =>
  new THREE.BoxGeometry(w, h, d)
export const cyl = (rTop: number, rBottom: number, h: number, seg = 8): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(rTop, rBottom, h, seg)
export const cone = (r: number, h: number, seg = 8): THREE.BufferGeometry =>
  new THREE.ConeGeometry(r, h, seg)
export const gem = (r: number): THREE.BufferGeometry => new THREE.IcosahedronGeometry(r, 0)

/**
 * Applies each part's transform, bakes colour into vertex attributes and
 * concatenates everything into one non-indexed geometry.
 *
 * Hand-rolled rather than pulling in BufferGeometryUtils: the parts always
 * share the same attribute layout, so the merge is a straight concat.
 */
export function bake(parts: PartSpec[]): THREE.BufferGeometry {
  const positions: Float32Array[] = []
  const normals: Float32Array[] = []
  const colors: Float32Array[] = []
  let total = 0

  const tint = new THREE.Color()

  for (const part of parts) {
    let geo = part.geo
    if (part.rot) geo.rotateX(part.rot[0]), geo.rotateY(part.rot[1]), geo.rotateZ(part.rot[2])
    if (part.pos) geo.translate(part.pos[0], part.pos[1], part.pos[2])

    geo = geo.index ? geo.toNonIndexed() : geo
    geo.computeVertexNormals()

    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute
    const count = pos.count

    tint.setHex(part.color)
    const col = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      // Upward faces read brightest, undersides darkest. Cheap baked AO that
      // survives instancing, since it lives in the geometry not the material.
      const ny = nrm.getY(i)
      const shade = 0.62 + 0.38 * Math.max(0, ny) - 0.18 * Math.max(0, -ny)
      col[i * 3] = tint.r * shade
      col[i * 3 + 1] = tint.g * shade
      col[i * 3 + 2] = tint.b * shade
    }

    positions.push(pos.array as Float32Array)
    normals.push(nrm.array as Float32Array)
    colors.push(col)
    total += count
    if (geo !== part.geo) part.geo.dispose()
  }

  const merged = new THREE.BufferGeometry()
  for (const [name, chunks] of [
    ['position', positions],
    ['normal', normals],
    ['color', colors],
  ] as const) {
    const flat = new Float32Array(total * 3)
    let offset = 0
    for (const chunk of chunks) {
      flat.set(chunk, offset)
      offset += chunk.length
    }
    merged.setAttribute(name, new THREE.BufferAttribute(flat, 3))
  }
  merged.computeBoundingSphere()
  return merged
}


/**
 * Scales a merged Construct so its footprint fills the tile it stands on.
 *
 * Authoring every building to the right size by hand is busywork that drifts
 * the moment a shape changes, so the fit is measured and applied here instead.
 *
 * Width and depth are scaled to hit `targetRadius` exactly. Height is only
 * partly carried along: a Construct with a small footprint — a spire, an
 * obelisk — needs a large factor to fill its hex, and applying that uniformly
 * would produce towers tall enough to hide the tiles behind them. Damping the
 * vertical component keeps the board readable while still letting slender
 * Constructs read as tall.
 */
export function fitToTile(
  geo: THREE.BufferGeometry,
  targetRadius: number,
  heightDamping = 0.4,
): { xz: number; y: number } {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  let maxRadiusSq = 0
  let maxY = 0
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const rSq = x * x + z * z
    if (rSq > maxRadiusSq) maxRadiusSq = rSq
    const y = pos.getY(i)
    if (y > maxY) maxY = y
  }

  const radius = Math.sqrt(maxRadiusSq)
  if (radius < 1e-4) return { xz: 1, y: 1 }

  const xz = THREE.MathUtils.clamp(targetRadius / radius, 0.5, 2.4)
  const y = 1 + (xz - 1) * heightDamping
  geo.scale(xz, y, xz)
  geo.computeBoundingSphere()
  return { xz, y }
}
