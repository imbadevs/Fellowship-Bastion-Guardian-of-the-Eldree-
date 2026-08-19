import { BuildingRegistry, type PlacedBuilding } from '../game/Buildings'

/**
 * Details for a Construct already on the board, with the move and sell actions.
 *
 * Repositioning is deliberately tap-driven rather than drag-driven: a drag
 * starting on the board would race the camera pan gesture, and disambiguating
 * the two by hold-delay is worse on a phone than one extra tap.
 */
export class InspectPanel {
  private readonly el = document.createElement('div')
  private readonly title = document.createElement('div')
  private readonly blurb = document.createElement('div')
  private readonly moveBtn = document.createElement('button')
  private readonly sellBtn = document.createElement('button')
  private readonly actions = document.createElement('div')
  private target: PlacedBuilding | null = null
  private interactive = false

  onMove: ((building: PlacedBuilding) => void) | null = null
  onSell: ((building: PlacedBuilding) => void) | null = null
  onClose: (() => void) | null = null

  constructor(parent: HTMLElement) {
    this.el.className = 'inspect'
    this.title.className = 'inspect-title'
    this.blurb.className = 'inspect-blurb'

    this.actions.className = 'inspect-actions'
    this.moveBtn.textContent = 'Move'
    this.sellBtn.className = 'danger'
    const closeBtn = document.createElement('button')
    closeBtn.className = 'ghost'
    closeBtn.textContent = 'Close'
    this.actions.append(this.moveBtn, this.sellBtn, closeBtn)

    this.moveBtn.addEventListener('click', () => {
      if (this.target && this.interactive) this.onMove?.(this.target)
      this.hide()
    })
    this.sellBtn.addEventListener('click', () => {
      if (this.target && this.interactive) this.onSell?.(this.target)
      this.hide()
    })
    closeBtn.addEventListener('click', () => {
      this.hide()
      this.onClose?.()
    })

    this.el.append(this.title, this.blurb, this.actions)
    parent.append(this.el)
  }

  /**
   * `readOnly` drops the Move/Sell actions down to a status readout — used
   * while a wave is running, when the board is combat-only and the player
   * can look but not touch. `hp` lets a live Construct show current health
   * rather than the static blurb.
   */
  show(building: PlacedBuilding, options: { hp?: number; maxHp?: number; readOnly?: boolean } = {}): void {
    this.target = building
    this.interactive = !options.readOnly
    this.title.textContent = building.def.name
    this.blurb.textContent =
      options.hp !== undefined && options.maxHp !== undefined
        ? `${building.def.blurb} · HP ${Math.ceil(options.hp)}/${Math.ceil(options.maxHp)}`
        : building.def.blurb
    this.sellBtn.textContent = `Sell ◆ ${BuildingRegistry.refundFor(building.def)}`
    this.actions.classList.toggle('readonly', !!options.readOnly)
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
