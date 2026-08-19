/** Simulation ticks per second. The sim is fixed-step; rendering is not. */
export const SIM_HZ = 30
export const SIM_DT = 1 / SIM_HZ

/** Never simulate more than this much wall time in one frame (tab-restore guard). */
const MAX_FRAME_TIME = 0.25

export interface LoopStats {
  /** Smoothed frames per second. */
  fps: number
  /** Smoothed wall time spent inside the frame callback, in ms. */
  frameMs: number
  /** Sim ticks executed in the last frame. */
  ticks: number
}

/**
 * Fixed-timestep game loop with an interpolated render.
 *
 * The sim advances in whole SIM_DT steps so combat is deterministic and the
 * speed multiplier is exact (it runs more ticks, it does not scale dt).
 * `render` receives `alpha`, the 0..1 fraction between the last two sim states,
 * so visuals stay smooth at any display refresh rate.
 */
export class Loop {
  readonly stats: LoopStats = { fps: 0, frameMs: 0, ticks: 0 }

  /** Sim ticks per rendered second multiplier: 1, 2 or 4. */
  speed = 1
  paused = false

  private accumulator = 0
  private lastTime = 0
  private rafId = 0
  private running = false

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: (alpha: number, wallDt: number) => void,
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this.rafId = requestAnimationFrame(this.frame)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.rafId)
  }

  private frame = (now: number): void => {
    if (!this.running) return
    this.rafId = requestAnimationFrame(this.frame)

    const frameStart = now
    let wallDt = (now - this.lastTime) / 1000
    this.lastTime = now
    if (wallDt > MAX_FRAME_TIME) wallDt = MAX_FRAME_TIME

    let ticks = 0
    if (!this.paused) {
      this.accumulator += wallDt * this.speed
      // Cap the catch-up burst so a slow device degrades smoothly instead of
      // spiralling: dropping sim time is better than a 2s freeze.
      const maxTicks = 6 * this.speed
      while (this.accumulator >= SIM_DT && ticks < maxTicks) {
        this.update(SIM_DT)
        this.accumulator -= SIM_DT
        ticks++
      }
      if (ticks >= maxTicks) this.accumulator = 0
    }

    this.render(this.accumulator / SIM_DT, wallDt)

    const elapsed = performance.now() - frameStart
    const k = 0.1
    this.stats.frameMs += (elapsed - this.stats.frameMs) * k
    this.stats.fps += (1 / Math.max(wallDt, 1e-6) - this.stats.fps) * k
    this.stats.ticks = ticks
  }
}
