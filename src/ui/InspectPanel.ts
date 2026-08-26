import type { PlacedBuilding } from '../game/Buildings'

/**
 * A read-only info card for a Construct already on the board: name, blurb,
 * and live HP while a wave is running.
 *
 * Move, Merge and Sell are not offered here — all three are one drag gesture
 * now (long-press a Construct on the board, then drop it on an empty tile to
 * move, a matching Construct to merge, or the recycle icon to sell). A
 * button-driven menu was tried first and removed: next to actually dragging
 * the Construct where you want it, tapping a button then picking a target
 * read as clunky and added a step drag-and-drop does for free.
 */
export class InspectPanel {
  private readonly el = document.createElement('div')
  private readonly title = document.createElement('div')
  private readonly blurb = document.createElement('div')
  private target: PlacedBuilding | null = null

  constructor(parent: HTMLElement) {
    this.el.className = 'inspect'
    this.title.className = 'inspect-title'
    this.blurb.className = 'inspect-blurb'
    this.el.append(this.title, this.blurb)
    parent.append(this.el)
  }

  show(building: PlacedBuilding, options: { hp?: number; maxHp?: number } = {}): void {
    this.target = building
    this.title.textContent = building.def.name
    this.blurb.textContent =
      options.hp !== undefined && options.maxHp !== undefined
        ? `${building.def.blurb} · HP ${Math.ceil(options.hp)}/${Math.ceil(options.maxHp)}`
        : building.def.blurb
    this.el.classList.add('visible')
  }

  hide(): void {
    this.target = null
    this.el.classList.remove('visible')
  }

  get isOpen(): boolean {
    return this.target !== null
  }
}
