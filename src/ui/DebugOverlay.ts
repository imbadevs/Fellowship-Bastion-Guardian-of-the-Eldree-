import type { LoopStats } from '../core/Loop'

/** Perf budget from the plan. Exceeding either is a warning, not a crash. */
const DRAW_CALL_BUDGET = 60
const FRAME_MS_BUDGET = 16

export interface DebugSource {
  stats: LoopStats
  drawCalls: number
  triangles: number
  wave: number
  cells: number
  unlocked: number
  buildings: number
  enemies: number
  units: number
}

/**
 * Dev HUD. Reports against the mobile budget from day one — catching a
 * regression at the milestone that caused it is far cheaper than a perf
 * archaeology pass at M9.
 */
export class DebugOverlay {
  private readonly el = document.createElement('div')
  private accum = 0

  constructor(parent: HTMLElement) {
    this.el.className = 'debug'
    parent.append(this.el)
  }

  update(dt: number, source: DebugSource): void {
    this.accum += dt
    if (this.accum < 0.25) return
    this.accum = 0

    const { stats } = source
    const callClass = source.drawCalls > DRAW_CALL_BUDGET ? 'warn' : ''
    const msClass = stats.frameMs > FRAME_MS_BUDGET ? 'warn' : ''

    this.el.innerHTML =
      `<b>${stats.fps.toFixed(0)}</b> fps` +
      ` · <span class="${msClass}">${stats.frameMs.toFixed(1)}ms</span><br>` +
      `calls <span class="${callClass}">${source.drawCalls}</span>/${DRAW_CALL_BUDGET}` +
      ` · tris ${source.triangles}<br>` +
      `tiles ${source.unlocked}/${source.cells}` +
      ` · built <b>${source.buildings}</b>` +
      ` · foes <b>${source.enemies}</b>` +
      ` · units ${source.units}`
  }
}
