import * as THREE from 'three'

/** Retina beyond 2x costs fill rate we would rather spend on entity count. */
const MAX_PIXEL_RATIO = 2

/**
 * Owns the WebGL context, scene and lighting.
 *
 * Lighting is deliberately minimal — one hemisphere fill plus one directional
 * key, no shadow maps. Contact shadows arrive in M4 as an instanced blob-shadow
 * plane, which costs a single draw call instead of a depth pass per light.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  private readonly fog: THREE.Fog

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05

    this.scene.background = new THREE.Color(0x0a0e14)
    this.fog = new THREE.Fog(0x0a0e14, 14, 34)
    this.scene.fog = this.fog

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 100)

    const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x2a2416, 1.5)
    this.scene.add(hemi)

    const key = new THREE.DirectionalLight(0xfff0d0, 1.9)
    key.position.set(-6, 12, 5)
    this.scene.add(key)

    this.resize()
  }

  resize(): void {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /**
   * Keeps the fog band centred on the board rather than at a fixed depth.
   * The camera distance is derived from viewport aspect and zoom, so a
   * hard-coded range is wrong on any device but the one it was tuned on.
   */
  updateFog(cameraDistance: number, boardRadius: number): void {
    this.fog.near = cameraDistance - boardRadius * 0.4
    this.fog.far = cameraDistance + boardRadius * 2.6
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls
  }

  get triangles(): number {
    return this.renderer.info.render.triangles
  }
}
