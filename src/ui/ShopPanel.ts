import { BUILDINGS, type BuildingId } from '../data/buildings'
import { RARITY_COLOR, RARITY_LABEL, BUILDING_RARITY } from '../data/shop'

/** Pointer travel that turns a Build press into a drag rather than a tap. */
const DRAG_THRESHOLD = 8

/**
 * The between-wave shop overlay: 1-of-3 cards, reroll, skip.
 *
 * Full-screen and blocking, deliberately — the plan's own risk list calls out
 * "never show shop and battlefield decisions simultaneously", so this sits on
 * top of the board rather than beside it, the same way GameOverPanel does.
 *
 * Each Build button supports the same press/drag/tap disambiguation M2
 * established for the build tray: drag it out onto a tile, or release in
 * place to arm tap-to-place. Both close the panel the instant the gesture is
 * confirmed, so the board is visible for the rest of the placement.
 */
export class ShopPanel {
  private readonly el = document.createElement('div')
  private readonly waveLabel = document.createElement('div')
  private readonly cardsEl = document.createElement('div')
  private readonly rerollBtn = document.createElement('button')
  private readonly skipBtn = document.createElement('button')
  private gold = 0

  onBuyDrag: ((index: number, event: PointerEvent) => void) | null = null
  onBuyTap: ((index: number) => void) | null = null
  onReroll: (() => void) | null = null
  onSkip: (() => void) | null = null

  constructor(parent: HTMLElement) {
    this.el.className = 'shop'

    const title = document.createElement('h1')
    title.textContent = 'The Bastion Grows'
    this.waveLabel.className = 'shop-wave'

    this.cardsEl.className = 'shop-cards'

    const footer = document.createElement('div')
    footer.className = 'shop-footer'
    this.rerollBtn.addEventListener('click', () => this.onReroll?.())
    this.skipBtn.addEventListener('click', () => this.onSkip?.())
    footer.append(this.rerollBtn, this.skipBtn)

    this.el.append(title, this.waveLabel, this.cardsEl, footer)
    parent.append(this.el)
  }

  show(wave: number, offer: readonly BuildingId[], rerollCost: number, gold: number): void {
    this.gold = gold
    this.waveLabel.textContent = `Before wave ${wave}`
    this.rerollBtn.textContent = `Reroll · ◆ ${rerollCost}`
    this.rerollBtn.dataset['cost'] = String(rerollCost)
    this.rerollBtn.disabled = gold < rerollCost
    this.skipBtn.textContent = 'Skip · +◆ 15'

    this.cardsEl.innerHTML = ''
    offer.forEach((id, index) => this.cardsEl.append(this.buildCard(id, index)))
    this.el.classList.add('visible')
  }

  /** Refreshes affordability without rebuilding the cards, e.g. after a sale grants gold. */
  syncGold(gold: number): void {
    this.gold = gold
    this.rerollBtn.disabled = gold < Number(this.rerollBtn.dataset['cost'] ?? 0)
    for (const button of this.cardsEl.querySelectorAll<HTMLButtonElement>('.shop-card button')) {
      button.disabled = gold < Number(button.dataset['cost'])
    }
  }

  hide(): void {
    this.el.classList.remove('visible')
  }

  private buildCard(id: BuildingId, index: number): HTMLElement {
    const def = BUILDINGS[id]
    const rarity = BUILDING_RARITY[id]

    const card = document.createElement('div')
    card.className = 'shop-card'
    card.style.setProperty('--rarity-color', RARITY_COLOR[rarity])

    const rarityTag = document.createElement('span')
    rarityTag.className = 'shop-card-rarity'
    rarityTag.textContent = RARITY_LABEL[rarity]

    const name = document.createElement('div')
    name.className = 'shop-card-name'
    name.textContent = def.name

    const blurb = document.createElement('div')
    blurb.className = 'shop-card-blurb'
    blurb.textContent = def.blurb

    const build = document.createElement('button')
    build.textContent = `Build · ◆ ${def.cost}`
    build.dataset['cost'] = String(def.cost)
    build.disabled = this.gold < def.cost

    build.addEventListener('pointerdown', (event) => {
      if (build.disabled) return
      const startX = event.clientX
      const startY = event.clientY
      let promoted = false

      const onMove = (move: PointerEvent): void => {
        if (promoted) return
        if (Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD) return
        promoted = true
        detach()
        this.onBuyDrag?.(index, move)
      }
      const onUp = (): void => {
        detach()
        if (!promoted) this.onBuyTap?.(index)
      }
      const onCancel = (): void => detach()
      const detach = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
    })

    card.append(rarityTag, name, blurb, build)
    return card
  }
}
