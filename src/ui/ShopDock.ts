import { BUILDINGS, type BuildingId } from '../data/buildings'
import { RARITY_COLOR, RARITY_LABEL, BUILDING_RARITY } from '../data/shop'

/** Pointer travel that turns a card press into a drag rather than a tap. */
const DRAG_THRESHOLD = 8

/**
 * The build offer, docked at the bottom of the screen for the whole Prep
 * period rather than blocking it as a modal.
 *
 * The board stays visible and interactive-adjacent the entire time — the
 * player can look at the live layout while deciding what to build and where,
 * which a full-screen shop got in the way of. Every card the player can
 * afford is buyable, not just one; a bought card turns into a compact "Built"
 * mark rather than disappearing, so the offer's shape stays legible.
 *
 * Each card supports the same press/drag/tap disambiguation M2 established
 * for the original build tray: drag it out onto a tile, or release in place
 * to arm tap-to-place.
 */
export class ShopDock {
  private readonly el = document.createElement('div')
  private readonly cardsEl = document.createElement('div')
  private readonly rerollBtn = document.createElement('button')
  private gold = 0
  private armedDefId: BuildingId | null = null

  onBuyDrag: ((index: number, event: PointerEvent) => void) | null = null
  onBuyTap: ((index: number) => void) | null = null
  onReroll: (() => void) | null = null

  constructor(parent: HTMLElement) {
    this.el.className = 'shop-dock'

    this.cardsEl.className = 'shop-dock-cards'
    this.rerollBtn.className = 'shop-dock-reroll'
    this.rerollBtn.addEventListener('click', () => this.onReroll?.())

    this.el.append(this.cardsEl, this.rerollBtn)
    parent.append(this.el)
  }

  show(offer: readonly BuildingId[], bought: readonly boolean[], rerollCost: number, gold: number): void {
    this.gold = gold
    this.rerollBtn.textContent = `Reroll · ◆ ${rerollCost}`
    this.rerollBtn.dataset['cost'] = String(rerollCost)
    this.rerollBtn.disabled = gold < rerollCost

    this.cardsEl.innerHTML = ''
    offer.forEach((id, index) => this.cardsEl.append(this.buildCard(id, index, bought[index] ?? false)))
  }

  /** Highlights whichever card is currently armed for placement, if any. */
  setArmed(defId: BuildingId | null): void {
    this.armedDefId = defId
    for (const card of this.cardsEl.querySelectorAll<HTMLElement>('.shop-dock-card')) {
      card.classList.toggle('armed', defId !== null && card.dataset['defId'] === defId)
    }
  }

  /** Refreshes affordability without rebuilding the cards, e.g. after a sale grants gold. */
  syncGold(gold: number): void {
    this.gold = gold
    this.rerollBtn.disabled = gold < Number(this.rerollBtn.dataset['cost'] ?? 0)
    for (const card of this.cardsEl.querySelectorAll<HTMLButtonElement>('.shop-dock-card:not(.bought)')) {
      card.disabled = gold < Number(card.dataset['cost'])
    }
  }

  /** Building only happens between waves — hidden during combat and on defeat. */
  setVisible(visible: boolean): void {
    this.el.classList.toggle('hidden', !visible)
  }

  private buildCard(id: BuildingId, index: number, bought: boolean): HTMLButtonElement {
    const def = BUILDINGS[id]
    const rarity = BUILDING_RARITY[id]

    const card = document.createElement('button')
    card.className = 'shop-dock-card'
    card.dataset['defId'] = id
    card.style.setProperty('--rarity-color', RARITY_COLOR[rarity])
    card.title = `${def.blurb} (${RARITY_LABEL[rarity]})`
    if (this.armedDefId === id) card.classList.add('armed')

    const name = document.createElement('div')
    name.className = 'shop-dock-card-name'
    name.textContent = def.name
    card.append(name)

    if (bought) {
      card.classList.add('bought')
      card.disabled = true
      const badge = document.createElement('div')
      badge.className = 'shop-dock-card-built'
      badge.textContent = '✓ Built'
      card.append(badge)
      return card
    }

    const cost = document.createElement('div')
    cost.className = 'shop-dock-card-cost'
    cost.textContent = `◆ ${def.cost}`
    card.append(cost)

    card.dataset['cost'] = String(def.cost)
    card.disabled = this.gold < def.cost

    card.addEventListener('pointerdown', (event) => {
      if (card.disabled) return
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

    return card
  }
}
